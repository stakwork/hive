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
import {
  redactHtmlToolInput,
  redactHtmlToolOutput,
} from "@/services/canvas-turn-persistence";
import {
  isRemovedTurn,
  stripServerOnlySettingsKeys,
} from "@/lib/canvas/tombstones";
import { turnIdFromRowId } from "@/lib/canvas/turnEdit";
import type { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";

/**
 * Server-owned row id shapes this client-facing PUT must never accept,
 * even from the authoring tab's own autosave: `${turnId}-u` (the user
 * row) and `${turnId}-a*` / `${turnId}-n*` (assistant rows). Those are
 * written ONLY by `persistCanvasUserMessage` / `appendTurnMessages` —
 * accepting a client-supplied copy here would let a stale/forged client
 * row resurrect content a tombstone already removed, or shadow-write
 * over the server's own row under the same id.
 */
function isServerOwnedTurnRowId(id: unknown): boolean {
  return typeof id === "string" && turnIdFromRowId(id) !== undefined;
}

/**
 * The client autosave PUT is a second writer into
 * `SharedConversation.messages` alongside the server-side turn
 * persistence path (`canvas-turn-persistence.ts`'s `messagesFromSteps`).
 * It carries the same risk: a client-supplied `toolCalls[].input`/
 * `[].output` for `save_html`/`update_html`/`get_html` can contain a raw
 * HTML page body (or, for `update_html`'s edit mode, verbatim
 * `edits[].oldStr`/`newStr` fragments of the page). Apply the same
 * redactors here so this path can't reintroduce the leak the server
 * turn writer closes.
 */
function redactIncomingMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;
    if (!Array.isArray(record.toolCalls)) return message;
    const toolCalls = record.toolCalls.map((tc) => {
      if (!tc || typeof tc !== "object") return tc;
      const call = tc as Record<string, unknown>;
      const toolName = typeof call.toolName === "string" ? call.toolName : "";
      return {
        ...call,
        ...("input" in call
          ? { input: redactHtmlToolInput(toolName, call.input) }
          : {}),
        ...("output" in call
          ? { output: redactHtmlToolOutput(toolName, call.output) }
          : {}),
      };
    });
    return { ...record, toolCalls };
  });
}

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

    // SELECT FOR UPDATE serializes concurrent appends (same pattern as workspace route)
    let droppedCount = 0;
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
      const settings = locked[0].settings;

      // Drop any incoming row this PUT must never accept: a
      // server-owned turn-row id (`${turnId}-u`/`-a*`/`-n*` — those are
      // written ONLY by the server turn writer), or a row tied (by id
      // prefix or `originTurnId`) to a turn that's been tombstoned by an
      // edit. Logged, not rejected — a client autosave racing a
      // server-side truncation is an expected, non-error event.
      const redacted = redactIncomingMessages(body.messages).map((m) => {
        if (!m || typeof m !== "object") return m;
        const record = m as Record<string, unknown>;
        // Authorship is session-derived, never client-trusted: a client
        // could otherwise forge `authorId` to make a row editable (or
        // non-editable) by someone else.
        if (record.role === "user") {
          return { ...record, authorId: userOrResponse.id };
        }
        return record;
      });
      const incoming = redacted.filter((m) => {
        if (!m || typeof m !== "object") return true;
        const record = m as Record<string, unknown>;
        if (isServerOwnedTurnRowId(record.id)) {
          droppedCount++;
          return false;
        }
        const originTurnId =
          typeof record.originTurnId === "string" ? record.originTurnId : undefined;
        const taggedTurnId = turnIdFromRowId(record.id) ?? originTurnId;
        if (taggedTurnId && isRemovedTurn(settings, taggedTurnId)) {
          droppedCount++;
          return false;
        }
        return true;
      });
      const hasNewMessages = incoming.length > 0;

      const updatedMessages = [...existingMessages, ...incoming];

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

      // Incoming `body.settings` is client-supplied — strip server-only
      // tombstone/title-tracking keys before merging so a client can
      // never clear or forge `removedTurnIds` / `truncationEpoch` /
      // `titleSource` (even an innocent echo of a GET response body).
      const safeIncomingSettings = body.settings
        ? stripServerOnlySettingsKeys(body.settings as Record<string, unknown>)
        : undefined;

      return tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: updatedMessages as any,
          // Only bump the timestamp when we actually appended — a pure
          // metadata write (e.g. the Share button flipping `isShared`
          // with an empty `messages` array) shouldn't reorder history.
          ...(hasNewMessages && { lastMessageAt: getLastMessageTimestamp(incoming as any[]) }),
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
          ...(safeIncomingSettings !== undefined && {
            settings: {
              ...((settings as Record<string, unknown> | null) ?? {}),
              ...safeIncomingSettings,
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

    if (droppedCount > 0) {
      console.log("[org-chat] put-dropped-rows", {
        conversationId,
        droppedCount,
        reason: "tombstoned-or-server-owned",
      });
    }

    // Live-sync: tell everyone sitting on this conversation's channel to
    // refetch. Only meaningful when messages were actually appended (a
    // pure share-flip changes no messages). Fire-and-forget; never throws.
    if (body.messages.length > droppedCount) {
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
