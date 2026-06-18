import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  generateTitle,
  getMessagePreview,
  getLastMessageTimestamp,
} from "@/lib/ai/conversationHelpers";
import type { ConversationListItem } from "@/types/shared-conversation";

async function resolveOrg(githubLogin: string) {
  return db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
}

/**
 * GET /api/orgs/[githubLogin]/chat/conversations
 * List the calling user's recent org-canvas conversations (max 20).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "20", 10) || 20,
      20,
    );

    const conversations = await db.sharedConversation.findMany({
      where: {
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
        source: "org-canvas",
      },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        ownerSeenAt: true,
        messages: true,
        source: true,
        isShared: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const items: ConversationListItem[] = conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      preview: getMessagePreview(conv.messages as unknown[]),
      source: conv.source,
      isShared: conv.isShared,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      // Unread = content arrived since the owner last viewed this chat
      // (a backgrounded chat the agent advanced). Never seen yet but has
      // content → unread; otherwise compare timestamps.
      unread: conv.lastMessageAt
        ? !conv.ownerSeenAt || conv.lastMessageAt > conv.ownerSeenAt
        : false,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/chat/conversations] Error:", error);
    return NextResponse.json({ error: "Failed to list conversations" }, { status: 500 });
  }
}

/**
 * POST /api/orgs/[githubLogin]/chat/conversations
 * Create a new org-canvas conversation.
 * Body: { messages, settings?, source? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const org = await resolveOrg(githubLogin);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const body = await request.json();

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    const title = body.title || generateTitle(body.messages);
    const lastMessageAt = getLastMessageTimestamp(body.messages);

    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId: userOrResponse.id,
        workspaceId: null,
        messages: body.messages as any,
        title,
        lastMessageAt,
        source: body.source ?? "org-canvas",
        settings: (body.settings as any) ?? {},
        followUpQuestions: [],
        isShared: false,
      },
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
      },
    });

    return NextResponse.json(
      {
        id: conversation.id,
        title: conversation.title,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/chat/conversations] Error:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
}
