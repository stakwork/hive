import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { discordUtil } from "@/lib/discord";

export async function GET(
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
    select: { discordBotToken: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (!workspace.discordBotToken) {
    return NextResponse.json({ error: "No Discord bot token configured" }, { status: 400 });
  }

  const encryptionService = EncryptionService.getInstance();
  const token = encryptionService.decryptField("discordBotToken", workspace.discordBotToken);

  try {
    const guilds = await discordUtil.getBotGuilds(token);

    const guildsWithChannels = await Promise.all(
      guilds.map(async (guild) => {
        try {
          const channels = await discordUtil.getGuildChannels(token, guild.id);
          return {
            id: guild.id,
            name: guild.name,
            channels: channels.map((ch) => ({
              id: ch.id,
              name: ch.name,
              type: ch.type,
            })),
          };
        } catch {
          // If we can't fetch channels for a guild, return it with empty channels
          return { id: guild.id, name: guild.name, channels: [] };
        }
      })
    );

    return NextResponse.json({ guilds: guildsWithChannels });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
