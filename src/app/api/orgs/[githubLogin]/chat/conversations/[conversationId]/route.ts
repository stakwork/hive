import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  getLastMessageTimestamp,
  generateTitle,
  UNTITLED_CONVERSATION,
} from "@/lib/ai/conversationHelpers";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import type { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

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

    // Scope by org, then allow the owner OR any org member when the row
    // is a shared room (`isShared`). Non-owner reads of a private row
    // return 404 (not 403) for IDOR safety. This is what lets a person
    // who opened a `?chat=<id>` share link read the live shared
    // conversation (and the live-sync refetch keep it up to date).
    const conversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
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

    if (
      !conversation ||
      (conversation.userId !== userOrResponse.id && !conversation.isShared)
    ) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Batch-resolve sender display info for all unique senderIds in the
    // conversation. One query covers all senders — keeps the write path
    // lean (only userId is stored) while ensuring names/avatars are fresh.
    const senderIds = [
      ...new Set(
        (Array.isArray(conversation.messages)
          ? (conversation.messages as unknown as StoredMessage[])
          : []
        )
          .map((m) => m.senderId)
          .filter((id): id is string => !!id),
      ),
    ];

    const senderUsers = senderIds.length
      ? await db.user.findMany({
          where: { id: { in: senderIds } },
          select: {
            id: true,
            image: true,
            githubAuth: { select: { githubUsername: true } },
          },
        })
      : [];

    const senderProfiles: Record<string, { username: string; avatarUrl?: string }> = {};
    for (const u of senderUsers) {
      senderProfiles[u.id] = {
        username: u.githubAuth?.githubUsername ?? u.id,
        avatarUrl: u.image ?? undefined,
      };
    }

    const response: ConversationDetail & {
      senderProfiles: Record<string, { username: string; avatarUrl?: string }>;
    } = {
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
      senderProfiles,
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

    // Ownership / share check before any write. The owner can always
    // append; non-owners may only append to rows explicitly marked
    // `isShared` — that's the "drop in and continue a shared
    // conversation" path (a `?chat=<shareId>` link adopts the shared
    // row as the joiner's server conversation). Private auto-save rows
    // stay owner-only. We still scope by org and return 404 (not 403)
    // for IDOR safety so other orgs' rows are indistinguishable from
    // missing.
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        sourceControlOrgId: org.id,
      },
      select: { id: true, userId: true, isShared: true },
    });

    if (
      !existing ||
      (existing.userId !== userOrResponse.id && !existing.isShared)
    ) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const isOwner = existing.userId === userOrResponse.id;
    const hasNewMessages = body.messages.length > 0;

    // SELECT FOR UPDATE serializes concurrent appends (same pattern as workspace route)
    const updated = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { messages: unknown; title: string | null; settings: unknown }[]
      >`
        SELECT messages, title, settings FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new Error("Conversation disappeared mid-transaction");
      }

      const existingMessages = (locked[0].messages as any[]) ?? [];
      const updatedMessages = [...existingMessages, ...body.messages];

      // Self-heal placeholder titles. The title is generated once at
      // create time from the first user message; if the creating POST's
      // delta happened to lead with a non-user message (or was empty),
      // the row is stuck as `UNTITLED_CONVERSATION`. Recompute from the
      // full message list the moment a user message becomes available —
      // an explicit `body.title` still wins.
      const storedTitle = locked[0].title;
      const needsTitleHeal =
        !body.title &&
        hasNewMessages &&
        (!storedTitle || storedTitle === UNTITLED_CONVERSATION);
      const healedTitle = needsTitleHeal
        ? generateTitle(updatedMessages)
        : null;

      return tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: updatedMessages as any,
          // Only bump the timestamp when we actually appended — a pure
          // metadata write (e.g. the Share button flipping `isShared`
          // with an empty `messages` array) shouldn't reorder history.
          ...(hasNewMessages && { lastMessageAt: getLastMessageTimestamp(body.messages) }),
          ...(body.title && { title: body.title }),
          ...(healedTitle && healedTitle !== UNTITLED_CONVERSATION
            ? { title: healedTitle }
            : {}),
          ...(body.source && { source: body.source }),
          // MERGE settings instead of overwriting. The client autosave
          // sends `settings: { extraWorkspaceSlugs }` on every PUT; a
          // blind overwrite would wipe server-written keys like
          // `promptPrefix` (the cached agent prompt prefix written by
          // `/api/ask/quick`). Spreading the locked row's settings first
          // preserves those while still applying the client's keys.
          ...(body.settings !== undefined && {
            settings: {
              ...((locked[0].settings as Record<string, unknown> | null) ?? {}),
              ...(body.settings as Record<string, unknown>),
            } as any,
          }),
          // Only the owner can change the shared-room flag (typically the
          // Share button turning it on). Joiners can append but can't
          // un-share someone else's conversation.
          ...(isOwner && body.isShared !== undefined && { isShared: body.isShared }),
        },
        select: {
          id: true,
          lastMessageAt: true,
        },
      });
    });

    // Live-sync: tell everyone sitting on this conversation's channel to
    // refetch. Only meaningful when messages were actually appended (a
    // pure share-flip changes no messages). Fire-and-forget; never throws.
    if (hasNewMessages) {
      notifyCanvasConversationUpdated(conversationId, "user-message");
    }

    return NextResponse.json({
      id: updated.id,
      lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/chat/conversations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}
