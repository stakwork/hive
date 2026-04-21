import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import type { SphinxConfig } from "@/lib/sphinx/daily-pr-summary";
import { validateWorkspaceAccessById } from "@/services/workspace";

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

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
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
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const workspace = feature.workspace;

    // IDOR guard: before this check any signed-in user could broadcast
    // attacker-controlled invite messages into the victim workspace's
    // Sphinx channel using the victim's bot credentials, naming
    // arbitrary users as invitees. Require an active workspace member
    // with `canWrite` before decrypting `sphinxBotSecret` or calling
    // `sendToSphinx`.
    const access = await validateWorkspaceAccessById(workspace.id, userId);
    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

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

    // Fetch all invitees in one query, then restore the caller's order.
    // Also require each invitee to be an active member of this workspace
    // (or the workspace owner) so the caller can't name arbitrary
    // @-aliases into the Sphinx message.
    const inviteesRaw = await db.user.findMany({
      where: {
        id: { in: ids },
        OR: [
          { ownedWorkspaces: { some: { id: workspace.id } } },
          {
            workspaceMembers: {
              some: { workspaceId: workspace.id, leftAt: null },
            },
          },
        ],
      },
      select: { id: true, sphinxAlias: true },
    });
    const invitees = ids
      .map((id) => inviteesRaw.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => u !== undefined);

    // Validate that every requested invitee exists, is a workspace member,
    // and has a Sphinx alias configured.
    const missingAlias = invitees.find((u) => !u.sphinxAlias);
    if (missingAlias || invitees.length < ids.length) {
      return NextResponse.json(
        { error: "One or more invitees is not a workspace member or lacks a Sphinx alias" },
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

    // Build alias prefix: "@Alice", "@Alice & @Bob", or "@Alice, @Bob & @Charlie"
    const aliases = invitees.map((u) => `@${u.sphinxAlias}`);
    const aliasPrefix =
      aliases.length === 1
        ? aliases[0]
        : aliases.slice(0, -1).join(", ") + " & " + aliases[aliases.length - 1];

    const message = `${aliasPrefix} — ${inviterName} has invited you to collaborate on '${feature.title}': ${planUrl}`;
    const result = await sendToSphinx(sphinxConfig, message);

    const sent = result.success ? invitees.length : 0;
    const failed = result.success ? 0 : invitees.length;

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
