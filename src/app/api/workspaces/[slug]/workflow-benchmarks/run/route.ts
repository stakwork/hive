import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { checkRateLimit } from "@/lib/rate-limit";
import { ensureWorkflowBenchmarkEvalNodes } from "@/lib/workflow-benchmarks/eval-nodes";
import { isBenchmarkWorkspaceAllowed } from "@/lib/workflow-benchmarks/workspace-gate";
import {
  findBenchmarkTask,
  CORPUS_SLUGS,
  WORKFLOW_INPUT_VAR,
  RERUN_EXPECTED_OUTPUT_VAR,
} from "@/lib/workflow-benchmark-tasks";
import { findExpectedOutput } from "@/lib/workflow-benchmarks/expected-output-lookup.server";
import { criteriaFingerprint } from "@/lib/workflow-benchmarks/task-schema";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { optionalEnvVars } from "@/config/env";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/** 30-minute staleness threshold for active runs. */
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Minimum acceptable length (bytes, as a UTF-8 string) for NEXTAUTH_SECRET
 * before we trust it to sign a run_token. A missing OR too-short secret must
 * never silently degrade to a forgeable token — see Step 10.
 */
const MIN_RUN_TOKEN_SECRET_LENGTH = 32;

/**
 * Bound on how many candidate active-run rows we scan per dispatch. Without
 * a bound, every active BENCHMARK_RUNNER row (including accumulated
 * malformed rows that never got marked stale) would be loaded and
 * JSON-parsed inside the transaction on every dispatch.
 */
/** Where a benchmark run executes. Absent in a request body = "stakwork". */
type BenchmarkRunner = "stakwork" | "vein";
const BENCHMARK_RUNNERS: ReadonlySet<string> = new Set<BenchmarkRunner>(["stakwork", "vein"]);

