import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";
import { parseBenchmarkRunResult, type ProposedFix } from "@/types/legal";
import { searchNodesByAttributes } from "@/services/swarm/api/nodes";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";

type RouteParams = {
  params: Promise<{ slug: string }>;
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

/** Whitelist a raw graph node's properties into the 16-key ProposedFix projection. */
function projectNode(node: {
  ref_id?: string;
  node_id?: string;
  properties?: Record<string, unknown>;
}): ProposedFix {
  const p = node.properties ?? {};
  const str = (v: unknown): string | undefined =>
    v !== undefined && v !== null ? String(v) : undefined;

  return {
    ref_id: str(node.ref_id ?? node.node_id),
    criterion_id: str(p.criterion_id),
    criterion_title: str(p.criterion_title),
    prompt_name: str(p.prompt_name),
    prompt_id: str(p.prompt_id),
    prompt_version_id: str(p.prompt_version_id),
    new_prompt_version_id: str(p.new_prompt_version_id),
    failing_value: str(p.failing_value),
    passing_value: str(p.passing_value),
    delta: str(p.delta),
    reasoning: str(p.reasoning),
    status: str(p.status),
    rerun_status: str(p.rerun_status),
    before_score: str(p.before_score),
    after_score: str(p.after_score),
    score_delta: str(p.score_delta),
    rerun_run_id: str(p.rerun_run_id),
  };
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes
 *
 * Returns a whitelisted projection of `ProposedFix` graph nodes for a legal
 * benchmark run, filtered by `task_slug`. Read-only; no graph mutations.
 *
 * Query params:
 *   - runId (required): the StakworkRun row id to scope the lookup.
 *
 * Gated to the `openlaw` workspace only.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Gate to openlaw workspace only
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const runId = request.nextUrl.searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    // Resolve workspace + swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // IDOR guard — scope the run lookup to this workspace
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: {
          in: [
            StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            StakworkRunType.LEGAL_BENCHMARK_SCORER,
          ],
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // --- Mock branch (development / demo only) ---
    // Placed AFTER the slug gate and IDOR run-resolve so mock data is still
    // subject to workspace scoping.
    if (
      process.env.USE_MOCKS === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const mockFixes: ProposedFix[] = [
        {
          ref_id: "mock-fix-1",
          criterion_id: "crit-1",
          criterion_title: "Accuracy of legal citations",
          prompt_name: "citation_checker_v2",
          prompt_id: "prompt-abc",
          prompt_version_id: "v1.0.0",
          new_prompt_version_id: "v1.1.0",
          failing_value: "The model cited Smith v. Jones (1998) incorrectly.",
          passing_value:
            "The model must cite Smith v. Jones, 142 F.3d 281 (5th Cir. 1998) with correct reporter.",
          delta:
            "Added explicit instruction to include reporter and circuit in citation format.",
          reasoning:
            "The prompt lacked specificity on citation format. The fix adds explicit instructions.",
          status: "proposed",
          rerun_status: "pending",
          before_score: undefined,
          after_score: undefined,
          score_delta: undefined,
          rerun_run_id: undefined,
        },
        {
          ref_id: "mock-fix-2",
          criterion_id: "crit-2",
          criterion_title: "Completeness of contract review",
          prompt_name: "contract_review_v3",
          prompt_id: "prompt-def",
          prompt_version_id: "v2.0.0",
          new_prompt_version_id: "v2.1.0",
          failing_value: "Model missed indemnification clause.",
          passing_value:
            "Model identifies all standard clauses including indemnification, liability cap, and termination.",
          delta:
            "Explicitly enumerated required clauses in the system prompt checklist.",
          reasoning:
            "Without an explicit checklist the model omitted less-prominent clauses.",
          status: "proposed",
          rerun_status: "improved",
          before_score: "50",
          after_score: "54",
          score_delta: "+4",
          rerun_run_id: "rerun-run-789",
        },
      ];
      return NextResponse.json({ fixes: mockFixes });
    }

    // --- Derive task_slug ---
    // parseBenchmarkRunResult only reliably populates taskSlug on RUNNER rows.
    let taskSlug: string | null = null;

    const parsed = parseBenchmarkRunResult(run.result as string | null);
    if (parsed?.taskSlug) {
      taskSlug = parsed.taskSlug;
    } else if (parsed?.siblingRunId) {
      // SCORER run — look up its sibling RUNNER to get taskSlug
      const siblingRun = await db.stakworkRun.findFirst({
        where: {
          id: parsed.siblingRunId,
          workspaceId,
          type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
        },
      });
      if (siblingRun) {
        const siblingParsed = parseBenchmarkRunResult(
          siblingRun.result as string | null,
        );
        taskSlug = siblingParsed?.taskSlug ?? null;
      }
    }

    // Fail closed — no unscoped or empty-value graph query
    if (!taskSlug) {
      return NextResponse.json({ fixes: [] });
    }

    // --- Resolve Jarvis config ---
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      // Swarm not configured for this workspace — return empty rather than error
      return NextResponse.json({ fixes: [] });
    }

    // --- Fetch ProposedFix nodes ---
    const searchResult = await searchNodesByAttributes(jarvisConfig, {
      nodeTypes: ["ProposedFix"],
      filters: [{ attribute: "task_slug", value: taskSlug, comparator: "=" }],
      includeProperties: true,
    });

    if (!searchResult.ok) {
      // Graph query failed — degrade gracefully
      return NextResponse.json({ fixes: [] });
    }

    // Project and sort — surface fixes with a rerun_run_id first (more recent reruns)
    const fixes: ProposedFix[] = (searchResult.nodes ?? [])
      .map((node: { ref_id?: string; node_id?: string; properties?: Record<string, unknown> }) =>
        projectNode(node),
      )
      .sort((a, b) => {
        // Fixes with a rerun_run_id (i.e., a completed rerun) surface first
        const aHas = a.rerun_run_id ? 1 : 0;
        const bHas = b.rerun_run_id ? 1 : 0;
        return bHas - aHas;
      });

    return NextResponse.json({ fixes });
  } catch (error) {
    console.error("[legal/benchmarks/proposed-fixes GET] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
