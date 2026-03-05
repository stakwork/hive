import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  NotificationMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import { logger } from "@/lib/logger";

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

    // 1. Fetch workspace and user in parallel
    const [workspace, targetUser] = await Promise.all([
      db.workspace.findUnique({
        where: { id: input.workspaceId },
        select: {
          sphinxEnabled: true,
          sphinxBotId: true,
          sphinxBotSecret: true,
          sphinxChatPubkey: true,
        },
      }),
      db.user.findUnique({
        where: { id: input.targetUserId },
        select: { sphinxAlias: true },
      }),
    ]);

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

    // 3. Determine if Sphinx delivery is possible
    const sphinxReady =
      !!workspace?.sphinxEnabled &&
      !!workspace.sphinxBotId &&
      !!workspace.sphinxBotSecret &&
      !!workspace.sphinxChatPubkey &&
      !!targetUser?.sphinxAlias;

    // Always insert a row — SKIPPED when Sphinx is not configured, PENDING otherwise
    const record = await db.notificationTrigger.create({
      data: {
        targetUserId: input.targetUserId,
        originatingUserId: input.originatingUserId ?? null,
        taskId,
        featureId,
        notificationType: input.notificationType,
        status: sphinxReady
          ? NotificationTriggerStatus.PENDING
          : NotificationTriggerStatus.SKIPPED,
        notificationMethod: NotificationMethod.SPHINX,
        notificationTimestamps: [],
      },
    });

    // If Sphinx not ready, stop here — row is recorded for audit purposes
    if (!sphinxReady) {
      return;
    }

    // 4. Decrypt bot secret
    const decryptedSecret = EncryptionService.getInstance().decryptField(
      "sphinxBotSecret",
      workspace!.sphinxBotSecret!
    );

    // 5. Send via Sphinx
    const result = await sendToSphinx(
      {
        chatPubkey: workspace!.sphinxChatPubkey!,
        botId: workspace!.sphinxBotId!,
        botSecret: decryptedSecret,
      },
      input.message
    );

    // 6. Update record with outcome
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