const ACTIVE_RUN_SCAN_LIMIT = 25;

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
    let body: { taskSlug?: string; runner?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { taskSlug } = body;
    // Runner toggle — ADDITIVE. Absent means stakwork (every existing caller);
    // "vein" dispatches the same task to the workspace swarm's vein lab
    // (stakgraph :3355, `wfbench-run` — the 58313 twin) instead of a Stakwork
    // project. Roster upsert, webhook URL/HMAC, receiver and scoring are
    // shared: the vein harness posts the same flat score body.
    const runner: BenchmarkRunner = body.runner === undefined ? "stakwork" : (body.runner as BenchmarkRunner);
    if (!BENCHMARK_RUNNERS.has(runner)) {
      return NextResponse.json(
        { error: 'runner must be "stakwork" or "vein"' },
        { status: 400 },
      );
    }
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
    const { workspaceId, swarmUrl, swarmApiKey } = swarmResult.data;
    if (runner === "vein" && (!swarmUrl || !swarmApiKey)) {
      return NextResponse.json(
        { error: "Swarm not configured for the vein runner" },
        { status: 503 },
      );
    }

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
    if (runner === "stakwork" && !benchmarkWorkflowId) {
      return NextResponse.json(
        { error: "STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID is not configured" },
        { status: 503 },
      );
    }

    // ── Step 9a: HMAC secret hardening — check BEFORE any DB write ───────────
    // A missing or short secret must 503, never silently sign a forgeable
    // token with an empty/weak key. Checked ahead of the active-run guard so
    // we never create a run row we then can't safely issue a webhook URL for.
    const webhookSecret = process.env.NEXTAUTH_SECRET;
    if (!webhookSecret || webhookSecret.length < MIN_RUN_TOKEN_SECRET_LENGTH) {
      logger.error(
        "[workflow-benchmarks/run] NEXTAUTH_SECRET missing or too short — refusing to issue a run_token",
        "workflow-benchmarks",
      );
      return NextResponse.json(
        { error: "Service misconfigured: webhook signing secret unavailable" },
        { status: 503 },
      );
    }

    // ── Step 9b: Atomic single-active-run guard + row creation ────────────────
    // ADVISORY ONLY: this transaction takes no row lock, and no unique index
    // can enforce single-active-run-per-taskSlug because taskSlug lives inside
    // serialized `result` JSON rather than a column. A concurrent dispatch
    // landing between this read and the create() below can still race through.
    // Follow-up: add a `taskSlug` column + partial unique index over active
    // statuses (with backfill) — filed as a linked ticket in the PR, not
    // implemented here; that migration is the only change that removes the
    // JSON scan, the malformed-row dilemma below, and this residual TOCTOU
    // together.
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    let run: { id: string };

    try {
      run = await db.$transaction<{ id: string }>(async (tx) => {
        const now = Date.now();

        // Bounded scan of active BENCHMARK_RUNNER rows for this workspace,
        // newest first. findFirst (no taskSlug filter, no orderBy) was
        // insufficient: taskSlug lives inside serialized `result` JSON, so
        // with more than one corpus task the single row returned may belong
        // to a DIFFERENT task and the guard would silently fall through.
        const candidates = await tx.stakworkRun.findMany({
          where: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: ACTIVE_RUN_SCAN_LIMIT,
        });

        for (const candidate of candidates) {
          let candidateTaskSlug: string | undefined;
          let malformed = false;
          try {
            const resultJson = candidate.result
              ? (JSON.parse(candidate.result) as Record<string, unknown>)
              : {};
            candidateTaskSlug = resultJson.taskSlug as string | undefined;
          } catch {
            malformed = true;
          }

          const isStale = candidate.updatedAt.getTime() < now - STALE_RUN_THRESHOLD_MS;

          if (malformed) {
            // A malformed row's owning task slug is, by definition, unknown.
            // It may only collide with a new dispatch WHILE within the
            // staleness window (age-based) — past that window it is simply
            // ignored. It must NEVER be written to / stale-marked here: doing
            // so could let a dispatch for task A mutate task B's run row,
            // since we cannot tell which task actually owns it.
            if (!isStale) {
              logger.error(
                `[workflow-benchmarks/run] Encountered a malformed active run row while checking for collisions`,
                "workflow-benchmarks",
                { runId: candidate.id, taskSlug },
              );
              throw Object.assign(
                new Error("A run is already in progress for this task"),
                { code: "ACTIVE_RUN_EXISTS" },
              );
            }
            // Past staleness — ignore this malformed row entirely (never
            // written to) and keep scanning other candidates.
            continue;
          }

          if (candidateTaskSlug !== taskSlug) {
            // Different task — does not block this dispatch.
            continue;
          }

          if (isStale) {
            // Mark stale run as FAILED so we can proceed. Safe to write:
            // we've already confirmed this row's own taskSlug via a
            // successful parse above.
            await tx.stakworkRun.update({
              where: { id: candidate.id },
              data: {
                status: WorkflowStatus.FAILED,
                result: JSON.stringify({
                  ...(() => {
                    try {
                      return candidate.result
                        ? (JSON.parse(candidate.result) as Record<string, unknown>)
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
            // Fall through — keep scanning; a stale row for this task does
            // not block, but another fresh row for it further down would.
            continue;
          }

          // Fresh, well-formed, same-task active run — block this dispatch.
          throw Object.assign(
            new Error("A run is already in progress for this task"),
            { code: "ACTIVE_RUN_EXISTS" },
          );
        }

        const newRun = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            userId,
            // `runner` is written ONLY for vein rows — absent means stakwork, so
            // existing rows and readers are untouched.
            result: JSON.stringify({
              taskSlug,
              taskTitle: task.title,
              ...(runner === "vein" ? { runner } : {}),
            }),
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
    const runToken = createHmac("sha256", webhookSecret).update(run.id).digest("hex");
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.BENCHMARK_RUNNER}&run_id=${run.id}&workspace_id=${workspaceId}&run_token=${runToken}`;

    // ── Step 12: Persist real webhook URL ─────────────────────────────────────
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { webhookUrl },
    });

    // ── Step 13: Graph base URL ───────────────────────────────────────────────
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    // ── Step 14: Build Stakwork payload (NO credentials) ─────────────────────
    const expectedOutput = findExpectedOutput(task.slug);
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
      // workflow_input / expected_output: absent fields emit NO key at all
      // (never null/empty) — mirrors the baseline spread above. Delivered as
      // one JSON string var (parsed back to an object by the rerunner) and a
      // raw string respectively — never JSON.stringify the expected answer,
      // that is a double-encoding trap for the rerunner's comparison.
      ...(task.workflow_input !== undefined
        ? { [WORKFLOW_INPUT_VAR]: JSON.stringify(task.workflow_input) }
        : {}),
      ...(expectedOutput !== undefined
        ? { [RERUN_EXPECTED_OUTPUT_VAR]: expectedOutput }
        : {}),
    };

    const payload = {
      name: `wf-benchmark-${run.id}`,
      workflow_id: parseInt(benchmarkWorkflowId ?? "0", 10),
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
    // Keys only, never values — this is dispatch-side provenance, not a
    // comparison against the produced artifact (Hive never reads the
    // produced workflow back).
    const inputKeys = Object.keys(task.workflow_input ?? {});
    const hasExpectedOutput = expectedOutput !== undefined;
    logger.info(
      `[workflow-benchmarks/run] dispatching task=${taskSlug} runner=${runner} criteria=${task.criteria.length} hasBaseline=${task.baseline !== undefined} rosterUpsert=${rosterUpsertOutcome} inputKeys=${inputKeys.length} hasExpectedOutput=${hasExpectedOutput}`,
      "workflow-benchmarks",
      {
        taskSlug,
        runner,
        criteriaCount: task.criteria.length,
        hasBaseline: task.baseline !== undefined,
        rosterUpsertOutcome,
        runId: run.id,
        inputKeys,
        hasExpectedOutput,
      },
    );

    // ── Step 16/17/18: Dispatch ───────────────────────────────────────────────
    let projectId: number | undefined;
    let veinRunId: string | undefined;
    let veinRunUrl: string | undefined;

    if (runner === "vein") {
      // The workspace swarm's stakgraph (:3355) mounts the vein lab at /lab;
      // `wfbench-run` is the Workflow Editor Benchmark harness there. Same
      // task fields as the Stakwork set_var vars, as the workflow's `input`
      // (criteria as the array, workflow_input as the object — the harness
      // accepts both encodings). Auth is the swarm API key as x-api-token,
      // the same way every other Hive → stakgraph call authenticates.
      const labBase = transformSwarmUrlToRepo2Graph(swarmUrl);
      const veinInput: Record<string, unknown> = {
        task_slug: task.slug,
        task_title: task.title,
        instructions: task.instructions,
        criteria: task.criteria,
        workflow_input_json: task.workflow_input ?? {},
        ...(expectedOutput !== undefined ? { [RERUN_EXPECTED_OUTPUT_VAR]: expectedOutput } : {}),
        webhook_url: webhookUrl,
      };
      const veinResponse = await fetch(`${labBase}/lab/workflows/wfbench-run/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": swarmApiKey,
        },
        body: JSON.stringify({ input: veinInput }),
      });
      if (!veinResponse.ok) {
        await db.stakworkRun.delete({ where: { id: run.id } });
        return NextResponse.json(
          { error: "Failed to dispatch job to vein" },
          { status: 502 },
        );
      }
      const veinData = (await veinResponse.json().catch(() => ({}))) as { runId?: unknown };
      veinRunId = typeof veinData?.runId === "string" && veinData.runId ? veinData.runId : undefined;
      veinRunUrl = veinRunId ? `${labBase}/lab/?wf=wfbench-run&run=${encodeURIComponent(veinRunId)}` : undefined;
    } else {
      const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
        },
        body: JSON.stringify(payload),
      });

      // Handle dispatch failure
      if (!stakworkResponse.ok) {
        await db.stakworkRun.delete({ where: { id: run.id } });
        return NextResponse.json(
          { error: "Failed to dispatch job to Stakwork" },
          { status: 502 },
        );
      }

      // Parse project id
      const stakworkData = (await stakworkResponse.json()) as Record<string, unknown> & {
        data?: { project_id?: number };
        project_id?: number;
      };
      projectId = stakworkData?.data?.project_id ?? stakworkData?.project_id;
    }

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
    if (runner === "vein") {
      // vein has no Stakwork project: the lab runId is the run's identity and
      // the lab UI is its admin link (rendered in place of the Stakwork one).
      mergedResult.runner = "vein";
      if (veinRunId !== undefined) mergedResult.veinRunId = veinRunId;
      if (veinRunUrl !== undefined) mergedResult.veinRunUrl = veinRunUrl;
    }
    // Roster reconciliation observability, namespaced under `hive` so a
    // runner-supplied field of the same bare name can never clobber it (the
    // BENCHMARK_RUNNER webhook merges incomingFields over existingResult).
    // Write-only provenance (Correction 6) — no reader exists yet; this makes
    // two runs of the same slug scored against different rubric text
    // distinguishable after the fact.
    mergedResult.hive = {
      ...(typeof mergedResult.hive === "object" && mergedResult.hive !== null
        ? (mergedResult.hive as Record<string, unknown>)
        : {}),
      rosterUpsertOutcome,
      criteriaFingerprint: criteriaFingerprint(task.criteria),
    };

    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify(mergedResult),
      },
    });

    // ── Step 21: Return 201 ───────────────────────────────────────────────────
    return NextResponse.json({ run_id: run.id, runner }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[workflow-benchmarks/run] Unexpected error: ${message}`,
      "workflow-benchmarks",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
