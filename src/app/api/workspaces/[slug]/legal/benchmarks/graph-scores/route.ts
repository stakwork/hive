import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import {
  fetchTaskGraphOutputs,
  GRAPH_SCORES_TRIGGER_CAP,
} from "@/services/legal-benchmark-graph-scores";
import type { GraphScoreOutput } from "@/lib/harvey-lab/graph-run-score";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

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

/** Jarvis ref_ids are UUIDs or slug-shaped mock ids — reject anything odd.
 *  Deliberately excludes "," (this param's separator) and "|" (the client
 *  cache key separator in useBenchmarkGraphScores). */
const TRIGGER_REF_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Mock outputs for USE_MOCKS mode, mirroring the rubrics route's mock roster
 * (10 rubrics, 2 contested): one output per requested trigger ref scoring
 * 7/10 via a judge_notes-only node (hive's inline write shape), plus one
 * EvalSet-hosted-style output whose id suffix matches the seeded demo run's
 * Stakwork project (57419) so the recursion-row projectId join is exercisable
 * end to end in dev.
 */
function buildMockOutputs(taskSlug: string, triggerRefs: string[]): GraphScoreOutput[] {
  const perTrigger: GraphScoreOutput[] = triggerRefs.map((triggerRef, i) => ({
    ref_id: `mock-output-${taskSlug}-${i}`,
    triggerRef,
    attempt_number: 1,
    result: "fail",
    score: 0.7,
    n_passed: 7,
    n_total: 10,
    judge_notes: "7/10 criteria passed. Judge: mock-judge",
    date_added_to_graph: String(1760000000 + i),
  }));
  return [
    ...perTrigger,
    {
      ref_id: `mock-output-${taskSlug}-rerun`,
      triggerRef: `mock-trigger-${taskSlug}-rerun`,
      id: `${taskSlug}-mock-source--57419`,
      attempt_number: 2,
      result: "fail",
      score: 0.8,
      n_passed: 8,
      n_total: 10,
      judge_notes: "8/10 criteria passed. Judge: mock-judge",
      date_added_to_graph: "1760099999",
    },
  ];
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/graph-scores
 *       ?taskSlug=...&triggerRefs=a,b,c
 *
 * Returns the task's EvalTriggerOutput nodes so the Runs tab can score rows
 * from the graph instead of the StakworkRun `result` column. Outputs come
 * from the EvalSet's own trigger chain (re-scored recursion attempts) plus
 * the caller-supplied trigger refs (manual runs' requirement-hosted
 * triggers, known per-row via `result.evalTriggerRef`).
 *
 * Returns:
 *  - 200 `{ success: true, data: { evalSetRefId, outputs, partial } }`
 *  - 502 when the graph was unreachable and produced nothing
 *
 * Gated to the `openlaw` workspace only.
 * Rate-limited (fail-open, same policy as fix-chain): 60 requests / 60s per
 * IP — the runs table fans out one request per distinct task in view.
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
    const url = new URL(request.url);
    const taskSlug = url.searchParams.get("taskSlug")?.trim();
    if (!taskSlug) {
      return NextResponse.json({ error: "taskSlug query param is required" }, { status: 400 });
    }
    const triggerRefs = (url.searchParams.get("triggerRefs") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r !== "" && TRIGGER_REF_RE.test(r))
      .slice(0, GRAPH_SCORES_TRIGGER_CAP);

    // Step 4: Rate limit — fails OPEN when the limiter backend is down, so a
    // dead Redis degrades to no-limit rather than a table of dashes.
    try {
      const ip = getClientIp(request);
      const rl = await checkRateLimit(`benchmark-graph-scores:get:${ip}`, 60, 60);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many requests", retryAfter: rl.retryAfter },
          { status: 429 },
        );
      }
    } catch (rateLimitError) {
      logger.warn(
        "[legal/benchmarks/graph-scores] Rate limit unavailable — failing open",
        "legal",
        { error: String(rateLimitError) },
      );
    }

    // Step 5: Resolve workspace swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }
    const { workspaceId } = swarmResult.data;

    // Step 6: USE_MOCKS guard — never in production
    if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
      return NextResponse.json({
        success: true,
        data: {
          evalSetRefId: `mock-evalset-${taskSlug}`,
          outputs: buildMockOutputs(taskSlug, triggerRefs),
          partial: false,
        },
      });
    }

    // Step 7: Resolve Jarvis config + fetch outputs
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    const result = await fetchTaskGraphOutputs(jarvisConfig, taskSlug, triggerRefs);
    if (!result.ok) {
      return NextResponse.json({ error: "Graph unreachable" }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      data: {
        evalSetRefId: result.evalSetRefId,
        outputs: result.outputs,
        partial: result.partial,
      },
    });
  } catch (error) {
    logger.error("[legal/benchmarks/graph-scores] GET error", "legal", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
