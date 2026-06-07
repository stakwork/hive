import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, session.user.id, true);

  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: { id: true, discordEnabled: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const channels = await db.discordChannel.findMany({
    where: {
      workspaceId: workspace.id,
      enabled: true,
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
          logger.error(`[DISCORD SYNC] Fan-out failed for channel ${ch.id}`, "DISCORD_SYNC", { error: err })
        )
      )
    );
  });

  return NextResponse.json({ dispatched: channels.length });
}
