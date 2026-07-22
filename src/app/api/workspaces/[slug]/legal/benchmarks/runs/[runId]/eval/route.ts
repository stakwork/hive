import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { dispatchLegalBenchmarkEvalRun } from "@/services/legal-benchmark-eval";

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
 * POST /api/workspaces/[slug]/legal/benchmarks/runs/[runId]/eval
 *
 * Thin wrapper around dispatchLegalBenchmarkEvalRun.
 * Gated to the `openlaw` workspace only.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, runId } = await params;

    // Gate to openlaw workspace only
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve workspace swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmSecretAlias, swarmUrl } = swarmResult.data;

    try {
      const result = await dispatchLegalBenchmarkEvalRun({
        runId,
        workspaceId,
        swarmUrl,
        swarmSecretAlias,
        slug,
        userId: userOrResponse.id,
      });

      return NextResponse.json(
        { evalRunId: result.evalRunId, projectId: result.projectId },
        { status: 201 },
      );
    } catch (err) {
      if (err instanceof Error) {
        const code = (err as Error & { code?: string }).code;
        switch (code) {
          case "NO_FAILURES":
            return NextResponse.json({ skipped: true, reason: "no_failures" }, { status: 200 });
          case "ALREADY_RAN":
            return NextResponse.json({ skipped: true, reason: "already_ran" }, { status: 200 });
          case "ACTIVE_EVAL_RUN_EXISTS":
            return NextResponse.json({ error: "ACTIVE_EVAL_RUN_EXISTS" }, { status: 409 });
          case "SWARM_URL_MISSING":
            return NextResponse.json({ error: "SWARM_URL_MISSING" }, { status: 400 });
          case "EVAL_WORKFLOW_NOT_CONFIGURED":
            return NextResponse.json(
              { error: "EVAL_WORKFLOW_NOT_CONFIGURED" },
              { status: 503 },
            );
        }
        if (err.message === "Run not found") {
          return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }
        if (err.message === "Source run is not a LEGAL_BENCHMARK_RUNNER") {
          return NextResponse.json(
            { error: "Source run is not a LEGAL_BENCHMARK_RUNNER" },
            { status: 400 },
          );
        }
        if (err.message === "Failed to dispatch eval job to Stakwork") {
          return NextResponse.json(
            { error: "Failed to dispatch eval job to Stakwork" },
            { status: 502 },
          );
        }
      }
      throw err;
    }
  } catch (error) {
    console.error("[legal/benchmarks/runs/[runId]/eval POST] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
