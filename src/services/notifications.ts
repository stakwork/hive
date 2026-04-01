import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  NotificationMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { sendDirectMessage, isDirectMessageConfigured } from "@/lib/sphinx/direct-message";
import { sendHubPushNotification, buildPushMessage } from "@/lib/hub/push-notification";
import { EncryptionService } from "@/lib/encryption";
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

    // 1. Fetch target user and workspace slug in parallel
    const [targetUser, workspace] = await Promise.all([
      db.user.findUnique({
        where: { id: input.targetUserId },
        select: { lightningPubkey: true, sphinxRouteHint: true, iosDeviceToken: true },
      }),
      db.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { slug: true },
      }),
    ]);

    // 2. Idempotency check — skip if PENDING or FAILED record already exists.
    //    FAILED records block retries so a previous failure for the same trigger
    //    key does not produce a second notification row.
    const existing = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: input.targetUserId,
        notificationType: input.notificationType,
        taskId,
        featureId,
        status: { in: [NotificationTriggerStatus.PENDING, NotificationTriggerStatus.FAILED] },
      },
    });

    if (existing) {
      logger.info(
        `[Notifications] Skipping duplicate — ${existing.status} record already exists for ${input.notificationType}`,
        "NOTIFICATIONS",
        { targetUserId: input.targetUserId, taskId, featureId, existingId: existing.id, existingStatus: existing.status }
      );
      return;
    }

    // 3. Determine DM eligibility — decrypt the pubkey if present
    const encryptionService = EncryptionService.getInstance();
    const decryptedPubkey = targetUser?.lightningPubkey
      ? encryptionService.decryptField("lightningPubkey", targetUser.lightningPubkey)
      : null;
    const dmReady = isDirectMessageConfigured() && !!decryptedPubkey;

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
      logger.info(
        `[Notifications] DM not ready — record created as SKIPPED for ${input.notificationType}`,
        "NOTIFICATIONS",
        { recordId: record.id, targetUserId: input.targetUserId, dmConfigured: isDirectMessageConfigured(), hasPubkey: !!targetUser?.lightningPubkey }
      );
      return;
    }

    // 6. Deferred types: store sendAfter + message, return without sending
    if (DEFERRED_NOTIFICATION_TYPES.has(input.notificationType)) {
      const sendAfter = new Date(Date.now() + DEFERRED_DELAY_MS);
      await db.notificationTrigger.update({
        where: { id: record.id },
        data: { sendAfter, message: input.message },
      });
      logger.info(
        `[Notifications] Deferred ${input.notificationType} — will dispatch after ${sendAfter.toISOString()}`,
        "NOTIFICATIONS",
        { recordId: record.id, targetUserId: input.targetUserId, taskId, featureId }
      );
      return;
    }

    // 7. Immediate types: send via direct message now
    const result = await sendDirectMessage(decryptedPubkey!, input.message, {
      routeHint: targetUser!.sphinxRouteHint ?? undefined,
    });

    // 7a. Fire HUB push in parallel (fire-and-forget) if device token is set
    if (targetUser?.iosDeviceToken && workspace?.slug) {
      void sendHubPushNotification({
        deviceToken: targetUser.iosDeviceToken,
        message: buildPushMessage(input.message),
        workspaceSlug: workspace.slug,
        taskId: input.taskId ?? undefined,
        featureId: input.featureId ?? undefined,
      }).catch((err) =>
        logger.error("[Notifications] HUB push failed", "HUB_PUSH", { err })
      );
    }

    if (result.success) {
      logger.info(
        `[Notifications] Immediate ${input.notificationType} send succeeded`,
        "NOTIFICATIONS",
        { recordId: record.id, targetUserId: input.targetUserId }
      );
    } else {
      logger.warn(
        `[Notifications] Immediate ${input.notificationType} send failed: ${result.error}`,
        "NOTIFICATIONS",
        { recordId: record.id, targetUserId: input.targetUserId, error: result.error }
      );
    }

    // 8. Update record with outcome (persist message for auditability)
    await db.notificationTrigger.update({
      where: { id: record.id },
      data: {
        status: result.success
          ? NotificationTriggerStatus.SENT
          : NotificationTriggerStatus.FAILED,
        notificationTimestamps: { push: new Date() },
        message: input.message,
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
