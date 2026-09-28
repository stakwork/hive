import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";
import {
  STRUT_ACTOR_HEADER,
  ensureStrutDelegation,
  resolveStrutActor,
} from "@/services/bifrost/strut-delegation";
import {
  bodyHasGoldKey,
  isOpenHealthSplit,
  isOpenHealthTaskName,
  OPENHEALTH_ACTIVE_RUN_SCAN_LIMIT,
  OPENHEALTH_STALE_RUN_THRESHOLD_MS,
  OPENHEALTH_STRUT_WORKFLOW_NAME_RE,
  resolveOpenHealthStrutWorkflowName,
} from "@/lib/openhealth-benchmarks/constants";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/** Minimum acceptable length for NEXTAUTH_SECRET before we trust it to sign a run_token. */
const MIN_RUN_TOKEN_SECRET_LENGTH = 32;

interface StartBody {
  task?: unknown;
  split?: unknown;
  gtId?: unknown;
  patientId?: unknown;
  [key: string]: unknown;
}

/**
 * POST /api/workspaces/[slug]/openhealth/benchmarks/run
 *
 * Start exactly one `openhealth-run` strut instance for a selected
 * (task, gt_id) pair. Creates a single OPENHEALTH_BENCHMARK_RUNNER
 * StakworkRun row, then dispatches to the workspace swarm's strut lab.
 * Gated to the `hive` workspace only. No Stakwork runner path, no
 * model picker.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Slug gate FIRST — before any access check.
    if (!OPENHEALTH_SLUGS.includes(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // IDOR: confirm the caller can write THIS workspace before any DB write,
    // secret access, or third-party call. 404, not 403 — no existence leak.
    const access = await validateWorkspaceAccess(slug, userId, true, {});
    if (!access.canWrite) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fail closed. Before swarm credential use, DB write, or the lab POST.
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(`openhealth-benchmark-run:${userId}`, 10, 60);
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

    // ── Parse + validate body BEFORE any swarm/DB access ─────────────────────
    let body: StartBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const goldKey = bodyHasGoldKey(body);
    if (goldKey) {
      return NextResponse.json(
        { error: `Request body must not include a gold-shaped key: "${goldKey}"` },
        { status: 400 },
      );
    }

    const { task, split, gtId, patientId } = body;
    if (!isOpenHealthTaskName(task)) {
      return NextResponse.json({ error: "Invalid task" }, { status: 400 });
    }
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json(
        { error: 'split must be "public" or "heldout"' },
        { status: 400 },
      );
    }
    if (typeof gtId !== "string" || gtId.trim().length === 0) {
      return NextResponse.json({ error: "gtId is required" }, { status: 400 });
    }
    if (typeof patientId !== "string" || patientId.trim().length === 0) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    // ── Env / workflow name checks — before any write ────────────────────────
    const strutWorkflowName = resolveOpenHealthStrutWorkflowName();
    if (!OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test(strutWorkflowName)) {
      return NextResponse.json(
        { error: "OPENHEALTH_STRUT_WORKFLOW_NAME is not configured" },
        { status: 503 },
      );
    }

    const webhookSecret = process.env.NEXTAUTH_SECRET;
    if (!webhookSecret || webhookSecret.length < MIN_RUN_TOKEN_SECRET_LENGTH) {
      logger.error(
        "[openhealth/benchmarks/run] NEXTAUTH_SECRET missing or too short — refusing to issue a run_token",
        "openhealth-benchmarks",
      );
      return NextResponse.json(
        { error: "Service misconfigured: webhook signing secret unavailable" },
        { status: 503 },
      );
    }

    // The slug gate above already rejects every non-hive URL before access,
    // so a successful call has URL slug "hive". Use that literal — not a
    // second workspace load that could diverge from the URL workspace.
    const swarmResult = await getWorkspaceSwarmAccess("hive", userId);
    if (!swarmResult.success) {
      return NextResponse.json(
        { error: "Swarm not configured for the strut runner" },
        { status: 503 },
      );
    }
    const { workspaceId, swarmUrl, swarmApiKey } = swarmResult.data;
    if (!swarmUrl || !swarmApiKey) {
      return NextResponse.json(
        { error: "Swarm not configured for the strut runner" },
        { status: 503 },
      );
    }

    // ── Reuse the standing strut delegation. Never throws; a non-fresh/pushed
    // status means we must not spend the workspace swarm key. ────────────────
    const actor = await resolveStrutActor(userId);
    const delegation = await ensureStrutDelegation(
      { workspaceId, workspaceSlug: "hive", userId },
      { swarmUrl, swarmApiKey },
      { actor },
    );
    if (delegation.status !== "fresh" && delegation.status !== "pushed") {
      return NextResponse.json(
        { error: "Strut delegation unavailable" },
        { status: 503 },
      );
    }

    // ── Atomic single-active-run guard + single row creation ────────────────
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    let runnerRun: { id: string };
    try {
      runnerRun = await db.$transaction<{ id: string }>(async (tx) => {
        const now = Date.now();

        const candidates = await tx.stakworkRun.findMany({
          where: {
            workspaceId,
            type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: OPENHEALTH_ACTIVE_RUN_SCAN_LIMIT,
        });

        for (const candidate of candidates) {
          let candidateTask: string | undefined;
          let candidateGtId: string | undefined;
          let malformed = false;
          try {
            const resultJson = candidate.result
              ? (JSON.parse(candidate.result) as Record<string, unknown>)
              : {};
            candidateTask = resultJson.task as string | undefined;
            candidateGtId = resultJson.gtId as string | undefined;
          } catch {
            malformed = true;
          }

          const isStale = candidate.updatedAt.getTime() < now - OPENHEALTH_STALE_RUN_THRESHOLD_MS;

          if (malformed) {
            if (!isStale) {
              throw Object.assign(new Error("A run is already in progress for this task"), {
                code: "ACTIVE_RUN_EXISTS",
              });
            }
            continue;
          }

          if (candidateTask !== task || candidateGtId !== gtId) {
            continue;
          }

          if (isStale) {
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
            continue;
          }

          throw Object.assign(new Error("A run is already in progress for this task"), {
            code: "ACTIVE_RUN_EXISTS",
          });
        }

        const created = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            projectId: null,
            userId,
            result: JSON.stringify({
              runner: "strut",
              task,
              split,
              gtId,
              patientId,
            }),
          },
          select: { id: true },
        });

        return created;
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as Error & { code?: string }).code === "ACTIVE_RUN_EXISTS"
      ) {
        return NextResponse.json({ error: "ACTIVE_RUN_EXISTS" }, { status: 409 });
      }
      throw err;
    }

    // Sign with the already-checked NEXTAUTH_SECRET.
    const runToken = createHmac("sha256", webhookSecret).update(runnerRun.id).digest("hex");
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER}&run_id=${runnerRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;
    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: { webhookUrl },
    });

    // Lab URL is transformSwarmUrlToRepo2Graph(swarmUrl) + "/lab/..." — do NOT
    // use strutLabBaseUrl and then append "/lab" again (it already does that).
    const labBase = transformSwarmUrlToRepo2Graph(swarmUrl);
    const labUrl = `${labBase}/lab/workflows/${strutWorkflowName}/run`;

    logger.info("[openhealth/benchmarks/run] dispatching", "openhealth-benchmarks", {
      runner: "strut",
      task,
      split,
      gtId,
    });

    let strutResponse: Response;
    try {
      strutResponse = await fetch(labUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": swarmApiKey,
          [STRUT_ACTOR_HEADER]: actor,
        },
        body: JSON.stringify({
          input: { task, split, gtId, patientId },
          callback: { url: webhookUrl },
        }),
      });
    } catch {
      await deletePendingRun(runnerRun.id);
      return NextResponse.json(
        { error: "Failed to dispatch job to strut" },
        { status: 502 },
      );
    }

    if (!strutResponse.ok) {
      // The lab never accepted the launch — safe to delete the pending row.
      await deletePendingRun(runnerRun.id);
      return NextResponse.json(
        { error: "Failed to dispatch job to strut" },
        { status: 502 },
      );
    }

    const strutData = (await strutResponse.json().catch(() => ({}))) as {
      callback?: unknown;
      runId?: unknown;
    };
    const acceptedCallback = strutData.callback === true;
    const strutRunId =
      typeof strutData.runId === "string" && strutData.runId ? strutData.runId : undefined;

    if (!acceptedCallback || !strutRunId) {
      // The lab HAS accepted the launch (2xx) but did not confirm the
      // callback/runId contract — do NOT delete the row (the lab run may
      // already be executing). Cancel the lab run if we have a runId, then
      // mark the Hive row FAILED with dispatchError.
      if (strutRunId) {
        try {
          await fetch(`${labBase}/workflows/${strutWorkflowName}/runs/${encodeURIComponent(strutRunId)}/cancel`, {
            method: "POST",
            headers: { "x-api-token": swarmApiKey, [STRUT_ACTOR_HEADER]: actor },
          });
        } catch {
          // Best-effort cancel; failure is logged but does not change the outcome below.
        }
      }
      await db.stakworkRun.update({
        where: { id: runnerRun.id },
        data: {
          status: WorkflowStatus.FAILED,
          result: JSON.stringify({
            runner: "strut",
            task,
            split,
            gtId,
            patientId,
            dispatchError: "strut did not confirm callback acceptance",
          }),
        },
      });
      logger.info("[openhealth/benchmarks/run] dispatch rejected", "openhealth-benchmarks", {
        runner: "strut",
        task,
        split,
        gtId,
        labRunId: strutRunId,
        status: "failed",
      });
      return NextResponse.json({ error: "Strut did not accept the run" }, { status: 502 });
    }

    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: {
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({
          runner: "strut",
          task,
          split,
          gtId,
          patientId,
          strutRunId,
        }),
      },
    });

    logger.info("[openhealth/benchmarks/run] dispatched", "openhealth-benchmarks", {
      runner: "strut",
      task,
      split,
      gtId,
      labRunId: strutRunId,
      status: "in_progress",
    });

    return NextResponse.json({ run_id: runnerRun.id }, { status: 201 });
  } catch (error) {
    logger.error("[openhealth/benchmarks/run POST] Unexpected error", "openhealth-benchmarks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Drop a pending row after a failed dispatch (fetch failure or non-OK lab
 * response before acceptance). Mirrors deletePendingRun in the legal route.
 */
async function deletePendingRun(runId: string): Promise<void> {
  try {
    await db.stakworkRun.deleteMany({ where: { id: runId } });
  } catch {
    logger.error("[openhealth/benchmarks/run] failed to delete pending run", "openhealth-benchmarks", {
      runId,
    });
  }
}
