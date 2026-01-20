import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import {
  ConversationListItem,
  ConversationSource,
  CreateConversationRequest,
} from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/**
 * GET /api/workspaces/[slug]/chat/conversations
 * List all conversations for authenticated user in workspace
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
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

    // Parse query parameters
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const source = url.searchParams.get("source") as
      | ConversationSource
      | "all"
      | null;

    // Build where clause
    const whereClause: any = {
      workspaceId: workspace.id,
      userId,
    };

    if (source && source !== "all") {
      whereClause.source = source;
    }

    // Fetch conversations
    const conversations = await db.sharedConversation.findMany({
      where: whereClause,
      orderBy: {
        lastMessageAt: "desc",
      },
      take: limit,
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        source: true,
        messages: true,
      },
    });

    // Transform to ConversationListItem format
    const conversationList: ConversationListItem[] = conversations.map(
      (conv) => {
        const messages = Array.isArray(conv.messages)
          ? conv.messages
          : [];
        const messageCount = messages.length;

        // Get preview from first user message (first 100 chars)
        let preview = "";
        const firstUserMessage = messages.find(
          (msg: any) => msg.role === "user"
        );
        if (firstUserMessage && firstUserMessage.content) {
          preview = String(firstUserMessage.content).substring(0, 100);
        }

        return {
          id: conv.id,
          title: conv.title,
          lastMessageAt: conv.lastMessageAt.toISOString(),
          source: conv.source,
          preview,
          messageCount,
        };
      }
    );

    return NextResponse.json(
      { conversations: conversationList },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to list conversations:", error);
    return NextResponse.json(
      { error: "Failed to list conversations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspaces/[slug]/chat/conversations
 * Create new conversation
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
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

    // Parse and validate request body
    const body = (await request.json()) as CreateConversationRequest;

    if (!body.messages) {
      return NextResponse.json(
        { error: "messages field is required" },
        { status: 400 }
      );
    }

    if (!body.followUpQuestions) {
      return NextResponse.json(
        { error: "followUpQuestions field is required" },
        { status: 400 }
      );
    }

    if (!body.source) {
      return NextResponse.json(
        { error: "source field is required" },
        { status: 400 }
      );
    }

    // Auto-generate title from first user message if not provided
    let title = body.title || null;
    if (!title) {
      const messages = Array.isArray(body.messages)
        ? body.messages
        : [];
      const firstUserMessage = messages.find(
        (msg: any) => msg.role === "user"
      );
      if (firstUserMessage && firstUserMessage.content) {
        title = String(firstUserMessage.content).substring(0, 50);
      }
    }

    // Create conversation
    const conversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title,
        messages: body.messages as any,
        provenanceData: (body.provenanceData as any) || null,
        followUpQuestions: body.followUpQuestions as any,
        source: body.source,
        isShared: false,
      },
    });

    return NextResponse.json(
      {
        id: conversation.id,
        title: conversation.title,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        source: conversation.source,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
