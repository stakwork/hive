import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { z } from "zod";

const channelSchema = z.object({
  guildId: z.string(),
  guildName: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  channelType: z.number().int().default(0),
});

const putSchema = z.object({
  channels: z.array(channelSchema),
});

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
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const channels = await db.discordChannel.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { guildName: "asc" },
  });

  return NextResponse.json({ channels });
}

export async function PUT(
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
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json();
  const validated = putSchema.parse(body);

  // Upsert each selected channel
  await Promise.all(
    validated.channels.map((ch) =>
      db.discordChannel.upsert({
        where: {
          workspaceId_channelId: {
            workspaceId: workspace.id,
            channelId: ch.channelId,
          },
        },
        create: {
          workspaceId: workspace.id,
          guildId: ch.guildId,
          guildName: ch.guildName,
          channelId: ch.channelId,
          channelName: ch.channelName,
          channelType: ch.channelType,
        },
        update: {
          guildId: ch.guildId,
          guildName: ch.guildName,
          channelName: ch.channelName,
          channelType: ch.channelType,
          // Re-enable if previously disabled
          enabled: true,
        },
      })
    )
  );

  // Remove channels that are no longer in the selection
  const selectedChannelIds = validated.channels.map((ch) => ch.channelId);
  await db.discordChannel.deleteMany({
    where: {
      workspaceId: workspace.id,
      channelId: { notIn: selectedChannelIds },
    },
  });

  const channels = await db.discordChannel.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { guildName: "asc" },
  });

  return NextResponse.json({ channels });
}
