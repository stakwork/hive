import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";

/**
 * Called once on each server cold start (via src/instrumentation.ts).
 * Detects a new production release by attempting to insert a unique AppRelease
 * record, then broadcasts to all Sphinx-enabled workspaces.
 */
export async function handleAppBoot(): Promise<void> {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  if (!version) {
    // No version tag — local dev or build without tag injection; skip silently.
    return;
  }

  const bootedAt = new Date();

  try {
    await db.appRelease.create({ data: { version, bootedAt } });
  } catch (error: any) {
    // P2002 = unique constraint violation — this version was already announced
    // (e.g., concurrent cold starts or a warm restart). Exit silently.
    if (error?.code === "P2002") {
      return;
    }
    // Unexpected DB error — log and bail without crashing startup.
    logger.error("[APP BOOT] Failed to write AppRelease record", "APP_RELEASE", { error });
    return;
  }

  // First boot of this version — log and broadcast.
  logger.info("[APP BOOT] New release detected", "APP_RELEASE", { version, bootedAt });

  const workspaces = await db.workspace.findMany({
    where: {
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
    },
    select: {
      id: true,
      slug: true,
      sphinxChatPubkey: true,
      sphinxBotId: true,
      sphinxBotSecret: true,
    },
  });

  const encryptionService = EncryptionService.getInstance();
  const message = `🚀 Hive ${version} is live on production!`;

  for (const workspace of workspaces) {
    try {
      const botSecret = encryptionService.decryptField("sphinxBotSecret", workspace.sphinxBotSecret!);
      const result = await sendToSphinx(
        {
          chatPubkey: workspace.sphinxChatPubkey!,
          botId: workspace.sphinxBotId!,
          botSecret,
        },
        message
      );

      if (!result.success) {
        logger.warn(
          `[APP BOOT] Failed to send release broadcast to workspace: ${workspace.slug}`,
          "APP_RELEASE",
          { error: result.error }
        );
      }
    } catch (error) {
      logger.error(
        `[APP BOOT] Error broadcasting to workspace: ${workspace.slug}`,
        "APP_RELEASE",
        { error }
      );
    }
  }
}
