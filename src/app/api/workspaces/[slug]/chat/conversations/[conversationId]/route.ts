import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { deriveAnonymousId } from "@/lib/ai/publicChatBudget";

// GET /api/workspaces/[slug]/chat/conversations/[conversationId]
// Retrieve specific conversation by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; conversationId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug, conversationId } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get workspace ID (+ org link, for the canvas fallback below)
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        sourceControlOrgId: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const conversationSelect = {
      id: true,
      title: true,
      messages: true,
      provenanceData: true,
      followUpQuestions: true,
      settings: true,
      isShared: true,
      lastMessageAt: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    } as const;

    // Primary lookup: a chat that belongs to THIS workspace (accessible
    // to any workspace member).
    let conversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
      },
      select: conversationSelect,
    });

    // Fallback: an org-canvas conversation for this workspace's parent
    // org. These are org-scoped (`workspaceId` null) so they miss the
    // query above — but the Canvas tab links here, so resolve them too.
    // Restricted to the caller's own rows (mirrors the canvas list
    // scope); 404 stays indistinguishable from "missing" for IDOR
    // safety.
    if (!conversation && workspace.sourceControlOrgId) {
      conversation = await db.sharedConversation.findFirst({
        where: {
          id: conversationId,
          sourceControlOrgId: workspace.sourceControlOrgId,
          source: "org-canvas",
          userId,
        },
        select: conversationSelect,
      });
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    const response: ConversationDetail = {
      id: conversation.id,
      // For org-canvas rows this is the workspace the viewer reached
      // them through, not the row's own (null) workspaceId — fine for
      // the read-only log view.
      workspaceId: workspace.id,
      userId: conversation.userId,
      title: conversation.title,
      messages: conversation.messages,
      provenanceData: conversation.provenanceData,
      followUpQuestions: conversation.followUpQuestions,
      settings: conversation.settings as any,
      isShared: conversation.isShared,
      lastMessageAt: conversation.lastMessageAt?.toISOString() || null,
      source: conversation.source,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      createdBy: conversation.user
        ? {
            id: conversation.user.id,
            name: conversation.user.name,
            email: conversation.user.email,
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to get conversation:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}

// PUT /api/workspaces/[slug]/chat/conversations/[conversationId]
// Append new messages to an existing conversation. Member-owned rows
// match by userId; anonymous rows on `isPublicViewable` workspaces
// match by anonymousId (so the same browser session can keep appending
// across turns).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; conversationId: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const { slug, conversationId } = await params;

  try {
    // Resolve access (member vs public viewer) and the workspace id.
    let workspaceId: string | null = null;
    let isPublicViewer = false;
    if (userId) {
      const access = await validateWorkspaceAccess(slug, userId, true);
      if (!access.hasAccess) {
        return NextResponse.json(
          { error: "Workspace not found or access denied" },
          { status: 403 }
        );
      }
      const workspace = await db.workspace.findFirst({
        where: { slug, deleted: false },
        select: { id: true },
      });
      if (!workspace) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 }
        );
      }
      workspaceId = workspace.id;
    } else {
      const access = await resolveWorkspaceAccess(request, { slug });
      if (access.kind !== "public-viewer") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      workspaceId = access.workspaceId;
      isPublicViewer = true;
    }

    // Parse request body
    const body = await request.json() as UpdateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Ownership check. Members own by userId. Public viewers own by
    // anonymousId — anyone with the same IP+UA hash can continue
    // appending. Acceptable for v1: a determined attacker on the
    // same network as a recent visitor could continue their chat
    // (low value), but cannot reach a member's chat (different
    // ownership column).
    const ownership = isPublicViewer
      ? { anonymousId: deriveAnonymousId(request), userId: null as string | null }
      : { userId };
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId,
        ...ownership,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Calculate new lastMessageAt from appended messages
    const newLastMessageAt = body.messages.length > 0
      ? (() => {
          const lastMsg = body.messages[body.messages.length - 1] as any;
          return lastMsg.createdAt ? new Date(lastMsg.createdAt) : new Date();
        })()
      : existing.lastMessageAt;

    // Append + write under a row-level lock. Two writers can race
    // for this row:
    //   1. This PUT (client autosave, e.g. user typed a message)
    //   2. `fanOutPlannerMessageToCanvas` (server-side, planner
    //      ASSISTANT message landed via the Stakwork webhook)
    // Both are append-only. Without `SELECT ... FOR UPDATE`, the
    // later read-modify-write can stomp the earlier one because each
    // reads `messages` before the other has written. Locking the row
    // serializes the two transactions; both appends land in arrival
    // order with no 409s or client retries. Net cost: a few ms of
    // hold-time per write. The alternative (losing planner messages)
    // is unacceptable. See `src/services/canvas-planner-fanout.ts`
    // for the matched wrap on the fan-out side. Precedent:
    // `src/app/api/w/[slug]/pool/workspaces/[workspaceId]/route.ts`.
    const updated = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        // Row was deleted between the ownership check above and the
        // lock. Surface as a 404 via the catch path.
        throw new Error("Conversation disappeared mid-transaction");
      }
      const existingMessages = (locked[0].messages as any[]) ?? [];
      const updatedMessages = [...existingMessages, ...body.messages];

      return tx.sharedConversation.update({
        where: {
          id: conversationId,
        },
        data: {
          messages: updatedMessages as any,
          lastMessageAt: newLastMessageAt,
          ...(body.title && { title: body.title }),
          ...(body.source && { source: body.source }),
          ...(body.settings !== undefined && { settings: body.settings as any }),
        },
        select: {
          id: true,
          title: true,
          messages: true,
          provenanceData: true,
          followUpQuestions: true,
          settings: true,
          isShared: true,
          lastMessageAt: true,
          source: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    });

    const response: ConversationDetail = {
      id: updated.id,
      workspaceId: workspaceId!,
      userId: updated.userId,
      title: updated.title,
      messages: updated.messages,
      provenanceData: updated.provenanceData,
      followUpQuestions: updated.followUpQuestions,
      settings: updated.settings as any,
      isShared: updated.isShared,
      lastMessageAt: updated.lastMessageAt?.toISOString() || null,
      source: updated.source,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      createdBy: updated.user
        ? {
            id: updated.user.id,
            name: updated.user.name,
            email: updated.user.email,
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

// DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]
// Delete conversation
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; conversationId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug, conversationId } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get workspace ID
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Verify conversation exists and user owns it
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Delete the conversation (hard delete - no soft delete in current schema)
    await db.sharedConversation.delete({
      where: {
        id: conversationId,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
