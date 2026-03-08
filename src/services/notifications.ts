import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  NotificationMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { sendDirectMessage, isDirectMessageConfigured } from "@/lib/sphinx/direct-message";
import { logger } from "@/lib/logger";

const DEFERRED_NOTIFICATION_TYPES = new Set<NotificationTriggerType>([
  NotificationTriggerType.TASK_ASSIGNED,
  NotificationTriggerType.FEATURE_ASSIGNED,
  NotificationTriggerType.PLAN_AWAITING_CLARIFICATION,
  NotificationTriggerType.PLAN_AWAITING_APPROVAL,
  NotificationTriggerType.PLAN_TASKS_GENERATED,
  NotificationTriggerType.WORKFLOW_HALTED,
  NotificationTriggerType.GRAPH_CHAT_RESPONSE,
]);

const DEFERRED_DELAY_MS = 5 * 60 * 1000;

export async function createAndSendNotification(input: {
  targetUserId: string;
  originatingUserId?: string;
  taskId?: string;
  featureId?: string;
  workspaceId: string;
  notificationType: NotificationTriggerType;
  message: string;
}): Promise<void> {
  try {
    const taskId = input.taskId ?? null;
    const featureId = input.featureId ?? null;

    // 1. Fetch target user
    const targetUser = await db.user.findUnique({
      where: { id: input.targetUserId },
      select: { lightningPubkey: true },
    });

    // 2. Idempotency check — skip if PENDING record already exists
    const existing = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: input.targetUserId,
        notificationType: input.notificationType,
        taskId,
        featureId,
        status: NotificationTriggerStatus.PENDING,
      },
    });

    if (existing) {
      return;
    }

    // 3. Determine DM eligibility
    const dmReady = isDirectMessageConfigured() && !!targetUser?.lightningPubkey;

    // 4. Always insert a row — use SKIPPED when DM is not ready
    const record = await db.notificationTrigger.create({
      data: {
        targetUserId: input.targetUserId,
        originatingUserId: input.originatingUserId ?? null,
        taskId,
        featureId,
        notificationType: input.notificationType,
        status: dmReady
          ? NotificationTriggerStatus.PENDING
          : NotificationTriggerStatus.SKIPPED,
        notificationMethod: NotificationMethod.SPHINX,
        notificationTimestamps: [],
      },
    });

    // 5. Stop here if DM is not configured — no send attempted
    if (!dmReady) {
      return;
    }

    // 6. Deferred types: store sendAfter + message, return without sending
    if (DEFERRED_NOTIFICATION_TYPES.has(input.notificationType)) {
      await db.notificationTrigger.update({
        where: { id: record.id },
        data: {
          sendAfter: new Date(Date.now() + DEFERRED_DELAY_MS),
          message: input.message,
        },
      });
      return;
    }

    // 7. Immediate types: send via direct message now
    const result = await sendDirectMessage(targetUser!.lightningPubkey!, input.message);

    // 8. Update record with outcome
    await db.notificationTrigger.update({
      where: { id: record.id },
      data: {
        status: result.success
          ? NotificationTriggerStatus.SENT
          : NotificationTriggerStatus.FAILED,
        notificationTimestamps: { push: new Date() },
      },
    });
  } catch (error) {
    logger.error(
      "[Notifications] createAndSendNotification error",
      "NOTIFICATIONS",
      { error, input }
    );
  }
}
