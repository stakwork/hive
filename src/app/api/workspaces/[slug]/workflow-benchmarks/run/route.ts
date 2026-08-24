import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { checkRateLimit } from "@/lib/rate-limit";
import { ensureWorkflowBenchmarkEvalNodes } from "@/lib/workflow-benchmarks/eval-nodes";
import { isBenchmarkWorkspaceAllowed } from "@/lib/workflow-benchmarks/workspace-gate";
import { findBenchmarkTask, CORPUS_SLUGS } from "@/lib/workflow-benchmark-tasks";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { optionalEnvVars } from "@/config/env";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/** 30-minute staleness threshold for active runs. */
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * POST /api/workspaces/[slug]/workflow-benchmarks/run
 *
 * Dispatch a Workflow Editor Benchmark run for a given corpus task.
 * Gated to workspaces where isBenchmarkWorkspaceAllowed returns true.
 *
 * Body: { taskSlug: string }
 * Returns: { run_id: string } with 201 on success.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // ── Step 3: Workspace access (canWrite required; return 404 not 403) ──────
    const access = await validateWorkspaceAccess(slug, userId, true, {});
    if (!access.canWrite) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Step 4: Rate limit — fail CLOSED (503) ────────────────────────────────
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(`benchmark-run:${userId}`, 10, 60);
    } catch {
      return NextResponse.json(
        { error: "Rate limit service unavailable" },
        { status: 503 },
      );
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // ── Step 5: Parse + validate body ────────────────────────────────────────
    let body: { taskSlug?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { taskSlug } = body;
    if (!taskSlug || typeof taskSlug !== "string" || !CORPUS_SLUGS.has(taskSlug)) {
      return NextResponse.json(
        { error: "taskSlug is required and must be a known corpus slug" },
        { status: 400 },
      );
    }

    const task = findBenchmarkTask(taskSlug)!;

    // ── Step 6: Swarm access (return 404 on any failure) ─────────────────────
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { workspaceId } = swarmResult.data;

    // ── Step 7: Jarvis config ─────────────────────────────────────────────────
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json(
        { error: "Swarm not configured for workspace" },
        { status: 503 },
      );
    }

    // ── Step 8: Env check ─────────────────────────────────────────────────────
    const benchmarkWorkflowId = process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID;
    if (!benchmarkWorkflowId) {
      return NextResponse.json(
        { error: "STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID is not configured" },
        { status: 503 },
      );
    }

    // ── Step 9: Atomic single-active-run guard + row creation ─────────────────
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    let run: { id: string };

    try {
      run = await db.$transaction<{ id: string }>(async (tx) => {
        const now = Date.now();

        // Check for an existing active BENCHMARK_RUNNER for this workspace + taskSlug
        const existingRun = await tx.stakworkRun.findFirst({
          where: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true, updatedAt: true },
        });

        if (existingRun) {
          let existingTaskSlug: string | undefined;
          try {
            const resultJson = existingRun.result
              ? (JSON.parse(existingRun.result) as Record<string, unknown>)
              : {};
            existingTaskSlug = resultJson.taskSlug as string | undefined;
          } catch {
            // Malformed result JSON — treat as collision for same task
            existingTaskSlug = taskSlug;
          }

          if (existingTaskSlug === taskSlug) {
            const isStale = existingRun.updatedAt.getTime() < now - STALE_RUN_THRESHOLD_MS;

            if (isStale) {
              // Mark stale run as FAILED so we can proceed
              await tx.stakworkRun.update({
                where: { id: existingRun.id },
                data: {
                  status: WorkflowStatus.FAILED,
                  result: JSON.stringify({
                    ...(() => {
                      try {
                        return existingRun.result
                          ? (JSON.parse(existingRun.result) as Record<string, unknown>)
                          : {};
                      } catch {
                        return {};
                      }
                    })(),
                    staleTimeout: true,
                    reason: "run timed out before webhook arrived",
                  }),
                },
              });
              // Fall through to create a new run
            } else {
              throw Object.assign(
                new Error("A run is already in progress for this task"),
                { code: "ACTIVE_RUN_EXISTS" },
              );
            }
          }
        }

        const newRun = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            userId,
            result: JSON.stringify({ taskSlug, taskTitle: task.title }),
          },
          select: { id: true },
        });

        return newRun;
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

    // ── Step 10 & 11: Build HMAC token + webhook URL ──────────────────────────
    const runToken = createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "")
      .update(run.id)
      .digest("hex");
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.BENCHMARK_RUNNER}&run_id=${run.id}&workspace_id=${workspaceId}&run_token=${runToken}`;

    // ── Step 12: Persist real webhook URL ─────────────────────────────────────
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { webhookUrl },
    });

    // ── Step 13: Graph base URL ───────────────────────────────────────────────
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    // ── Step 14: Build Stakwork payload (NO credentials) ─────────────────────
    const taskVars: Record<string, unknown> = {
      task_slug: task.slug,
      task_title: task.title,
      instructions: task.instructions,
      criteria: JSON.stringify(task.criteria),
      run_id: run.id,
      webhook_url: webhookUrl,
      graph_base_url: graphBaseUrl,
      ...(task.baseline
        ? {
            baseline_workflow_id: task.baseline.workflow_id,
            baseline_workflow_version_id: task.baseline.workflow_version_id,
          }
        : {}),
    };

    const payload = {
      name: `wf-benchmark-${run.id}`,
      workflow_id: parseInt(benchmarkWorkflowId, 10),
      webhook_full_output: false,
      workflow_params: {
        set_var: {
          attributes: {
            vars: taskVars,
          },
        },
      },
    };

    // ── Step 15: Ensure eval nodes — NON-FATAL ────────────────────────────────
    let rosterUpsertOutcome: "ok" | "skipped" | "error" = "skipped";
    try {
      await ensureWorkflowBenchmarkEvalNodes(jarvisConfig, task);
      rosterUpsertOutcome = "ok";
    } catch (err) {
      rosterUpsertOutcome = "error";
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[workflow-benchmarks/run] ensureWorkflowBenchmarkEvalNodes failed (non-fatal): ${message}`,
        "workflow-benchmarks",
        { taskSlug, runId: run.id },
      );
    }

    // ── Step 20: Dispatch-boundary log ────────────────────────────────────────
    logger.info(
      `[workflow-benchmarks/run] dispatching task=${taskSlug} criteria=${task.criteria.length} hasBaseline=${task.baseline !== undefined} rosterUpsert=${rosterUpsertOutcome}`,
      "workflow-benchmarks",
      {
        taskSlug,
        criteriaCount: task.criteria.length,
        hasBaseline: task.baseline !== undefined,
        rosterUpsertOutcome,
        runId: run.id,
      },
    );

    // ── Step 16: Dispatch to Stakwork ─────────────────────────────────────────
    const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
      },
      body: JSON.stringify(payload),
    });

    // ── Step 17: Handle dispatch failure ──────────────────────────────────────
    if (!stakworkResponse.ok) {
      await db.stakworkRun.delete({ where: { id: run.id } });
      return NextResponse.json(
        { error: "Failed to dispatch job to Stakwork" },
        { status: 502 },
      );
    }

    // ── Step 18: Parse project id ─────────────────────────────────────────────
    const stakworkData = (await stakworkResponse.json()) as Record<string, unknown> & {
      data?: { project_id?: number };
      project_id?: number;
    };
    const projectId: number | undefined =
      stakworkData?.data?.project_id ?? stakworkData?.project_id;

    // ── Step 19: Update run with projectId + IN_PROGRESS ─────────────────────
    // Re-read result to merge safely
    const runRow = await db.stakworkRun.findUnique({
      where: { id: run.id },
      select: { result: true },
    });
    let mergedResult: Record<string, unknown> = {};
    try {
      mergedResult = runRow?.result
        ? (JSON.parse(runRow.result) as Record<string, unknown>)
        : {};
    } catch {
      // ignore
    }
    if (projectId !== undefined) {
      mergedResult.projectId = projectId;
    }

    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify(mergedResult),
      },
    });

    // ── Step 21: Return 201 ───────────────────────────────────────────────────
    return NextResponse.json({ run_id: run.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[workflow-benchmarks/run] Unexpected error: ${message}`,
      "workflow-benchmarks",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
