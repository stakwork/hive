import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { extractClientIdFromToken } from "@/lib/discord";
import { z } from "zod";

const updateSchema = z.object({
  discordEnabled: z.boolean(),
  discordBotToken: z.string().optional(),
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
    select: {
      discordEnabled: true,
      discordClientId: true,
      discordBotToken: true,
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({
    discordEnabled: workspace.discordEnabled,
    discordClientId: workspace.discordClientId,
    hasToken: !!workspace.discordBotToken,
  });
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

  const body = await request.json();
  const validated = updateSchema.parse(body);

  const encryptionService = EncryptionService.getInstance();

  const updateData: Record<string, unknown> = {
    discordEnabled: validated.discordEnabled,
  };

  if (validated.discordBotToken) {
    const encrypted = encryptionService.encryptField("discordBotToken", validated.discordBotToken);
    updateData.discordBotToken = JSON.stringify(encrypted);
    updateData.discordClientId = extractClientIdFromToken(validated.discordBotToken);
  }

  const workspace = await db.workspace.update({
    where: { slug },
    data: updateData,
    select: {
      discordEnabled: true,
      discordClientId: true,
      discordBotToken: true,
    },
  });

  return NextResponse.json({
    discordEnabled: workspace.discordEnabled,
    discordClientId: workspace.discordClientId,
    hasToken: !!workspace.discordBotToken,
  });
}
