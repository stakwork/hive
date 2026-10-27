/**
 * GET  /api/workspaces/:slug/system-map/runs?workflow=system_map|cwe_check|finding_verify|package_cves[&findingRefId=]
 *      — the workspace's runs of that System Map workflow (the finding checks
 *      covering one finding, with `findingRefId`), newest first (PENDING ones settled from strut
 *      when the run is over there and the callback never arrived). Default `schema`.
 * POST /api/workspaces/:slug/system-map/runs
 *      { workflow?: SystemMapWorkflowKey, cweIds?: string[], components?: string[] }
 *      (`cweIds` — `["CWE-79", …]` — and `components` — System Map component
 *      names, `["stakwork/hive", …]` — only for the CWE check, sent as
 *      `input.cwe_ids` / `input.components`)
 *      { workflow: "finding_verify", findingRefIds: string[], apply?: boolean }
 *      (up to 50 `Finding` ref_ids, sent as `input.finding_ref_ids`; `apply`
 *      writes the verdicts, else a dry run)
 *      { workflow: "security_audit", repos: ["owner/name"], classes?, apply?, maxAgentCalls? }
 *      (`swarm-security-hunt`; `apply` writes Findings, else a dry run)
 *      — launch that workflow on the org strut. One run in flight per
 *      workspace per workflow (per finding for the finding check); DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  hasPendingSystemMapRun,
  isSystemMapWorkflowKey,
  launchSystemMapRun,
  listSystemMapRuns,
  parseComponents,
  parseCweIds,
  parseFindingInput,
  parseSecurityAuditInput,
  SYSTEM_MAP_WORKFLOWS,
  type SystemMapWorkflowKey,
} from "@/services/strut-runs/system-map";
import type { SystemMapRunsResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_RATE_LIMIT = 10;
const RUN_WINDOW_SECS = 60 * 60;

/** `schema` when absent; null when present but unknown. */
function parseKey(raw: unknown): SystemMapWorkflowKey | null {
  if (raw === null || raw === undefined || raw === "") return "system_map";
  return isSystemMapWorkflowKey(raw) ? raw : null;
}

async function authorize(request: NextRequest, slug: string) {
  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireProtectMemberAccess(access);
  if (member instanceof NextResponse) return member;
  if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return member;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorize(request, slug);
    if (member instanceof NextResponse) return member;

    const key = parseKey(request.nextUrl.searchParams.get("workflow"));
    if (!key) return NextResponse.json({ error: "Unknown workflow" }, { status: 400 });

    const findingRefId = request.nextUrl.searchParams.get("findingRefId") || undefined;
    const body: SystemMapRunsResponse = {
      key,
      workflow: SYSTEM_MAP_WORKFLOWS[key].workflow,
      runs: await listSystemMapRuns(member.workspaceId, key, { findingRefId }),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] runs GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorize(request, slug);
    if (member instanceof NextResponse) return member;

    if (WORKSPACE_PERMISSION_LEVELS[member.role] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]) {
      return NextResponse.json({ error: "Developer access required" }, { status: 403 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      workflow?: unknown;
      cweIds?: unknown;
      components?: unknown;
      findingRefIds?: unknown;
      apply?: unknown;
      repos?: unknown;
      classes?: unknown;
      maxAgentCalls?: unknown;
    };
    const key = parseKey(payload.workflow);
    if (!key) return NextResponse.json({ error: "Unknown workflow" }, { status: 400 });

    const cweIds = parseCweIds(key, payload.cweIds);
    if (cweIds && !Array.isArray(cweIds)) return NextResponse.json({ error: cweIds.error }, { status: 400 });

    const components = parseComponents(key, payload.components);
    if (components && !Array.isArray(components)) {
      return NextResponse.json({ error: components.error }, { status: 400 });
    }

    const findings = parseFindingInput(key, payload.findingRefIds, payload.apply);
    if (findings && "error" in findings) return NextResponse.json({ error: findings.error }, { status: 400 });

    const audit = parseSecurityAuditInput(key, payload);
    if (audit && "error" in audit) return NextResponse.json({ error: audit.error }, { status: 400 });

    if (await hasPendingSystemMapRun(member.workspaceId, key, findings?.findingRefIds)) {
      const error = findings
        ? "One of these findings is already being checked"
        : "A run of this workflow is already in progress";
      return NextResponse.json({ error }, { status: 409 });
    }

    const rate = await checkRateLimit(`system-map:run:${member.workspaceId}:${key}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many system map runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    const dispatched = await launchSystemMapRun({
      workspaceId: member.workspaceId,
      workspaceSlug: member.slug,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      key,
      cweIds,
      components,
      findings,
      audit,
    });
    return NextResponse.json(
      { success: true, key, runId: dispatched.runId, strutRunId: dispatched.strutRunId, strutUrl: dispatched.strutUrl },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[SystemMap] runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
