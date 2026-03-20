import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendDirectMessage } from "@/lib/sphinx/direct-message";
import { sendHubPushNotification, buildPushMessage } from "@/lib/hub/push-notification";
import { EncryptionService } from "@/lib/encryption";
import {
  NotificationTriggerStatus,
  NotificationTriggerType,
  TaskStatus,
  WorkflowStatus,
  FeatureStatus,
} from "@prisma/client";

export interface DispatchResult {
  dispatched: number;
  cancelled: number;
  failed: number;
  errors: string[];
}

/**
 * Determines whether a pending notification should be cancelled based on the
 * current state of its linked task or feature.
 *
 * Returns true if the notification should be cancelled.
 */
async function shouldCancel(
  notificationType: NotificationTriggerType,
  taskId: string | null,
  featureId: string | null
): Promise<boolean> {
  switch (notificationType) {
    case NotificationTriggerType.TASK_ASSIGNED:
    case NotificationTriggerType.GRAPH_CHAT_RESPONSE: {
      if (!taskId) return true; // entity deleted — cancel
      const task = await db.tasks.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (!task) return true;
      return (
        task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED
      );
    }

    case NotificationTriggerType.FEATURE_ASSIGNED: {
      if (!featureId) return true;
      const feature = await db.features.findUnique({
        where: { id: featureId },
        select: { status: true },
      });
      if (!feature) return true;
      return (
        feature.status === FeatureStatus.COMPLETED ||
        feature.status === FeatureStatus.CANCELLED
      );
    }

    case NotificationTriggerType.PLAN_AWAITING_CLARIFICATION: {
      if (!featureId) return true;
      const feature = await db.features.findUnique({
        where: { id: featureId },
        select: { workflowStatus: true },
      });
      if (!feature) return true;
      // Cancel if workflow is no longer HALTED (user responded, workflow resumed)
      return feature.workflowStatus !== WorkflowStatus.HALTED;
    }

    case NotificationTriggerType.PLAN_AWAITING_APPROVAL:
    case NotificationTriggerType.PLAN_TASKS_GENERATED: {
      if (!featureId) return true;
      const feature = await db.features.findUnique({
        where: { id: featureId },
        select: { status: true },
      });
      if (!feature) return true;
      return (
        feature.status === FeatureStatus.IN_PROGRESS ||
        feature.status === FeatureStatus.COMPLETED ||
        feature.status === FeatureStatus.CANCELLED
      );
    }

    case NotificationTriggerType.WORKFLOW_HALTED: {
      // Can be linked to a task OR a feature — use whichever is set
      if (taskId) {
        const task = await db.tasks.findUnique({
          where: { id: taskId },
          select: { workflowStatus: true },
        });
        if (!task) return true;
        return task.workflowStatus !== WorkflowStatus.HALTED;
      }
      if (featureId) {
        const feature = await db.features.findUnique({
          where: { id: featureId },
          select: { workflowStatus: true },
        });
        if (!feature) return true;
        return feature.workflowStatus !== WorkflowStatus.HALTED;
      }
      // No linked entity — cancel
      return true;
    }

    default:
      // Unknown type — do not cancel, let it send
      return false;
  }
}

/**
 * Picks up all PENDING notification triggers whose sendAfter time has passed,
 * runs per-type cancellation checks, and either sends or cancels each one.
 */
