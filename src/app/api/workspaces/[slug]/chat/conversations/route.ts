import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import type {
  ConversationListResponse,
  ConversationResponse,
  CreateConversationRequest,
  ConversationData,
  ConversationListItem,
} from "@/types/conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// GET /api/workspaces/[slug]/chat/conversations
// Query params: limit (default 20), offset (default 0)
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    // Get workspace ID
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Parse query params
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Fetch conversations for this user in this workspace
    const [conversations, total] = await Promise.all([
      db.conversation.findMany({
        where: {
          workspaceId: workspace.id,
          userId,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          messages: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.conversation.count({
        where: {
          workspaceId: workspace.id,
          userId,
        },
      }),
    ]);

    // Transform to list items
    const listItems: ConversationListItem[] = conversations.map((conv) => {
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        messageCount: messages.length,
      };
    });

    const response: ConversationListResponse = {
      conversations: listItems,
      total,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}

// POST /api/workspaces/[slug]/chat/conversations
// Create a new conversation
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    // Get workspace ID
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Parse request body
    const body = (await request.json()) as CreateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages field is required and must be an array" }, { status: 400 });
    }

    // Generate title from first user message if not provided
    let title = body.title || null;
    if (!title && body.messages.length > 0) {
      const firstUserMessage = body.messages.find((m) => m.role === "user" && m.content.trim());
      if (firstUserMessage) {
        title = firstUserMessage.content.slice(0, 50) + (firstUserMessage.content.length > 50 ? "..." : "");
      }
    }

    // Create conversation
    const conversation = await db.conversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title,
        messages: body.messages as any,
        provenanceData: body.provenanceData as any,
        followUpQuestions: body.followUpQuestions || [],
      },
    });

    // Transform to response format
    const conversationData: ConversationData = {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      userId: conversation.userId,
      title: conversation.title,
      messages: conversation.messages as any,
      provenanceData: conversation.provenanceData as any,
      followUpQuestions: (conversation.followUpQuestions as any) || [],
      sharedConversationId: conversation.sharedConversationId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };

    const response: ConversationResponse = {
      conversation: conversationData,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
}
