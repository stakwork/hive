import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { z } from "zod";

const updateSchema = z.object({
  sphinxEnabled: z.boolean(),
  sphinxChatPubkey: z.string().nullable(),
  sphinxBotId: z.string().nullable(),
  sphinxBotSecret: z.string().optional(), // Only provided when changing
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
  const access = await validateWorkspaceAccess(slug, session.user.id);

  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: {
      sphinxEnabled: true,
      sphinxChatPubkey: true,
      sphinxBotId: true,
      sphinxBotSecret: true,
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({
    sphinxEnabled: workspace.sphinxEnabled,
    sphinxChatPubkey: workspace.sphinxChatPubkey,
    sphinxBotId: workspace.sphinxBotId,
    hasBotSecret: !!workspace.sphinxBotSecret,
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
  const access = await validateWorkspaceAccess(slug, session.user.id);

  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const validated = updateSchema.parse(body);

  const encryptionService = EncryptionService.getInstance();

  const updateData: any = {
    sphinxEnabled: validated.sphinxEnabled,
    sphinxChatPubkey: validated.sphinxChatPubkey,
    sphinxBotId: validated.sphinxBotId,
  };

  // Only update secret if provided
  if (validated.sphinxBotSecret) {
    const encrypted = encryptionService.encryptField("sphinxBotSecret", validated.sphinxBotSecret);
    updateData.sphinxBotSecret = JSON.stringify(encrypted);
  }

  await db.workspace.update({
    where: { slug },
    data: updateData,
  });

  return NextResponse.json({ success: true });
}
