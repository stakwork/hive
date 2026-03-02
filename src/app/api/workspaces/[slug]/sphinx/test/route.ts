import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const isSuperAdmin = await checkIsSuperAdmin(session.user.id);
  const access = await validateWorkspaceAccess(slug, session.user.id, true, { isSuperAdmin });

  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: {
      name: true,
      sphinxEnabled: true,
      sphinxChatPubkey: true,
      sphinxBotId: true,
      sphinxBotSecret: true,
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (!workspace.sphinxEnabled) {
    return NextResponse.json({ error: "Sphinx integration is not enabled" }, { status: 400 });
  }

  if (!workspace.sphinxChatPubkey || !workspace.sphinxBotId || !workspace.sphinxBotSecret) {
    return NextResponse.json({ error: "Sphinx configuration is incomplete" }, { status: 400 });
  }

  const encryptionService = EncryptionService.getInstance();
  const botSecret = encryptionService.decryptField("sphinxBotSecret", workspace.sphinxBotSecret);

  const result = await sendToSphinx(
    {
      chatPubkey: workspace.sphinxChatPubkey,
      botId: workspace.sphinxBotId,
      botSecret,
    },
    `Test message from ${workspace.name} - Sphinx integration is working!`
  );

  return NextResponse.json(result);
}
