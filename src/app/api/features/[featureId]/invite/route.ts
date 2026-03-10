import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import type { SphinxConfig } from "@/lib/sphinx/daily-pr-summary";

export const runtime = "nodejs";

// POST /api/features/[featureId]/invite - Send Sphinx invite(s) to workspace member(s)
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
    const { inviteeUserId, inviteeUserIds } = body;

    // Normalise to array — accept either singular (backward compat) or plural
    const ids: string[] = inviteeUserIds ?? (inviteeUserId ? [inviteeUserId] : []);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "At least one invitee is required" },
        { status: 400 }
      );
    }

    if (ids.length > 3) {
      return NextResponse.json(
        { error: "Cannot invite more than 3 members at once" },
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

    // Fetch all invitees in one query
    const invitees = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, sphinxAlias: true },
    });

    // Validate that every requested invitee exists and has a Sphinx alias
    const missingAlias = invitees.find((u) => !u.sphinxAlias);
    if (missingAlias || invitees.length < ids.length) {
      return NextResponse.json(
        { error: "One or more invitees does not have a Sphinx alias configured" },
        { status: 400 }
      );
    }

    // Decrypt bot secret and build sphinxConfig once
    const encryptionService = EncryptionService.getInstance();
    const decryptedSecret = encryptionService.decryptField("sphinxBotSecret", workspace.sphinxBotSecret);

    const sphinxConfig: SphinxConfig = {
      chatPubkey: workspace.sphinxChatPubkey,
      botId: workspace.sphinxBotId,
      botSecret: decryptedSecret,
    };

    const planUrl = `${process.env.NEXTAUTH_URL}/w/${workspace.slug}/plan/${featureId}`;
    const inviterName = session.user.name || "A team member";

    let sent = 0;
    let failed = 0;

    for (const invitee of invitees) {
      const message = `@${invitee.sphinxAlias} — ${inviterName} has invited you to collaborate on '${feature.title}': ${planUrl}`;
      const result = await sendToSphinx(sphinxConfig, message);

      if (result.success) {
        sent++;
      } else {
        failed++;
      }
    }

    if (sent === 0) {
      return NextResponse.json(
        { error: "All invites failed to send", sent, failed },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, sent, failed });
  } catch (error) {
    console.error("Error sending Sphinx invite:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send invite" },
      { status: 500 }
    );
  }
}
