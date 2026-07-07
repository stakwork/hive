import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchHarveyTaskCriteria, ensureHarveyLabEvalNodes } from "@/lib/harvey-lab/eval-nodes";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getApiKeyForModel } from "@/lib/ai/models";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";

type RouteParams = {
  params: Promise<{ slug: string }>;
};

interface TaskJson {
  title: string;
  instructions: string;
  work_type?: string;
  tags?: string[];
  deliverables?: Record<string, string>;
  criteria: Array<{ id: string; title: string; match_criteria: string; deliverables?: string[] }>;
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
 * POST /api/workspaces/[slug]/legal/benchmarks/run
 *
 * Start a Harvey LAB Task Runner workflow for a selected benchmark task.
 * Creates two linked StakworkRun rows (LEGAL_BENCHMARK_RUNNER + LEGAL_BENCHMARK_SCORER)
 * atomically, then dispatches to the Harvey /projects endpoint.
 * Gated to the `openlaw` workspace only.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmSecretAlias } = swarmResult.data;

    if (!swarmSecretAlias) {
      return NextResponse.json(
        { error: "Swarm secret alias not configured" },
        { status: 500 },
      );
    }

    const BENCHMARK_MODEL = "claude-opus-4-5";
    let bifrost: Awaited<ReturnType<typeof getBifrostForLLM>> | undefined;
    try {
      bifrost = await getBifrostForLLM(
        { workspaceId, workspaceSlug: slug, userId: userOrResponse.id },
        { agentName: "plan-agent", model: BENCHMARK_MODEL },
      );
    } catch (err) {
      console.warn(
        "[legal/benchmarks/run] Bifrost resolution failed, falling back to env key",
        err,
      );
    }

    // Parse + validate body
    let body: { taskSlug?: string; taskTitle?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { taskSlug, taskTitle } = body;
    if (!taskSlug || !taskTitle) {
      return NextResponse.json(
        { error: "taskSlug and taskTitle are required" },
        { status: 400 },
      );
    }

    // Validate required env vars before creating the record
    const runnerWorkflowId = process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID;

    if (!runnerWorkflowId) {
      return NextResponse.json(
        { error: "STAKWORK_HARVEY_RUNNER_WORKFLOW_ID is not configured" },
        { status: 500 },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured for workspace" }, { status: 500 });
    }
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    // Pre-fetch task context for Stakwork workflow vars
    let taskGoal = "";
    let taskOutputDesc = "";
    let documents: string[] = [];

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
      } catch {
        console.error(`[legal/benchmarks/run] Failed to parse task.json for ${taskSlug}`);
      }
    }

    if (docsRes.ok) {
      try {
        const docsData = (await docsRes.json()) as Array<{ type: string; name: string }>;
        documents = docsData.filter((f) => f.type === "file").map((f) => f.name);
      } catch {
        console.error(`[legal/benchmarks/run] Failed to fetch documents for ${taskSlug}`);
      }
    }

    // ── Atomic single-active-run guard + pair creation ────────────────────
    // Uses db.$transaction so the findFirst + create pair is race-safe.
    // The partial expression index on (workspace_id, type, result->'taskSlug')
    // WHERE status IN ('PENDING','IN_PROGRESS') (added in T1 migration) makes
    // this check fast even without a UNIQUE constraint.
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    let runnerRun: { id: string };
    let scorerRun: { id: string };

    try {
      const pair = await db.$transaction<{ runner: { id: string }; scorer: { id: string } }>(async (tx) => {
        // Re-check for an existing active LEGAL_BENCHMARK_RUNNER for this task
        const existingRun = await tx.stakworkRun.findFirst({
          where: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true },
        });

        if (existingRun) {
          // Check if this active run is for the same task
          let existingTaskSlug: string | undefined;
          try {
            const resultJson = existingRun.result
              ? (JSON.parse(existingRun.result) as Record<string, unknown>)
              : {};
            existingTaskSlug = resultJson.taskSlug as string | undefined;
          } catch {
            // Malformed result JSON — treat as a collision to be safe
            existingTaskSlug = taskSlug;
          }
          if (existingTaskSlug === taskSlug) {
            throw Object.assign(new Error("A run is already in progress for this task"), {
              code: "ACTIVE_RUN_EXISTS",
            });
          }
        }

        // Build a placeholder webhook URL (will be overwritten after we have the ID below,
        // but the DB requires a non-null value — use a temp value here)
        const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

        // Create scorer first so we have its id to store in runner's result
        const scorer = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_SCORER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            // result will be updated once we have the runner id
          },
          select: { id: true },
        });

        const runnerResultJson: Record<string, unknown> = {
          taskSlug,
          taskTitle,
          siblingRunId: scorer.id,
          // evalTriggerRef will be added later (non-fatal Jarvis step)
        };

        const runner = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            result: JSON.stringify(runnerResultJson),
          },
          select: { id: true },
        });

        // Back-fill scorer's result with siblingRunId pointing to runner
        const scorerResultJson: Record<string, unknown> = {
          taskSlug,
          taskTitle,
          siblingRunId: runner.id,
        };
        await tx.stakworkRun.update({
          where: { id: scorer.id },
          data: { result: JSON.stringify(scorerResultJson) },
        });

        return { runner, scorer };
      });

      runnerRun = pair.runner;
      scorerRun = pair.scorer;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as Error & { code?: string }).code === "ACTIVE_RUN_EXISTS"
      ) {
        return NextResponse.json(
          { error: "A run is already in progress for this task" },
          { status: 409 },
        );
      }
      throw err;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Build correct webhook URL now that we have the runner id, then update the row
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&run_id=${runnerRun.id}&workspace_id=${workspaceId}`;
    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: { webhookUrl },
    });

    const payload = {
      name: `harvey-runner-${runnerRun.id}`,
      workflow_id: parseInt(runnerWorkflowId, 10),
      webhook_url: webhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              task_slug: taskSlug,
              task_goal: taskGoal,
              task_output_desc: taskOutputDesc,
              documents_json: JSON.stringify(documents),
              webhook_url: webhookUrl,
              graph_base_url: graphBaseUrl,
              swarm_secret_alias: swarmSecretAlias,
              secret: swarmSecretAlias,
              model: BENCHMARK_MODEL,
              apiKey: bifrost?.apiKey ?? getApiKeyForModel(BENCHMARK_MODEL) ?? "",
              baseUrl: bifrost?.baseUrl ?? "",
              ...(bifrost && Object.keys(bifrost.headers).length > 0
                ? { headers: bifrost.headers }
                : {}),
              tokenReference: getStakworkTokenReference(),
            },
          },
        },
      },
    };

    const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
      },
      body: JSON.stringify(payload),
    });

    if (!stakworkResponse.ok) {
      // Clean up both PENDING rows so retries are not blocked
      await db.stakworkRun.deleteMany({
        where: { id: { in: [runnerRun.id, scorerRun.id] } },
      });
      return NextResponse.json(
        { error: "Failed to dispatch job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkResponse.json();
    const projectId: number | undefined =
      stakworkData?.data?.project_id ?? stakworkData?.project_id;

    // Merge projectId into result; preserve existing result fields
    const runnerRow = await db.stakworkRun.findUnique({
      where: { id: runnerRun.id },
      select: { result: true },
    });
    let updatedRunnerResult: Record<string, unknown> = {};
    try {
      updatedRunnerResult = runnerRow?.result
        ? (JSON.parse(runnerRow.result) as Record<string, unknown>)
        : {};
    } catch {
      // ignore parse errors
    }
    if (projectId !== undefined) {
      updatedRunnerResult.runnerProjectId = projectId;
    }

    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify(updatedRunnerResult),
      },
    });

    // ── Non-fatal Jarvis eval graph instrumentation ───────────────────────────
    try {
      if (jarvisConfig) {
        const rubricCriteria = await fetchHarveyTaskCriteria(taskSlug);
        const evalNodes = await ensureHarveyLabEvalNodes(
          jarvisConfig,
          taskSlug,
          taskTitle,
          rubricCriteria,
        );
        if (evalNodes) {
          const triggerId = randomUUID();
          const triggerResult = await addNode(jarvisConfig, {
            node_type: "EvalTrigger",
            node_data: {
              id: triggerId,
              agent: "wfe-agent",
              source: "provider_direct",
              environment: process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID,
              start_point: taskSlug,
              end_point: taskSlug,
              body: JSON.stringify({
                prompt_snapshot: { task_slug: taskSlug, task_title: taskTitle, rubric_criteria: rubricCriteria },
                output_snapshot: null,
                tool_call_trace: null,
              }),
            },
          });
          if (triggerResult.success && triggerResult.ref_id) {
            await addEdge(jarvisConfig, {
              edge: { edge_type: "HAS_TRIGGER" },
              source: { ref_id: evalNodes.requirementRef },
              target: { ref_id: triggerResult.ref_id },
            });
            // Store evalTriggerRef in both runner and scorer result JSON
            const mergeEvalTriggerRef = async (runId: string) => {
              const row = await db.stakworkRun.findUnique({
                where: { id: runId },
                select: { result: true },
              });
              let resultJson: Record<string, unknown> = {};
              try {
                resultJson = row?.result
                  ? (JSON.parse(row.result) as Record<string, unknown>)
                  : {};
              } catch { /* ignore */ }
              resultJson.evalTriggerRef = triggerResult.ref_id;
              await db.stakworkRun.update({
                where: { id: runId },
                data: { result: JSON.stringify(resultJson) },
              });
            };
            await mergeEvalTriggerRef(runnerRun.id);
            await mergeEvalTriggerRef(scorerRun.id);

            // Non-fatal ATTRIBUTED_TO (gated on jarvis-backend prereq — skip until deployed)
            try {
              const agentResult = await addNode(jarvisConfig, {
                node_type: "HiveAgent",
                node_data: { name: "wfe-agent", display_name: "Stakwork Workflow Engine" },
              });
              if (agentResult.success) {
                await addEdge(jarvisConfig, {
                  edge: { edge_type: "ATTRIBUTED_TO" },
                  source: { ref_id: triggerResult.ref_id },
                  target: { node_type: "HiveAgent", node_data: { name: "wfe-agent" } },
                });
              }
            } catch { /* ATTRIBUTED_TO not yet registered in jarvis-backend — silently skip */ }
          }
        }
      }
    } catch (err) {
      console.error("[legal/benchmarks/run] Jarvis eval graph write failed (non-fatal):", err);
    }
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ run_id: runnerRun.id }, { status: 201 });
  } catch (error) {
    console.error("[legal/benchmarks/run POST] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
