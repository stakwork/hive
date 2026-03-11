import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendDirectMessage } from "@/lib/sphinx/direct-message";
import { sendHubPushNotification } from "@/lib/hub/push-notification";
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
      const task = await db.task.findUnique({
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
      const feature = await db.feature.findUnique({
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
      const feature = await db.feature.findUnique({
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
      const feature = await db.feature.findUnique({
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
        const task = await db.task.findUnique({
          where: { id: taskId },
          select: { workflowStatus: true },
        });
        if (!task) return true;
        return task.workflowStatus !== WorkflowStatus.HALTED;
      }
      if (featureId) {
        const feature = await db.feature.findUnique({
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
    due = await db.notificationTrigger.findMany({
      where: {
        status: NotificationTriggerStatus.PENDING,
        sendAfter: { lte: new Date() },
      },
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

  for (const record of due) {
    try {
      const cancel = await shouldCancel(
        record.notificationType,
        record.taskId,
        record.featureId
      );

      if (cancel) {
        await db.notificationTrigger.update({
          where: { id: record.id },
          data: { status: NotificationTriggerStatus.CANCELLED },
        });
        result.cancelled++;
        continue;
      }

      // Defensive: re-check that the recipient still has a pubkey
      const pubkey = record.targetUser?.lightningPubkey;
      if (!pubkey || !record.message) {
        await db.notificationTrigger.update({
          where: { id: record.id },
          data: { status: NotificationTriggerStatus.CANCELLED },
        });
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
          message: record.message!,
          workspaceSlug,
          taskId: record.taskId ?? undefined,
          featureId: record.featureId ?? undefined,
        }).catch((err) =>
          logger.error("[NotificationDispatcher] HUB push failed", "HUB_PUSH", { err, recordId: record.id })
        );
      }

      await db.notificationTrigger.update({
        where: { id: record.id },
        data: {
          status: sendResult.success
            ? NotificationTriggerStatus.SENT
            : NotificationTriggerStatus.FAILED,
          notificationTimestamps: { push: new Date() },
        },
      });

      if (sendResult.success) {
        result.dispatched++;
      } else {
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
