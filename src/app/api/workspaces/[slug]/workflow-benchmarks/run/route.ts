import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import {
  getApiKeyForModel,
  isValidModel,
  DEFAULT_BENCHMARK_MODEL,
  DEFAULT_JUDGE_MODEL,
} from "@/lib/ai/models";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { WorkflowStatus, StakworkRunType, WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getWorkflowBenchmarkTask } from "@/lib/workflow-benchmark/corpus";
import { hasRoleLevel } from "@/lib/auth/roles";
import { isDevelopmentMode } from "@/lib/runtime";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/** Strip the "provider/" prefix to get the bare model name. */
function bareModelName(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}

/** Allowed slug pattern for workflow benchmark tasks. */
const TASK_SLUG_RE = /^wfbench\/[a-z0-9_\-/]+$/i;

/** Allowed workspace slugs for this feature. */
const ALLOWED_SLUGS = ["stakwork"];

/**
 * POST /api/workspaces/[slug]/workflow-benchmarks/run
 *
 * Dispatch a Stakwork Workflow Benchmark run.
 * Creates a single BENCHMARK_RUNNER StakworkRun row, then dispatches to Stakwork.
 * Gated to the `stakwork` workspace (or dev mode).
 * Requires DEVELOPER+ role (canWrite).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;

    // Workspace gate
    if (!ALLOWED_SLUGS.includes(slug) && !isDevelopmentMode()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Auth + workspace access
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireMemberAccess(access);
    if (member instanceof NextResponse) return member;

    // canWrite check (DEVELOPER+)
    if (!hasRoleLevel(member.role, WorkspaceRole.DEVELOPER)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { workspaceId, userId } = member;

    // Parse body
    let body: {
      taskSlug?: string;
      model?: string;
      judgeModel?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { taskSlug } = body;
    if (!taskSlug) {
      return NextResponse.json({ error: "taskSlug is required" }, { status: 400 });
    }

    if (typeof taskSlug !== "string" || !TASK_SLUG_RE.test(taskSlug)) {
      return NextResponse.json({ error: "Invalid taskSlug" }, { status: 400 });
    }

    // Resolve task from corpus
    const task = getWorkflowBenchmarkTask(taskSlug);
    if (!task) {
      return NextResponse.json({ error: "Unknown taskSlug" }, { status: 404 });
    }

    // Model validation
    const model = body.model ?? DEFAULT_BENCHMARK_MODEL;
    const judgeModel = body.judgeModel ?? DEFAULT_JUDGE_MODEL;

    if (!isValidModel(model)) {
      return NextResponse.json({ error: `Invalid model: "${model}"` }, { status: 400 });
    }
    if (!isValidModel(judgeModel)) {
      return NextResponse.json({ error: `Invalid judgeModel: "${judgeModel}"` }, { status: 400 });
    }

    const bareModel = bareModelName(model);
    const bareJudgeModel = bareModelName(judgeModel);

    // Workflow ID
    const workflowId = process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID;
    if (!workflowId) {
      return NextResponse.json(
        { error: "STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID is not configured" },
        { status: 500 },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);

    // ── Atomic single-active-run guard (scoped by type + taskSlug) ───────────
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    const taskTitle = task.title;

    let runRow: { id: string };
    try {
      runRow = await db.$transaction<{ id: string }>(async (tx) => {
        // Re-check for an existing active BENCHMARK_RUNNER for this specific task slug
        const existingRuns = await tx.stakworkRun.findMany({
          where: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true },
        });

        for (const existing of existingRuns) {
          let existingTaskSlug: string | undefined;
          try {
            const parsed = existing.result
              ? (JSON.parse(existing.result) as Record<string, unknown>)
              : {};
            existingTaskSlug = parsed.taskSlug as string | undefined;
          } catch {
            existingTaskSlug = taskSlug;
          }
          if (existingTaskSlug === taskSlug) {
            throw Object.assign(new Error("A run is already in progress for this task"), {
              code: "ACTIVE_RUN_EXISTS",
            });
          }
        }

        const resultJson: Record<string, unknown> = {
          taskSlug,
          taskTitle,
          requestedModel: bareModel,
          requestedJudgeModel: bareJudgeModel,
        };

        const row = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            userId,
            result: JSON.stringify(resultJson),
          },
          select: { id: true },
        });
        return row;
      });
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

    // Build webhook URL with HMAC token now that we have the run id
    const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
    const runToken = createHmac("sha256", webhookSecret).update(runRow.id).digest("hex");
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.BENCHMARK_RUNNER}&run_id=${runRow.id}&workspace_id=${workspaceId}&run_token=${runToken}`;
    await db.stakworkRun.update({
      where: { id: runRow.id },
      data: { webhookUrl },
    });

    // Status webhook (lightweight lifecycle callbacks)
    const statusWebhookUrl = `${baseUrl}/api/stakwork/webhook?run_id=${runRow.id}`;

    // Resolve API key
    const apiKey = getApiKeyForModel(model) ?? "";

    const rubricCriteria = task.criteria.map((c) => c.match_criteria);
    const rubricsJson = JSON.stringify(task.criteria);

    const payload = {
      name: `wfbench-runner-${runRow.id}`,
      workflow_id: parseInt(workflowId, 10),
      webhook_url: statusWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              task_slug: taskSlug,
              task_title: taskTitle,
              task_description: task.description,
              rubrics_json: rubricsJson,
              webhook_url: webhookUrl,
              model: bareModel,
              judge_model: bareJudgeModel,
              apiKey,
              tokenReference: getStakworkTokenReference(),
              workspace_id: workspaceId,
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
      await db.stakworkRun.deleteMany({ where: { id: runRow.id } });
      return NextResponse.json(
        { error: "Failed to dispatch job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkResponse.json();
    const projectId: number | undefined =
      stakworkData?.data?.project_id ?? stakworkData?.project_id;

    await db.stakworkRun.update({
      where: { id: runRow.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({
          taskSlug,
          taskTitle,
          requestedModel: bareModel,
          requestedJudgeModel: bareJudgeModel,
          ...(projectId !== undefined ? { runnerProjectId: projectId } : {}),
        }),
      },
    });

    // ── Non-fatal Jarvis eval graph instrumentation ───────────────────────────
    if (jarvisConfig) {
      try {
        // Upsert EvalSet for this task slug
        const evalSetResult = await addNode(jarvisConfig, {
          node_type: "EvalSet",
          node_data: {
            id: taskSlug,
            name: taskTitle,
            description: task.description,
          },
        });

        if (evalSetResult.success && evalSetResult.ref_id) {
          const evalSetRefId = evalSetResult.ref_id;

          // Upsert one EvalRequirement per criterion
          for (const criterion of task.criteria) {
            const reqResult = await addNode(jarvisConfig, {
              node_type: "EvalRequirement",
              node_data: {
                id: criterion.id,
                name: criterion.title,
                desirable_cases: [criterion.match_criteria],
                undesirable_cases: [],
              },
            });
            if (reqResult.success && reqResult.ref_id) {
              await addEdge(jarvisConfig, {
                edge: { edge_type: "HAS_REQUIREMENT" },
                source: { ref_id: evalSetRefId },
                target: { ref_id: reqResult.ref_id },
              });
            }
          }

          // Write EvalTrigger node
          const triggerResult = await addNode(jarvisConfig, {
            node_type: "EvalTrigger",
            node_data: {
              id: runRow.id,
              agent: "workflow-benchmark-agent",
              source: "provider_direct",
              environment: workflowId,
              start_point: taskSlug,
              end_point: taskSlug,
              body: JSON.stringify({
                prompt_snapshot: {
                  task_slug: taskSlug,
                  task_title: taskTitle,
                  rubric_criteria: rubricCriteria,
                },
                output_snapshot: null,
              }),
            },
          });

          if (triggerResult.success && triggerResult.ref_id) {
            await addEdge(jarvisConfig, {
              edge: { edge_type: "HAS_TRIGGER" },
              source: { ref_id: evalSetRefId },
              target: { ref_id: triggerResult.ref_id },
            });

            // Store evalTriggerRef in result
            await db.stakworkRun.update({
              where: { id: runRow.id },
              data: {
                result: JSON.stringify({
                  taskSlug,
                  taskTitle,
                  requestedModel: bareModel,
                  requestedJudgeModel: bareJudgeModel,
                  ...(projectId !== undefined ? { runnerProjectId: projectId } : {}),
                  evalTriggerRef: triggerResult.ref_id,
                }),
              },
            });
          }
        }
      } catch (err) {
        logger.warn(
          "[workflow-benchmarks/run] Jarvis eval graph write failed (non-fatal)",
          "workflow-benchmarks",
          { runId: runRow.id, error: String(err) },
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ run_id: runRow.id }, { status: 201 });
  } catch (error) {
    logger.error(
      "[workflow-benchmarks/run POST] Unexpected error",
      "workflow-benchmarks",
      { error: String(error) },
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
