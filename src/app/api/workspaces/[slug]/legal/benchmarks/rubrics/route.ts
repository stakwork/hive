import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * Mock roster for USE_MOCKS mode: ten rubrics, two contested, ids matching the
 * "C-00N" shape the runner echoes so contested exclusion is exercised end to
 * end in dev.
 */
function buildMockRoster(taskSlug: string): { evalSetRefId: string; rubrics: GraphRubric[] } {
  const rubrics: GraphRubric[] = Array.from({ length: 10 }, (_, i) => {
    const id = `C-${String(i + 1).padStart(3, "0")}`;
    return {
      ref_id: `mock-req-${taskSlug}-${id}`,
      id,
      name: `Mock rubric ${id}`,
      contested: i < 2,
    };
  });
  return { evalSetRefId: `mock-evalset-${taskSlug}`, rubrics };
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/rubrics?taskSlug=...
 *
 * Returns the graph rubric roster for a benchmark task:
 * EvalSet (properties.id = taskSlug) -[HAS_REQUIREMENT]-> EvalRequirement.
 * Score surfaces read their denominator (roster size minus contested
 * definitions) from this response rather than the runner-echoed n_total.
 *
 * Returns:
 *  - 200 `{ success: true, data: { evalSetRefId, rubrics, total, contested } }`
 *  - 200 `{ success: true, data: null }` when the task has no EvalSet in the
 *    graph — callers fall back to run-local scoring
 *  - 502 when the graph is unreachable
 *
 * Gated to the `openlaw` workspace only.
 * Rate-limited: 60 requests / 60 seconds per IP (the runs table fans out one
 * request per distinct task in view).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Step 2: Openlaw-only guard
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 3: Parse + validate query
    const taskSlug = new URL(request.url).searchParams.get("taskSlug")?.trim();
    if (!taskSlug) {
      return NextResponse.json(
        { error: "taskSlug query param is required" },
        { status: 400 },
      );
    }

    // Step 4: Rate limit
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`benchmark-rubrics:get:${ip}`, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 5: Resolve workspace swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }
    const { workspaceId } = swarmResult.data;

    // Step 6: USE_MOCKS guard
    if (process.env.USE_MOCKS === "true") {
      const roster = buildMockRoster(taskSlug);
      return NextResponse.json({
        success: true,
        data: {
          ...roster,
          total: roster.rubrics.length,
          contested: roster.rubrics.filter((r) => r.contested).length,
        },
      });
    }

    // Step 7: Resolve Jarvis config + fetch roster
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    const result = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch rubrics from graph" },
        { status: 502 },
      );
    }

    if (!result.roster) {
      // No EvalSet in the graph for this task — a legitimate state, not a 404:
      // callers fall back to run-local scoring.
      return NextResponse.json({ success: true, data: null });
    }

    const { evalSetRefId, rubrics } = result.roster;
    return NextResponse.json({
      success: true,
      data: {
        evalSetRefId,
        rubrics,
        total: rubrics.length,
        contested: rubrics.filter((r) => r.contested).length,
      },
    });
  } catch (error) {
    console.error("[legal/benchmarks/rubrics] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
