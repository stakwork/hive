import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getApiKeyForModel } from "@/lib/ai/models";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
};

// Copied verbatim from /run/route.ts — update if that file changes
interface TaskJson {
  title: string;
  instructions: string;
  work_type?: string;
  tags?: string[];
  deliverables?: Record<string, string>;
  criteria?: Array<{ id: string; title: string; match_criteria: string; deliverables?: string[] }>;
}

const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";
const GITHUB_API = "https://api.github.com/repos/stakwork/harvey-labs/contents";
const githubHeaders: HeadersInit = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
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
 * Fetches Harvey LAB task inputs (task.json + documents) and resolves Bifrost LLM creds
 * to build a rerun-capable payload alongside the failure-analysis vars, so the downstream
 * fix-proposal workflow can rerun the source task with a prompt override.
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

    // Base URL reused for both hive_base_url var and the webhook URL below
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    // ── BENCHMARK_MODEL must match /run/route.ts ───────────────────────────────
    const BENCHMARK_MODEL = "claude-opus-4-5"; // must match /run/route.ts

    // ── Rerun inputs: Bifrost LLM creds + Harvey task inputs ──────────────────
    // These let the downstream fix-proposal workflow rerun the source task with a
    // prompt override, keyed by the task_slug already stored on the source run.
    let taskGoal = "";
    let taskOutputDesc = "";
    let documents: string[] = [];
    let rubrics: NonNullable<TaskJson["criteria"]> = [];
    let bifrost: Awaited<ReturnType<typeof getBifrostForLLM>> | undefined;

    if (!taskSlug) {
      console.error(
        "[legal/benchmarks/runs/[runId]/eval] taskSlug is empty; skipping Harvey fetch and dispatching with empty rerun inputs",
      );
    } else {
      // Resolve bifrost with the same try/catch fallback as /run
      try {
        bifrost = await getBifrostForLLM(
          { workspaceId, workspaceSlug: slug, userId: userOrResponse.id },
          { agentName: "plan-agent", model: BENCHMARK_MODEL },
        );
      } catch (err) {
        console.warn(
          "[legal/benchmarks/runs/[runId]/eval] Bifrost resolution failed, falling back to env key",
          err,
        );
      }

      // Fetch Harvey task inputs — wrapped in try/catch so a Harvey/GitHub network
      // failure cannot 500 the eval route; failure-analysis is this route's primary
      // job and must not become coupled to external availability it previously didn't
      // depend on. Degrade to empty rerun vars and let analysis proceed.
      try {
        const [taskJsonRes, docsRes] = await Promise.all([
          fetch(`${HARVEY_BASE}/tasks/${taskSlug}/task.json`),
          fetch(`${GITHUB_API}/tasks/${taskSlug}/documents`, { headers: githubHeaders }),
        ]);

        if (taskJsonRes.ok) {
          try {
            const taskJson = (await taskJsonRes.json()) as TaskJson;
            taskGoal = taskJson.instructions ?? "";
            if (taskJson.deliverables && Object.keys(taskJson.deliverables).length > 0) {
              taskOutputDesc = Object.keys(taskJson.deliverables).join(", ");
            } else {
              const outputMatch = taskGoal.match(/###\s*Output[:\s]+([\s\S]+)$/i);
              taskOutputDesc = outputMatch ? outputMatch[1].trim().replace(/`/g, "") : "";
            }
            rubrics = taskJson.criteria ?? [];
          } catch {
            console.error(
              `[legal/benchmarks/runs/[runId]/eval] Failed to parse task.json for ${taskSlug}`,
            );
          }
        }

        if (docsRes.ok) {
          try {
            const docsData = (await docsRes.json()) as Array<{
              type: string;
              name: string;
              download_url: string | null;
            }>;
            documents = docsData
              .filter((f) => f.type === "file" && f.download_url !== null)
              .map((f) => f.download_url as string);
          } catch {
            console.error(
              `[legal/benchmarks/runs/[runId]/eval] Failed to fetch documents for ${taskSlug}`,
            );
          }
        }
      } catch (err) {
        console.error(
          "[legal/benchmarks/runs/[runId]/eval] Harvey task-input fetch failed; dispatching rerun vars empty",
          err,
        );
      }
    }

    // Step 10: Create the eval run row
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
              // ── Existing 10 analysis vars (unchanged) ─────────────────────
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
              // ── New rerun vars ─────────────────────────────────────────────
              task_goal: taskGoal,
              task_output_desc: taskOutputDesc,
              rubrics_json: JSON.stringify(rubrics),
              documents_json: JSON.stringify(documents),
              model: BENCHMARK_MODEL,
              apiKey: bifrost?.apiKey ?? getApiKeyForModel(BENCHMARK_MODEL) ?? "",
              baseUrl: bifrost?.baseUrl ?? "",
              ...(bifrost && Object.keys(bifrost.headers).length > 0
                ? { headers: bifrost.headers }
                : {}),
              tokenReference: getStakworkTokenReference(),
              hive_base_url: baseUrl,
              // Normalize: STAKWORK_BASE_URL ends in /api/v1 in production; the child
              // appends /api/v1/projects so we strip the trailing segment to avoid
              // a doubled /api/v1/api/v1/projects path.
              stakwork_base_url: optionalEnvVars.STAKWORK_BASE_URL.replace(/\/api\/v1\/?$/, ""),
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
