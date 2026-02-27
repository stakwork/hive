import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import type { SphinxConfig } from "@/lib/sphinx/daily-pr-summary";

export const runtime = "nodejs";

// POST /api/features/[featureId]/invite - Send Sphinx invite to a workspace member
export async function POST(
  request: Request,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { featureId } = await params;
    const body = await request.json();
    const { inviteeUserId } = body;

    if (!inviteeUserId) {
      return NextResponse.json(
        { error: "inviteeUserId is required" },
        { status: 400 }
      );
    }

    // Fetch feature with workspace info
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        title: true,
        workspace: {
          select: {
            id: true,
            slug: true,
            sphinxEnabled: true,
            sphinxChatPubkey: true,
            sphinxBotId: true,
            sphinxBotSecret: true,
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const workspace = feature.workspace;

    // Validate Sphinx config
    if (
      !workspace.sphinxEnabled ||
      !workspace.sphinxChatPubkey ||
      !workspace.sphinxBotId ||
      !workspace.sphinxBotSecret
    ) {
      return NextResponse.json(
        { error: "Workspace Sphinx integration is not fully configured" },
        { status: 400 }
      );
    }

    // Fetch invitee
    const invitee = await db.user.findUnique({
      where: { id: inviteeUserId },
      select: { sphinxAlias: true },
    });

    if (!invitee || !invitee.sphinxAlias) {
      return NextResponse.json(
        { error: "Invitee does not have a Sphinx alias configured" },
        { status: 400 }
      );
    }

    // Decrypt bot secret
    const encryptionService = EncryptionService.getInstance();
    const decryptedSecret = encryptionService.decryptField("sphinxBotSecret", workspace.sphinxBotSecret);

    // Build plan URL
    const planUrl = `${process.env.NEXTAUTH_URL}/w/${workspace.slug}/plan/${featureId}`;

    // Get inviter name
    const inviterName = session.user.name || "A team member";

    // Format message
    const message = `@${invitee.sphinxAlias} — ${inviterName} has invited you to collaborate on '${feature.title}': ${planUrl}`;

    // Build Sphinx config
    const sphinxConfig: SphinxConfig = {
      chatPubkey: workspace.sphinxChatPubkey,
      botId: workspace.sphinxBotId,
      botSecret: decryptedSecret,
    };

    // Send to Sphinx
    const result = await sendToSphinx(sphinxConfig, message);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send Sphinx invite" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending Sphinx invite:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send invite" },
      { status: 500 }
    );
  }
}
