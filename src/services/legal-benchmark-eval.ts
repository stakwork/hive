/**
 * legal-benchmark-eval.ts
 *
 * Shared service for dispatching a LEGAL_BENCHMARK_EVAL root-cause analysis run.
 * Called by:
 *   - The /eval API route (passes the authenticated caller's userId)
 *   - The legal-recursion-cron (passes the workspace ownerId as userId)
 *
 * When userId is supplied but no per-user Bifrost member key is found, the
 * Bifrost orchestrator falls back to the shared swarm env key. This fallback
 * is named BIFROST_MEMBER_KEY_FALLBACK and is acceptable for cron-initiated
 * evals where no interactive session exists.
 */

import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getApiKeyForModel } from "@/lib/ai/models";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";
const GITHUB_API = "https://api.github.com/repos/stakwork/harvey-labs/contents";
const githubHeaders: HeadersInit = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const TASK_SLUG_RE = /^[a-z0-9_\-\/]+$/i;
const BENCHMARK_MODEL = "claude-opus-4-5";

interface TaskJson {
  title: string;
  instructions: string;
  work_type?: string;
  tags?: string[];
  deliverables?: Record<string, string>;
  criteria?: Array<{ id: string; title: string; match_criteria: string; deliverables?: string[] }>;
}

export interface DispatchEvalParams {
  /** The source runner run ID to evaluate */
  runId: string;
  /** The workspace ID (must match the run's workspaceId) */
  workspaceId: string;
  /** Workspace swarm URL */
  swarmUrl: string;
  /** Workspace swarm secret alias */
  swarmSecretAlias: string | null;
  /** Workspace slug (openlaw) */
  slug: string;
  /**
   * Optional user ID for Bifrost member-key resolution.
   * The /eval route passes the authenticated caller's ID.
   * The cron passes the workspace ownerId.
   * When no per-user member key is found (BIFROST_MEMBER_KEY_FALLBACK),
   * the Bifrost orchestrator falls back to the shared swarm env key.
   */
  userId?: string;
}

export interface DispatchEvalResult {
  evalRunId: string;
  projectId: number | null;
}

/**
 * Dispatches a LEGAL_BENCHMARK_EVAL Stakwork workflow for a source run's
 * failed criteria. Creates a StakworkRun row, builds the webhook URL,
 * assembles the payload (including Harvey task inputs and Bifrost LLM creds),
 * and fires to Stakwork.
 *
 * Throws a sanitized Error (stripped of apiKey / swarm_secret_alias / Bifrost
 * headers) on unrecoverable failure so callers can surface a clean message.
 */
