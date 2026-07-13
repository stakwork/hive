import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";

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
 * Dispatch a root-cause eval run for a completed legal benchmark run.
 * Gated to the `openlaw` workspace only.
 * Simpler than the runner route — no Harvey task.json fetch, no Bifrost/LLM creds,
 * no Jarvis EvalTrigger write.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, runId } = await params;

    // Step 1: Gate to openlaw workspace only
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Step 2: Resolve workspace swarm access
    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmSecretAlias } = swarmResult.data;

    // Step 3: Fetch the source runner run (IDOR-guarded by workspaceId)
    const sourceRun = await db.stakworkRun.findUnique({
      where: { id: runId, workspaceId },
      include: {
        agentLogs: {
          select: {
            blobUrl: true,
            sessionId: true,
            stats: true,
            phoenixTraceUrl: true,
            metadata: true,
          },
        },
      },
    });

    if (!sourceRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Step 4: Guard — must be a RUNNER run
    if (sourceRun.type !== StakworkRunType.LEGAL_BENCHMARK_RUNNER) {
      return NextResponse.json(
        { error: "Source run is not a LEGAL_BENCHMARK_RUNNER" },
        { status: 400 },
      );
    }

    // Step 5: Parse result and filter failed criteria
    const runResult = parseBenchmarkRunResult(sourceRun.result);
    const criteriaResults = runResult?.criteria_results ?? [];
    const failedCriteria = criteriaResults.filter(
      (c) => c.verdict?.toLowerCase() !== "pass",
    );

    // Step 6: Skip if no failures
    if (failedCriteria.length === 0) {
      return NextResponse.json({ skipped: true, reason: "no_failures" }, { status: 200 });
    }

    // Step 7: Skip if eval has already run (any failed criterion already has cause_type)
    if (failedCriteria.some((c) => c.cause_type)) {
      return NextResponse.json({ skipped: true, reason: "already_ran" }, { status: 200 });
    }

    // Step 8: Check for an active eval run for this source run
    const activeEvalRun = await db.stakworkRun.findFirst({
      where: {
        workspaceId,
        type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
        status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
      },
      select: { id: true, result: true },
    });

    if (activeEvalRun) {
      // Check if this active eval references the same source run
      let activeSourceRunId: string | undefined;
      try {
        const activeResult = activeEvalRun.result
          ? (JSON.parse(activeEvalRun.result) as Record<string, unknown>)
          : {};
        activeSourceRunId = activeResult.sourceRunId as string | undefined;
      } catch {
        activeSourceRunId = runId;
      }
      if (activeSourceRunId === runId) {
        return NextResponse.json(
          { error: "ACTIVE_EVAL_RUN_EXISTS" },
          { status: 409 },
        );
      }
    }

    // Step 9: Guard — eval workflow must be configured
    if (!optionalEnvVars.STAKWORK_HARVEY_EVAL_WORKFLOW_ID) {
      return NextResponse.json(
        { error: "EVAL_WORKFLOW_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    // Resolve Jarvis graph config for graph_base_url
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    const graphBaseUrl = jarvisConfig?.jarvisUrl ?? "";

    const taskSlug = runResult?.taskSlug ?? "";
    const evalTriggerRef = runResult?.evalTriggerRef;

    // Step 10: Create the eval run row
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    const evalRun = await db.stakworkRun.create({
      data: {
        workspaceId,
        type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
        status: WorkflowStatus.PENDING,
        webhookUrl: placeholder,
        result: JSON.stringify({
          sourceRunId: runId,
          taskSlug,
          failedCriteriaCount: failedCriteria.length,
          evalTriggerRef,
        }),
      },
      select: { id: true },
    });

    // Step 11: Build HMAC run_token
    const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
    const runToken = createHmac("sha256", webhookSecret).update(evalRun.id).digest("hex");

    // Step 12: Update with real webhook URL
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_EVAL}&run_id=${evalRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;
    await db.stakworkRun.update({
      where: { id: evalRun.id },
      data: { webhookUrl },
    });

    // Step 13: Build Stakwork payload
    const agentLogsJson = sourceRun.agentLogs.map((log) => {
      const stats = log.stats as Record<string, unknown> | null;
      return {
        blobUrl: log.blobUrl,
        sessionId: log.sessionId,
        preview: stats?.conversationPreview ?? null,
        traceUrl: log.phoenixTraceUrl ?? null,
        metadata: log.metadata ?? null,
      };
    });

    const payload = {
      name: `harvey-eval-${evalRun.id}`,
      workflow_id: parseInt(optionalEnvVars.STAKWORK_HARVEY_EVAL_WORKFLOW_ID, 10),
      webhook_url: webhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              source_run_id: runId,
              task_slug: taskSlug,
              failed_criteria_json: JSON.stringify(failedCriteria),
              full_result_json: JSON.stringify(runResult),
              agent_logs_json: JSON.stringify(agentLogsJson),
              eval_trigger_ref: evalTriggerRef ?? "",
              graph_base_url: graphBaseUrl,
              swarm_secret_alias: swarmSecretAlias ?? "",
              workspace_id: workspaceId,
              webhook_url: webhookUrl,
            },
          },
        },
      },
    };

    // Step 14: Dispatch to Stakwork
    const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
      },
      body: JSON.stringify(payload),
    });

    // Step 15: Non-ok → clean up and return 502
    if (!stakworkResponse.ok) {
      await db.stakworkRun.deleteMany({ where: { id: evalRun.id } });
      return NextResponse.json(
        { error: "Failed to dispatch eval job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkResponse.json();
    const projectId: number | undefined =
      stakworkData?.data?.project_id ?? stakworkData?.project_id;

    // Step 16: Update eval run to IN_PROGRESS with projectId
    const currentResult = await db.stakworkRun.findUnique({
      where: { id: evalRun.id },
      select: { result: true },
    });
    let updatedResult: Record<string, unknown> = {};
    try {
      updatedResult = currentResult?.result
        ? (JSON.parse(currentResult.result) as Record<string, unknown>)
        : {};
    } catch {
      // ignore
    }
    if (projectId !== undefined) {
      updatedResult.projectId = projectId;
    }

    await db.stakworkRun.update({
      where: { id: evalRun.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify(updatedResult),
      },
    });

    // Step 17: Return 201 with evalRunId
    return NextResponse.json({ evalRunId: evalRun.id }, { status: 201 });
  } catch (error) {
    console.error("[legal/benchmarks/runs/[runId]/eval POST] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
