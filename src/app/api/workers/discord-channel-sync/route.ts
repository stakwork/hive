import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { discordUtil } from "@/lib/discord";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  // Machine-to-machine auth only — no session
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.INTERNAL_WORKER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await request.json();

  after(async () => {
    // IDOR check: verify channel exists and workspace is correctly configured
    const channel = await db.discordChannel.findUnique({
      where: { id: channelId },
      include: {
        workspace: {
          include: { swarm: true },
        },
      },
    });

    if (!channel || !channel.workspace.discordEnabled || !channel.workspace.discordBotToken) {
      logger.warn(
        `[DISCORD WORKER] Channel ${channelId} not found or workspace not configured`
      );
      return;
    }

    const encryptionService = EncryptionService.getInstance();
    const token = encryptionService.decryptField(
      "discordBotToken",
      channel.workspace.discordBotToken
    );

    const swarm = channel.workspace.swarm;
    if (!swarm?.swarmUrl || !swarm?.swarmApiKey) {
      logger.warn(
        `[DISCORD WORKER] No swarm configured for workspace ${channel.workspaceId}`
      );
      return;
    }

    const apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    // NOTE: Confirm exact write endpoint with Swarm team before merging.
    // Placeholder: POST {swarmUrl}:3355/graph/nodes
    const swarmGraphUrl = `${swarm.swarmUrl}:3355/graph/nodes`;

    let afterId: string | undefined = channel.lastMessageId ?? undefined;

    try {
      while (true) {
        const messages = await discordUtil.getChannelMessages(
          token,
          channel.channelId,
          afterId
        );
        if (!messages.length) break;

        // Discord returns newest-first — reverse to restore chronological order
        const ordered = [...messages].reverse();

        await fetch(swarmGraphUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": apiKey,
          },
          body: JSON.stringify({
            nodes: ordered.map((m) => ({
              type: "Communication",
              externalId: m.id,
              content: m.content || "[Attachment only]",
              timestamp: m.timestamp,
              metadata: {
                authorId: m.author?.id,
                guildId: channel.guildId,
                channelId: channel.channelId,
              },
            })),
          }),
        });

        // Atomic checkpoint — progress is safe even if the lambda times out here
        afterId = ordered[ordered.length - 1].id;
        await db.discordChannel.update({
          where: { id: channelId },
          data: {
            lastMessageId: afterId,
            lastSyncedAt: new Date(),
            consecutiveFailures: 0,
            syncError: null,
            status: "ACTIVE",
          },
        });
        logger.info(
          `[DISCORD WORKER] Checkpointed channel ${channelId} at message ${afterId}`
        );

        if (messages.length < 100) break;
      }
    } catch (err: unknown) {
      const errObj = err as { status?: number; message?: string };
      const isAccessError = errObj.status === 403 || errObj.status === 404;
      const nextFailures = channel.consecutiveFailures + 1;
      const shouldDisable = isAccessError || nextFailures >= 5;

      await db.discordChannel.update({
        where: { id: channelId },
        data: {
          consecutiveFailures: nextFailures,
          syncError: errObj.message || String(err),
          status: shouldDisable ? "DISABLED_BY_SYSTEM" : "ERRORED",
          enabled: shouldDisable ? false : channel.enabled,
        },
      });

      logger.error(
        `[DISCORD WORKER] Channel ${channelId} ${shouldDisable ? "circuit-broken → DISABLED_BY_SYSTEM" : "errored"}`,
        "DISCORD_WORKER",
        { error: err }
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
