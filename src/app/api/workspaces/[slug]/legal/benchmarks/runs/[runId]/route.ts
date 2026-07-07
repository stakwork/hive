import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
};

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/runs/[runId]
 *
 * Thin pass-through: fetch a single LEGAL_BENCHMARK_RUNNER StakworkRun and its
 * sibling scorer row, returning them as a pair.
 * IDOR-guarded by workspace ownership. Gated to the `openlaw` workspace only.
 *
 * NOTE: This route is kept for backward compatibility while the UI migrates to
 * consuming /api/stakwork/runs directly (T4). Once the UI migration lands this
 * route can be removed.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, runId } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // Fetch the run scoped to the caller's workspace — workspaceId is in the WHERE
    // clause so a cross-workspace runId simply returns null (no post-fetch check needed).
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: { in: [StakworkRunType.LEGAL_BENCHMARK_RUNNER, StakworkRunType.LEGAL_BENCHMARK_SCORER] },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve the sibling run scoped to the same workspace
    let siblingRun = null;
    try {
      const resultJson = run.result
        ? (JSON.parse(run.result) as Record<string, unknown>)
        : {};
      const siblingId = resultJson.siblingRunId as string | undefined;
      if (siblingId) {
        siblingRun = await db.stakworkRun.findFirst({
          where: { id: siblingId, workspaceId },
        });
      }
    } catch {
      // Non-fatal — return the run without sibling
    }

    const runnerRun =
      run.type === StakworkRunType.LEGAL_BENCHMARK_RUNNER ? run : siblingRun;
    const scorerRun =
      run.type === StakworkRunType.LEGAL_BENCHMARK_SCORER ? run : siblingRun;

    return NextResponse.json({ run, runnerRun, scorerRun });
  } catch (error) {
    console.error("[legal/benchmarks/runs/[runId] GET] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
