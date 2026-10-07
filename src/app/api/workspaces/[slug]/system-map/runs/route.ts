/**
 * GET  /api/workspaces/:slug/system-map/runs?workflow=schema|materialize|cwe_check
 *      — the workspace's runs of that System Map workflow, newest first
 *      (PENDING ones settled from strut when the run is over there and the
 *      callback never arrived). Default `schema`. Pass `?runId=` to scope
 *      to one launched run (IDOR-checked against this workspace) instead of
 *      listing — see `GET` below.
 * POST /api/workspaces/:slug/system-map/runs  { workflow?: "schema" | "materialize" | "cwe_check" }
 *      — launch that workflow on the org strut. One run in flight per
 *      workspace per workflow kind, enforced by a DB partial unique index
 *      (not a check-then-create race) — a concurrent second launch gets a
 *      409. DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveTrustedOrigin } from "@/lib/utils";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  getSystemMapRunStatus,
  isSystemMapWorkflowKey,
  launchSystemMapRun,
  listSystemMapRuns,
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
  if (raw === null || raw === undefined || raw === "") return "schema";
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

const STATUS_RATE_LIMIT = 60;
const STATUS_WINDOW_SECS = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorize(request, slug);
    if (member instanceof NextResponse) return member;

    // Run-scoped status: `?runId=` answers with that run only (IDOR-checked
    // against this workspace inside `getSystemMapRunStatus`), never by
    // inferring settlement from some OTHER historical run.
    const runId = request.nextUrl.searchParams.get("runId");
    if (runId) {
      const rate = await checkRateLimit(`system-map:status:${member.workspaceId}:${member.userId}`, STATUS_RATE_LIMIT, STATUS_WINDOW_SECS);
      if (!rate.allowed) {
        return NextResponse.json(
          { error: "Too many status checks. Try again later." },
          { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
        );
      }
      const run = await getSystemMapRunStatus(member.workspaceId, runId);
      if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
      return NextResponse.json({ run });
    }

    const key = parseKey(request.nextUrl.searchParams.get("workflow"));
    if (!key) return NextResponse.json({ error: "Unknown workflow" }, { status: 400 });

    const body: SystemMapRunsResponse = {
      key,
      workflow: SYSTEM_MAP_WORKFLOWS[key].workflow,
      runs: await listSystemMapRuns(member.workspaceId, key),
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

    const payload = (await request.json().catch(() => ({}))) as { workflow?: unknown };
    const key = parseKey(payload.workflow);
    if (!key) return NextResponse.json({ error: "Unknown workflow" }, { status: 400 });

    // No check-then-create here: the single-flight guard is a DB partial
    // unique index (`strut_runs_system_map_pending_unique_idx`, one PENDING
    // row per workspace+kind), enforced inside `dispatchStrutRun`'s
    // `create()`. A concurrent second launch can't slip through a
    // check/create gap — it fails the insert and surfaces as `conflict`
    // below. Client-side button disabling is a usability nicety only.

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
      publicBaseUrl: resolveTrustedOrigin(request.headers.get("host")),
      key,
    });
    return NextResponse.json(
      { success: true, key, runId: dispatched.runId, strutRunId: dispatched.strutRunId },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status =
        error.code === "conflict" ? 409 : error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[SystemMap] runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
