import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  // Verify cron authorization — same pattern as sphinx-summary/route.ts
  const isVercelCron = request.headers.get("x-vercel-cron");
  const authHeader = request.headers.get("authorization");

  if (!isVercelCron && process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Guard via env var — off by default so it must be explicitly enabled
  if (process.env.DISCORD_SYNC_CRON_ENABLED !== "true") {
    return NextResponse.json({ message: "Discord sync cron disabled" });
  }

  const channels = await db.discordChannel.findMany({
    where: {
      enabled: true,
      status: { in: ["ACTIVE", "ERRORED"] },
      workspace: {
        discordEnabled: true,
        discordBotToken: { not: null },
        deleted: false,
      },
    },
    select: { id: true },
  });

  after(async () => {
    await Promise.all(
      channels.map((ch) =>
        fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/workers/discord-channel-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_WORKER_SECRET}`,
          },
          body: JSON.stringify({ channelId: ch.id }),
        }).catch((err) =>
          logger.error(
            `[DISCORD CRON] Fan-out failed for channel ${ch.id}`,
            "DISCORD_CRON",
            { error: err }
          )
        )
      )
    );
  });

  logger.info(`[DISCORD CRON] Dispatched ${channels.length} channel sync jobs`);
  return NextResponse.json({ dispatched: channels.length });
}
