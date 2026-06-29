import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { getUserActivityFeed } from "@/services/roadmap/user-activity";
import { stakworkService } from "@/lib/service-factory";
import { config } from "@/config/env";
import { ApiError } from "@/types/common";
import { getBaseUrl } from "@/lib/utils";

export interface DailyRecapCronResult {
  usersProcessed: number;
  dispatched: number;
  skipped: number;
  errors: Array<{ userId: string; error: string }>;
}

/**
 * Split an array into chunks of at most `size` items.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Execute the scheduled daily-recap fan-out.
 *
 * For each opted-in user with recent activity:
 *   1. Resolve a workspace to attribute the run to.
 *   2. Compute the activity window since the last recap.
 *   3. Skip users with zero activity.
 *   4. Create a PENDING StakworkRun row stamped with userId.
 *   5. Batch-dispatch via POST /api/v1/projects/batch (≤500 per chunk).
 *   6. Back-fill projectId / status on the rows.
 */
export async function executeScheduledDailyRecapRuns(): Promise<DailyRecapCronResult> {
  const result: DailyRecapCronResult = {
    usersProcessed: 0,
    dispatched: 0,
    skipped: 0,
    errors: [],
  };

  const workflowId = config.STAKWORK_DAILY_RECAP_WORKFLOW_ID;
  if (!workflowId) {
    console.error("[DailyRecapCron] STAKWORK_DAILY_RECAP_WORKFLOW_ID not configured — aborting");
    result.errors.push({ userId: "SYSTEM", error: "STAKWORK_DAILY_RECAP_WORKFLOW_ID not configured" });
    return result;
  }

  const baseUrl = getBaseUrl();
  console.log(`[DailyRecapCron] Starting at ${new Date().toISOString()}`);

  // ── 1. Query eligible users ──────────────────────────────────────────────
  const users = await db.user.findMany({
    where: { dailyRecapEnabled: true, deleted: false },
    select: { id: true },
  });

  console.log(`[DailyRecapCron] Found ${users.length} eligible user(s)`);
  result.usersProcessed = users.length;

  // Pending runs to batch-dispatch: { run, workflowWebhookUrl, since, activity, webhookUrl }
  const pendingRuns: Array<{
    run: { id: string };
    userId: string;
    workflowWebhookUrl: string;
    since: Date;
    activity: string;
    webhookUrl: string;
  }> = [];

  // ── Per-user preparation ─────────────────────────────────────────────────
  for (const { id: userId } of users) {
    try {
      // 2. Resolve workspace
      let workspaceId: string | null = null;

      const ownedWorkspace = await db.workspace.findFirst({
        where: { ownerId: userId, deleted: false },
        select: { id: true },
      });

      if (ownedWorkspace) {
        workspaceId = ownedWorkspace.id;
      } else {
        const membership = await db.workspaceMember.findFirst({
          where: { userId },
          orderBy: { joinedAt: "asc" },
          select: { workspaceId: true },
        });
        workspaceId = membership?.workspaceId ?? null;
      }

      if (!workspaceId) {
        console.warn(`[DailyRecapCron] Skipping user ${userId}: no workspace found`);
        result.skipped++;
        continue;
      }

      // 3. Compute activity window
      const lastRun = await db.stakworkRun.findFirst({
        where: { userId, type: StakworkRunType.DAILY_RECAP },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const since = lastRun?.createdAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
      const days = Math.min(30, Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86_400_000)));

      // 4. Fetch activity (skip check + digest in one call)
      const items = await getUserActivityFeed({ userId, days, limit: 40 });

      if (items.length === 0) {
        console.log(`[DailyRecapCron] Skipping user ${userId}: no activity in last ${days} day(s)`);
        result.skipped++;
        continue;
      }

      // 5. Build 5-field digest
      const digest = items.map(({ kind, action, title, timestamp, workspaceName }) => ({
        kind,
        action,
        title,
        timestamp,
        workspaceName,
      }));
      const activity = JSON.stringify(digest);

      // 6. Create PENDING row
      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.DAILY_RECAP,
          userId,
          workspaceId,
          status: WorkflowStatus.PENDING,
          webhookUrl: "",
          dataType: "string",
          autoAccept: false,
        },
      });

      const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?run_id=${run.id}`;
      const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=DAILY_RECAP&workspace_id=${workspaceId}`;

      await db.stakworkRun.update({
        where: { id: run.id },
        data: { webhookUrl },
      });

      pendingRuns.push({ run, userId, workflowWebhookUrl, since, activity, webhookUrl });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[DailyRecapCron] Error preparing user ${userId}: ${msg}`);
      result.errors.push({ userId, error: msg });
    }
  }

  if (pendingRuns.length === 0) {
    console.log("[DailyRecapCron] No runs to dispatch");
    return result;
  }

  // ── 7. Batch dispatch ────────────────────────────────────────────────────
  const chunks = chunkArray(pendingRuns, 500);
  console.log(`[DailyRecapCron] Dispatching ${pendingRuns.length} run(s) in ${chunks.length} batch(es)`);

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];

    const batchPayload = chunk.map(({ run, workflowWebhookUrl, since, activity, webhookUrl }) => ({
      name: `daily-recap-${run.id}`,
      workflow_id: parseInt(workflowId),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              since: since.toISOString(),
              activity,
              webhookUrl,
            },
          },
        },
      },
    }));

    try {
      const response = await stakworkService().createBatchProjects(batchPayload);
      const projects = response.data.projects;

      console.log(
        `[DailyRecapCron] Chunk ${chunkIdx + 1}/${chunks.length}: ` +
          `${projects.filter((p) => p.project_id).length} succeeded, ` +
          `${projects.filter((p) => !p.project_id).length} failed`,
      );

      // Back-fill projectId
      for (const item of projects) {
        const runId = item.name.replace("daily-recap-", "");

        if (item.project_id) {
          await db.stakworkRun.update({
            where: { id: runId },
            data: { projectId: item.project_id, status: WorkflowStatus.IN_PROGRESS },
          });
          result.dispatched++;
        } else {
          const errMsg = item.error ?? "unknown batch error";
          console.error(`[DailyRecapCron] Batch item ${item.name} failed: ${errMsg}`);
          await db.stakworkRun.update({
            where: { id: runId },
            data: { status: WorkflowStatus.FAILED },
          });
          // Resolve userId from the chunk for richer error context
          const pending = chunk.find((p) => p.run.id === runId);
          result.errors.push({ userId: pending?.userId ?? runId, error: errMsg });
        }
      }
    } catch (error) {
      const apiError = error as ApiError;
      const msg = apiError?.message ?? String(error);
      console.error(
        `[DailyRecapCron] Chunk ${chunkIdx + 1} dispatch failed` +
        ` | status=${apiError?.status ?? 'unknown'}` +
        ` | message=${msg}` +
        ` | details=${JSON.stringify(apiError?.details ?? null)}`,
      );

      // Mark all runs in this chunk as FAILED
      for (const { run, userId } of chunk) {
        await db.stakworkRun
          .update({ where: { id: run.id }, data: { status: WorkflowStatus.FAILED } })
          .catch(() => {/* best-effort */});
        result.errors.push({ userId, error: msg });
      }
    }
  }

  console.log(
    `[DailyRecapCron] Done. Processed=${result.usersProcessed} Dispatched=${result.dispatched} ` +
      `Skipped=${result.skipped} Errors=${result.errors.length}`,
  );

  return result;
}
