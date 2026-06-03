import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import { getLastMessageTimestamp } from "@/lib/ai/conversationHelpers";
import type { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

/**
 * GET /api/orgs/[githubLogin]/chat/conversations/[conversationId]
 * Return a single org-canvas conversation owned by the caller.
 * Returns 404 (not 403) for IDOR safety.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; conversationId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, conversationId } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // IDOR: match on both orgId and userId so other users get 404
    const conversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
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
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const response: ConversationDetail = {
      id: conversation.id,
      workspaceId: null as any, // org-scoped; no workspace
      userId: conversation.userId,
      title: conversation.title,
      messages: conversation.messages,
      provenanceData: conversation.provenanceData,
      followUpQuestions: conversation.followUpQuestions,
      settings: conversation.settings as any,
      isShared: conversation.isShared,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
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
    console.error("[GET /api/orgs/[githubLogin]/chat/conversations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to get conversation" }, { status: 500 });
  }
}

/**
 * PUT /api/orgs/[githubLogin]/chat/conversations/[conversationId]
 * Append new messages (delta) to an existing org-canvas conversation.
 * Uses SELECT FOR UPDATE to prevent concurrent-write races.
 * Returns 404 (not 403) for IDOR safety.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; conversationId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, conversationId } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const body = (await request.json()) as UpdateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    // IDOR ownership check before any write
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const newLastMessageAt = getLastMessageTimestamp(body.messages);

    // SELECT FOR UPDATE serializes concurrent appends (same pattern as workspace route)
    const updated = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new Error("Conversation disappeared mid-transaction");
      }

      const existingMessages = (locked[0].messages as any[]) ?? [];
      const updatedMessages = [...existingMessages, ...body.messages];

      return tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: updatedMessages as any,
          lastMessageAt: newLastMessageAt,
          ...(body.title && { title: body.title }),
          ...(body.source && { source: body.source }),
          ...(body.settings !== undefined && { settings: body.settings as any }),
        },
        select: {
          id: true,
          lastMessageAt: true,
        },
      });
    });

    return NextResponse.json({
      id: updated.id,
      lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/chat/conversations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}