export async function dispatchLegalBenchmarkEvalRun(
  params: DispatchEvalParams,
): Promise<DispatchEvalResult> {
  const { runId, workspaceId, swarmUrl, swarmSecretAlias, slug, userId } = params;

  // ── Step 1: Fetch source run ─────────────────────────────────────────────
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
    throw new Error("Run not found");
  }

  // ── Step 2: Must be a RUNNER run ─────────────────────────────────────────
  if (sourceRun.type !== StakworkRunType.LEGAL_BENCHMARK_RUNNER) {
    throw new Error("Source run is not a LEGAL_BENCHMARK_RUNNER");
  }

  // ── Step 3: Parse result and get failed criteria ─────────────────────────
  const runResult = parseBenchmarkRunResult(sourceRun.result);
  const criteriaResults = runResult?.criteria_results ?? [];
  const failedCriteria = criteriaResults.filter(
    (c) => c.verdict?.toLowerCase() !== "pass",
  );

  if (failedCriteria.length === 0) {
    throw Object.assign(new Error("no_failures"), { code: "NO_FAILURES" });
  }

  if (failedCriteria.some((c) => c.cause_type)) {
    throw Object.assign(new Error("already_ran"), { code: "ALREADY_RAN" });
  }

  // ── Step 4: Check for duplicate active eval ──────────────────────────────
  const activeEvalRun = await db.stakworkRun.findFirst({
    where: {
      workspaceId,
      type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    },
    select: { id: true, result: true },
  });

  if (activeEvalRun) {
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
      throw Object.assign(new Error("ACTIVE_EVAL_RUN_EXISTS"), { code: "ACTIVE_EVAL_RUN_EXISTS" });
    }
  }

  // ── Step 5: Derive agent host — hard-fail if empty ──────────────────────
  const agentHost = transformSwarmUrlToRepo2Graph(swarmUrl);
  if (!agentHost) {
    throw Object.assign(new Error("SWARM_URL_MISSING"), { code: "SWARM_URL_MISSING" });
  }

  // ── Step 6: Eval workflow config guard ───────────────────────────────────
  if (!optionalEnvVars.STAKWORK_HARVEY_EVAL_WORKFLOW_ID) {
    throw Object.assign(new Error("EVAL_WORKFLOW_NOT_CONFIGURED"), {
      code: "EVAL_WORKFLOW_NOT_CONFIGURED",
    });
  }

  // ── Step 7: Resolve Jarvis graph config ──────────────────────────────────
  const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
  const graphBaseUrl = jarvisConfig?.jarvisUrl ?? "";

  const taskSlug = runResult?.taskSlug ?? "";
  const evalTriggerRef = runResult?.evalTriggerRef;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  // ── Step 8: Resolve Harvey task inputs + Bifrost creds ──────────────────
  let taskGoal = "";
  let taskOutputDesc = "";
  let documents: string[] = [];
  let rubrics: NonNullable<TaskJson["criteria"]> = [];
  let bifrost: Awaited<ReturnType<typeof getBifrostForLLM>> | undefined;

  if (!taskSlug) {
    console.error(
      "[LegalBenchmarkEvalService] taskSlug is empty; skipping Harvey fetch and dispatching with empty rerun inputs",
    );
  } else {
    // Validate taskSlug before URL interpolation (path-traversal guard)
    if (!TASK_SLUG_RE.test(taskSlug)) {
      console.error(
        `[LegalBenchmarkEvalService] taskSlug "${taskSlug}" failed validation; skipping Harvey fetch`,
      );
    } else {
      // Encode each path segment individually
      const encodedSlug = taskSlug.split("/").map(encodeURIComponent).join("/");

      // BIFROST_MEMBER_KEY_FALLBACK: if userId is provided but no member key is
      // found, Bifrost falls back to the shared swarm env key.
      try {
        bifrost = await getBifrostForLLM(
          userId ? { workspaceId, workspaceSlug: slug, userId } : undefined,
          { agentName: "plan-agent", model: BENCHMARK_MODEL },
        );
      } catch (err) {
        console.warn(
          "[LegalBenchmarkEvalService] Bifrost resolution failed, falling back to env key",
          err instanceof Error ? err.message : String(err),
        );
      }

      try {
        const [taskJsonRes, docsRes] = await Promise.all([
          fetch(`${HARVEY_BASE}/tasks/${encodedSlug}/task.json`),
          fetch(`${GITHUB_API}/tasks/${encodedSlug}/documents`, { headers: githubHeaders }),
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
              `[LegalBenchmarkEvalService] Failed to parse task.json for ${taskSlug}`,
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
              `[LegalBenchmarkEvalService] Failed to fetch documents for ${taskSlug}`,
            );
          }
        }
      } catch (err) {
        console.error(
          "[LegalBenchmarkEvalService] Harvey task-input fetch failed; dispatching with empty rerun inputs",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // ── Step 9: Create eval run row ──────────────────────────────────────────
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

  // ── Step 10: Build HMAC run_token ────────────────────────────────────────
  const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
  const runToken = createHmac("sha256", webhookSecret).update(evalRun.id).digest("hex");

  // ── Step 11: Update with real webhook URL ────────────────────────────────
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_EVAL}&run_id=${evalRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;
  await db.stakworkRun.update({
    where: { id: evalRun.id },
    data: { webhookUrl },
  });

  // ── Step 12: Build Stakwork payload ──────────────────────────────────────
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
            swarm_url: agentHost,
            repo2graph_url: agentHost,
            source_project_id: sourceRun.projectId ?? null,
            stakwork_base_url: optionalEnvVars.STAKWORK_BASE_URL.replace(/\/api\/v1\/?$/, ""),
          },
        },
      },
    },
  };

  // ── Step 13: Dispatch to Stakwork ────────────────────────────────────────
  let stakworkResponse: Response;
  try {
    stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
      },
      body: JSON.stringify(payload),
    });
  } catch (fetchErr) {
    // Clean up the eval run row before re-throwing
    await db.stakworkRun.deleteMany({ where: { id: evalRun.id } });
    // Strip secrets from re-thrown error
    throw new Error(
      `Stakwork dispatch network error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    );
  }

  if (!stakworkResponse.ok) {
    await db.stakworkRun.deleteMany({ where: { id: evalRun.id } });
    throw new Error("Failed to dispatch eval job to Stakwork");
  }

  const stakworkData = await stakworkResponse.json();
  const projectId: number | undefined =
    stakworkData?.data?.project_id ?? stakworkData?.project_id;

  // ── Step 14: Update eval run to IN_PROGRESS ──────────────────────────────
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

  return { evalRunId: evalRun.id, projectId: projectId ?? null };
}
