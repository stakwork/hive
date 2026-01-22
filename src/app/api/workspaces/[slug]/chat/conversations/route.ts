import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { ConversationListItem, CreateConversationRequest } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/**
 * GET /api/workspaces/[slug]/chat/conversations
 * List all conversations for the authenticated user in the workspace
 * Supports pagination via query params: page (default 1), limit (default 20)
 * Returns conversations sorted by lastMessageAt DESC
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

    // Parse pagination params
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    // Get conversations for this user in this workspace
    const [conversations, totalCount] = await Promise.all([
      db.sharedConversation.findMany({
        where: {
          workspaceId: workspace.id,
          userId,
        },
        select: {
          id: true,
          title: true,
          lastMessageAt: true,
          messages: true,
          source: true,
          isShared: true,
          createdAt: true,
        },
        orderBy: [
          { lastMessageAt: "desc" },
          { createdAt: "desc" },
        ],
        skip,
        take: limit,
      }),
      db.sharedConversation.count({
        where: {
          workspaceId: workspace.id,
          userId,
        },
      }),
    ]);

    // Extract preview from first user message
    const items: ConversationListItem[] = conversations.map((conv) => {
      let preview = "";
      try {
        const messages = Array.isArray(conv.messages) ? conv.messages : [];
        const firstUserMessage = messages.find(
          (m: any) => m && typeof m === "object" && m.role === "user" && m.content
        );
        if (firstUserMessage && typeof firstUserMessage === "object" && "content" in firstUserMessage) {
          const content = typeof firstUserMessage.content === "string"
            ? firstUserMessage.content
            : "";
          preview = content.slice(0, 100);
        }
      } catch (e) {
        // Ignore parse errors, leave preview empty
      }

      return {
        id: conv.id,
        title: conv.title,
        lastMessageAt: conv.lastMessageAt?.toISOString() || null,
        preview,
        source: conv.source,
        isShared: conv.isShared,
        createdAt: conv.createdAt.toISOString(),
      };
    });

    return NextResponse.json({
      conversations: items,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
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
 * Create a new conversation with messages
 * Auto-generates title from first user message (first 50 chars)
 * Sets lastMessageAt to current timestamp
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
    const body = await request.json() as CreateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "messages field is required and must be a non-empty array" },
        { status: 400 }
      );
    }

    // Auto-generate title from first user message if not provided
    let title = body.title || null;
    if (!title) {
      const firstUserMessage = body.messages.find(
        (m: any) => m && typeof m === "object" && m.role === "user" && m.content
      );
      if (firstUserMessage && typeof firstUserMessage === "object" && "content" in firstUserMessage) {
        const content = typeof firstUserMessage.content === "string"
          ? firstUserMessage.content
          : "";
        title = content.slice(0, 50).trim();
        if (content.length > 50) {
          title += "...";
        }
      }
    }

    // Calculate lastMessageAt from messages array
    const lastMessageAt = new Date();

    // Create conversation
    const conversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title,
        messages: body.messages as any,
        provenanceData: body.provenanceData as any || null,
        followUpQuestions: body.followUpQuestions as any || [],
        source: body.source || null,
        isShared: false,
        lastMessageAt,
      },
    });

    return NextResponse.json({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt?.toISOString() || null,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