export async function dispatchPendingNotifications(): Promise<DispatchResult> {
  const result: DispatchResult = {
    dispatched: 0,
    cancelled: 0,
    failed: 0,
    errors: [],
  };

  let due: Array<{
    id: string;
    notificationType: NotificationTriggerType;
    taskId: string | null;
    featureId: string | null;
    message: string | null;
    targetUser: { lightningPubkey: string | null; sphinxRouteHint: string | null; iosDeviceToken: string | null };
    task: { workspace: { slug: string } } | null;
    feature: { workspace: { slug: string } } | null;
  }>;

  try {
    // Atomically claim up to 100 due rows by moving them from PENDING → FAILED
    // in a single UPDATE … RETURNING statement. This ensures concurrent cron
    // invocations cannot claim the same rows — once status leaves PENDING the
    // second dispatcher's query won't see them. We then update to the real
    // terminal status (SENT / CANCELLED) after processing each record.
    const claimedIds = await db.$queryRaw<Array<{ id: string }>>`
      UPDATE notification_triggers
      SET status = 'FAILED'
      WHERE id IN (
        SELECT id FROM notification_triggers
        WHERE status = 'PENDING'
          AND send_after <= NOW()
        ORDER BY send_after ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    const claimedIdList = claimedIds.map((r) => r.id);
    due = claimedIdList.length === 0
      ? []
      : await db.notification_triggers.findMany({
          where: { id: { in: claimedIdList } },
          include: {
            targetUser: { select: { lightningPubkey: true, sphinxRouteHint: true, iosDeviceToken: true } },
            task: { select: { workspace: { select: { slug: true } } } },
            feature: { select: { workspace: { select: { slug: true } } } },
          },
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[NotificationDispatcher] Failed to query pending notifications", "NOTIFICATION_DISPATCHER", { error });
    result.errors.push(`Query failed: ${message}`);
    return result;
  }

  logger.info(
    `[NotificationDispatcher] Found ${due.length} due notification(s)`,
    "NOTIFICATION_DISPATCHER"
  );

  for (const record of due) {
    try {
      const cancel = await shouldCancel(
        record.notificationType,
        record.taskId,
        record.featureId
      );

      if (cancel) {
        await db.notification_triggers.update({
          where: { id: record.id },
          data: { status: NotificationTriggerStatus.CANCELLED },
        });
        logger.info(
          `[NotificationDispatcher] Cancelled ${record.notificationType} (${record.id}) — entity resolved`,
          "NOTIFICATION_DISPATCHER"
        );
        result.cancelled++;
        continue;
      }

      // Defensive: re-check that the recipient still has a pubkey and decrypt it
      const encryptionService = EncryptionService.getInstance();
      const pubkey = record.targetUser?.lightningPubkey
        ? encryptionService.decryptField("lightningPubkey", record.targetUser.lightningPubkey)
        : null;
      if (!pubkey || !record.message) {
        await db.notification_triggers.update({
          where: { id: record.id },
          data: { status: NotificationTriggerStatus.CANCELLED },
        });
        logger.info(
          `[NotificationDispatcher] Cancelled ${record.notificationType} (${record.id}) — no pubkey or message`,
          "NOTIFICATION_DISPATCHER",
          { hasPubkey: !!pubkey, hasMessage: !!record.message }
        );
        result.cancelled++;
        continue;
      }

      // Send the stored message
      const routeHint = record.targetUser?.sphinxRouteHint ?? undefined;
      const sendResult = await sendDirectMessage(pubkey, record.message, { routeHint });

      // Fire HUB push in parallel (fire-and-forget) if device token and workspace slug are set
      const workspaceSlug = record.task?.workspace?.slug ?? record.feature?.workspace?.slug;
      const iosDeviceToken = record.targetUser?.iosDeviceToken;
      if (iosDeviceToken && workspaceSlug) {
        void sendHubPushNotification({
          deviceToken: iosDeviceToken,
          message: buildPushMessage(record.message!),
          workspaceSlug,
          taskId: record.taskId ?? undefined,
          featureId: record.featureId ?? undefined,
        }).catch((err) =>
          logger.error("[NotificationDispatcher] HUB push failed", "HUB_PUSH", { err, recordId: record.id })
        );
      }

      await db.notification_triggers.update({
        where: { id: record.id },
        data: {
          status: sendResult.success
            ? NotificationTriggerStatus.SENT
            : NotificationTriggerStatus.FAILED,
          notificationTimestamps: { push: new Date() },
        },
      });

      if (sendResult.success) {
        logger.info(
          `[NotificationDispatcher] Sent ${record.notificationType} (${record.id}) to ${pubkey.slice(0, 8)}…`,
          "NOTIFICATION_DISPATCHER"
        );
        result.dispatched++;
      } else {
        logger.warn(
          `[NotificationDispatcher] Failed to send ${record.notificationType} (${record.id}): ${sendResult.error}`,
          "NOTIFICATION_DISPATCHER"
        );
        result.failed++;
        result.errors.push(
          `Record ${record.id}: send failed — ${sendResult.error ?? "unknown error"}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        "[NotificationDispatcher] Error processing record",
        "NOTIFICATION_DISPATCHER",
        { recordId: record.id, error }
      );
      result.failed++;
      result.errors.push(`Record ${record.id}: ${message}`);
    }
  }

  logger.info(
    `[NotificationDispatcher] Done — dispatched: ${result.dispatched}, cancelled: ${result.cancelled}, failed: ${result.failed}`,
    "NOTIFICATION_DISPATCHER"
  );

  return result;
}
