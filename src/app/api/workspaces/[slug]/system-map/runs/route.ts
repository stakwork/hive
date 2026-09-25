/**
 * GET  /api/workspaces/:slug/system-map/runs — the workspace's System Map
 *      workflow runs, newest first (PENDING ones settled from strut when
 *      the run is over there and the callback never arrived).
 * POST /api/workspaces/:slug/system-map/runs — launch the workflow on the
 *      org strut. One run in flight per workspace; DEVELOPER and up.
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
  launchSystemMapRun,
  listSystemMapRuns,
  systemMapWorkflowName,
} from "@/services/strut-runs/system-map";
import type { SystemMapRunsResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_RATE_LIMIT = 10;
const RUN_WINDOW_SECS = 60 * 60;

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

    const body: SystemMapRunsResponse = {
      workflow: systemMapWorkflowName(),
      runs: await listSystemMapRuns(member.workspaceId),
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

    if (await hasPendingSystemMapRun(member.workspaceId)) {
      return NextResponse.json({ error: "A system map run is already in progress" }, { status: 409 });
    }

    const rate = await checkRateLimit(`system-map:run:${member.workspaceId}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
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
    });
    return NextResponse.json({ success: true, runId: dispatched.runId, strutRunId: dispatched.strutRunId }, { status: 202 });
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[SystemMap] runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
