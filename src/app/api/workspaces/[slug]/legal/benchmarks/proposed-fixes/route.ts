import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { searchNodesByAttributes } from "@/services/swarm/api/nodes";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import type { ProposedFix } from "@/types/legal";

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
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * Map a raw graph node's properties into the whitelisted ProposedFix projection.
 * Tolerates any missing key (returns null for it) — never leaks unexpected node data.
 */
function projectFix(refId: string, props: Record<string, unknown> | undefined): ProposedFix {
  const p = props ?? {};
  const str = (key: string): string | null => {
    const v = p[key];
    return v != null ? String(v) : null;
  };
  return {
    ref_id: refId,
    criterion_id: str("criterion_id"),
    criterion_title: str("criterion_title"),
    prompt_name: str("prompt_name"),
    prompt_id: str("prompt_id"),
    prompt_version_id: str("prompt_version_id"),
    new_prompt_version_id: str("new_prompt_version_id"),
    failing_value: str("failing_value"),
    passing_value: str("passing_value"),
    delta: str("delta"),
    reasoning: str("reasoning"),
    eval_status: str("eval_status"),
    status: str("status"),
    rerun_status: str("rerun_status"),
    before_score: str("before_score"),
    after_score: str("after_score"),
    score_delta: str("score_delta"),
    rerun_run_id: str("rerun_run_id"),
    resolved_by: str("resolved_by"),
    resolved_at: str("resolved_at"),
  };
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes
 *
 * Returns ProposedFix graph nodes for a legal-benchmark run, scoped to the
 * caller's workspace. Read-only — no graph mutations.
 *
 * Gated to the `openlaw` workspace only.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    // Step 1: Gate to openlaw workspace only
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 2: Resolve workspace swarm access (provides workspaceId)
    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // Step 3: Validate runId query param
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId query param is required" }, { status: 400 });
    }

    // Step 4: IDOR guard — resolve run scoped to this workspace
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: {
          in: [StakworkRunType.LEGAL_BENCHMARK_RUNNER, StakworkRunType.LEGAL_BENCHMARK_SCORER],
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Step 5: USE_MOCKS branch — only in non-production, placed after slug + run checks
    if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
      const mockFixes: ProposedFix[] = [
        {
          ref_id: "mock-fix-1",
          criterion_id: "criterion-1",
          criterion_title: "Citation Accuracy",
          prompt_name: "citation_verifier_v2",
          prompt_id: "prompt-abc",
          prompt_version_id: "v2.1",
          new_prompt_version_id: "v2.2",
          failing_value: "The court held in Smith v. Jones (2018)...",
          passing_value: "The court held in Smith v. Jones, 123 F.3d 456 (9th Cir. 2018)...",
          delta: "Added full citation format with reporter and circuit information",
          reasoning:
            "The original prompt did not instruct the model to include reporter citations, causing incomplete legal references.",
          status: "pending",
          rerun_status: "pending",
          before_score: undefined,
          after_score: undefined,
          score_delta: undefined,
          rerun_run_id: undefined,
        },
        {
          ref_id: "mock-fix-2",
          criterion_id: "criterion-2",
          criterion_title: "Argument Completeness",
          prompt_name: "argument_builder_v3",
          prompt_id: "prompt-def",
          prompt_version_id: "v3.0",
          new_prompt_version_id: "v3.1",
          failing_value: "50",
          passing_value: "54",
          delta: "Enhanced prompt to require explicit counter-argument analysis",
          reasoning:
            "The model missed the counter-argument section. New version explicitly instructs inclusion.",
          status: "pending",
          rerun_status: "improved",
          before_score: "50",
          after_score: "54",
          score_delta: "+4",
          rerun_run_id: "rerun-run-mock-1",
        },
      ];
      return NextResponse.json({ fixes: mockFixes });
    }

    // Step 6: Derive task_slug safely
    let taskSlug: string | null | undefined = null;

    const runResult = parseBenchmarkRunResult(run.result);
    taskSlug = runResult?.taskSlug;

    // If this is a SCORER run (or taskSlug is missing), try to resolve via sibling runner
    if (!taskSlug && runResult?.siblingRunId) {
      const siblingRun = await db.stakworkRun.findFirst({
        where: {
          id: runResult.siblingRunId,
          workspaceId,
          type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
        },
      });
      if (siblingRun) {
        const siblingResult = parseBenchmarkRunResult(siblingRun.result);
        taskSlug = siblingResult?.taskSlug;
      }
    }

    // Fail closed: if we still have no taskSlug, return empty rather than issuing an unscoped query
    if (!taskSlug) {
      return NextResponse.json({ fixes: [] });
    }

    // Step 7: Resolve Jarvis connection config
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ fixes: [] });
    }

    // Step 8: Fetch ProposedFix nodes filtered by task_slug
    const searchResult = await searchNodesByAttributes(jarvisConfig, {
      nodeTypes: ["ProposedFix"],
      filters: [{ attribute: "task_slug", value: taskSlug, comparator: "=" }],
      includeProperties: true,
    });

    if (!searchResult.ok) {
      return NextResponse.json({ fixes: [] });
    }

    // Step 9: Project to whitelisted shape, filter rejected fixes, sort with rerun_run_id-present entries first
    const fixes: ProposedFix[] = searchResult.nodes
      .map((node) => projectFix(node.ref_id, node.properties))
      // Exclude only explicitly-rejected fixes; pending/accepted/untagged remain visible
      .filter((f) => f.status !== "rejected")
      .sort((a, b) => {
        // Entries with a rerun_run_id (more recent reruns) surface first
        const aHas = a.rerun_run_id != null ? 1 : 0;
        const bHas = b.rerun_run_id != null ? 1 : 0;
        return bHas - aHas;
      });

    return NextResponse.json({ fixes });
  } catch (error) {
    console.error("[proposed-fixes] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
