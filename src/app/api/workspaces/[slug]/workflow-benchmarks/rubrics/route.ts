import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBenchmarkWorkspaceAllowed } from "@/lib/workflow-benchmarks/workspace-gate";
import { CORPUS_SLUGS, WORKFLOW_BENCHMARK_TASKS } from "@/lib/workflow-benchmark-tasks";
import { isDevelopmentMode } from "@/lib/runtime";
import { logger } from "@/lib/logger";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * Build a mock rubric roster from corpus criteria.
 * 8 rubrics, none contested, ids matching the corpus "C-00N" shape.
 */
function buildMockRoster(
  taskSlug: string,
  criteria: Array<{ id: string; title: string }>,
): { evalSetRefId: string; rubrics: GraphRubric[] } {
  const rubrics: GraphRubric[] = criteria.map((c) => ({
    ref_id: `mock-req-${taskSlug}-${c.id}`,
    id: c.id,
    name: c.title,
    contested: false,
  }));
  return { evalSetRefId: `mock-evalset-${taskSlug}`, rubrics };
}

/**
 * GET /api/workspaces/[slug]/workflow-benchmarks/rubrics?taskSlug=...
 *
 * Returns the graph rubric roster for a Workflow Editor Benchmark corpus task.
 * EvalSet (properties.id = taskSlug) -[HAS_REQUIREMENT]-> EvalRequirement.
 *
 * Requirement ids on the wire are bare "C-001" etc. (the "${taskSlug}::" prefix
 * is stripped on the way out so criterionStatus joins work correctly on the
 * client).
 *
 * Returns:
 *  - 200 `{ success: true, data: { evalSetRefId, rubrics, total, contested } }`
 *  - 200 `{ success: true, data: null, rosterUnavailable: true }` when the
 *    graph has no EvalSet for this task — callers fall back to run-local scoring
 *  - 400 on missing/invalid taskSlug, or when Jarvis config is unavailable
 *  - 502 when the graph is unreachable
 *
 * Gated to workspaces allowed by isBenchmarkWorkspaceAllowed.
 * Rate-limited: 60 requests / 60 seconds per user (fail-open — read path).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // ── Step 1: Auth ──────────────────────────────────────────────────────────
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // ── Step 2: Workspace gate (404 — no 403 leakage) ────────────────────────
    if (!isBenchmarkWorkspaceAllowed(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Step 3: Parse + validate taskSlug query param ─────────────────────────
    const taskSlug = new URL(request.url).searchParams.get("taskSlug")?.trim();
    if (!taskSlug || !CORPUS_SLUGS.has(taskSlug)) {
      return NextResponse.json(
        { error: "taskSlug query param is required and must be a known corpus slug" },
        { status: 400 },
      );
    }

    // ── Step 4: Rate limit — fail CLOSED (503) ────────────────────────────────
    // Aligned with the dispatch route's posture (run/route.ts Step 4). This
    // route grows a second read path (rubric roster) against the same Jarvis
    // graph backend that step 12's roster-summary batch endpoint also hits,
    // so a limiter outage should not leave that backend unthrottled.
    try {
      const rl = await checkRateLimit(`benchmark-rubrics:${userId}`, 60, 60);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many requests", retryAfter: rl.retryAfter },
          { status: 429 },
        );
      }
    } catch {
      logger.warn(
        "[workflow-benchmarks/rubrics] Rate limit service unavailable (fail-closed)",
        "workflow-benchmarks",
        { userId, taskSlug },
      );
      return NextResponse.json(
        { error: "Rate limit service unavailable" },
        { status: 503 },
      );
    }

    // ── Step 5: Workspace swarm access (404 on failure) ───────────────────────
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { workspaceId } = swarmResult.data;

    // ── Step 6: Mock roster gate ──────────────────────────────────────────────
    if (isDevelopmentMode() && process.env.USE_MOCKS === "true") {
      const taskCriteria =
        WORKFLOW_BENCHMARK_TASKS.find((t) => t.slug === taskSlug)?.criteria ?? [];
      const roster = buildMockRoster(taskSlug, taskCriteria);
      return NextResponse.json({
        success: true,
        data: {
          evalSetRefId: roster.evalSetRefId,
          rubrics: roster.rubrics,
          total: roster.rubrics.length,
          contested: roster.rubrics.filter((r) => r.contested).length,
        },
      });
    }

    // ── Step 7: Jarvis config ─────────────────────────────────────────────────
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json(
        { error: "Swarm not configured for workspace" },
        { status: 400 },
      );
    }

    // ── Step 8: Fetch rubric roster from graph ────────────────────────────────
    const result = await fetchTaskRubricRoster(jarvisConfig, taskSlug);

    // ── Step 13: Graph failure → 502 ─────────────────────────────────────────
    if (!result.ok) {
      logger.warn(
        `[workflow-benchmarks/rubrics] Graph unavailable for taskSlug=${taskSlug}`,
        "workflow-benchmarks",
        { taskSlug, error: result.error },
      );
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch rubrics from graph" },
        { status: 502 },
      );
    }

    // ── Step 11: Roster unavailable (no EvalSet in graph) ────────────────────
    if (!result.roster) {
      logger.info(
        `[workflow-benchmarks/rubrics] Roster unavailable for taskSlug=${taskSlug} (no EvalSet in graph)`,
        "workflow-benchmarks",
        { taskSlug, scoreSource: "unavailable" },
      );
      return NextResponse.json({
        success: true,
        data: null,
        rosterUnavailable: true,
      });
    }

    const { evalSetRefId, rubrics: rawRubrics } = result.roster;

    // ── Step 9: Strip "${taskSlug}::" prefix from each rubric id ─────────────
    const prefix = `${taskSlug}::`;
    const rubrics: GraphRubric[] = rawRubrics.map((r) => ({
      ...r,
      id: r.id.startsWith(prefix) ? r.id.slice(prefix.length) : r.id,
    }));

    // ── Step 10: Log score-source resolution ──────────────────────────────────
    logger.info(
      `[workflow-benchmarks/rubrics] Roster resolved from graph for taskSlug=${taskSlug} total=${rubrics.length} contested=${rubrics.filter((r) => r.contested).length}`,
      "workflow-benchmarks",
      {
        taskSlug,
        scoreSource: "graph",
        evalSetRefId,
        total: rubrics.length,
        contested: rubrics.filter((r) => r.contested).length,
      },
    );

    // ── Step 12: Return roster ────────────────────────────────────────────────
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[workflow-benchmarks/rubrics] Unexpected error: ${message}`,
      "workflow-benchmarks",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
