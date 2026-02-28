import { authOptions } from "@/lib/auth/nextauth";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { ConversationListItem } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// Helper to generate title from first user message
function generateTitle(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Untitled Conversation";
  }

  // Find first user message
  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) {
    return "Untitled Conversation";
  }

  // Extract text content from message
  let text = "";
  if (typeof firstUserMessage.content === "string") {
    text = firstUserMessage.content;
  } else if (Array.isArray(firstUserMessage.content)) {
    // Handle multi-part messages
    const textPart = firstUserMessage.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  // Take first 50 chars and add ellipsis if needed
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Untitled Conversation";
  }
  
  return trimmed.length > 50 ? trimmed.substring(0, 50) + "..." : trimmed;
}

// Helper to get message preview
function getMessagePreview(messages: any[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  // Find first user message
  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) {
    return null;
  }

  // Extract text content from message
  let text = "";
  if (typeof firstUserMessage.content === "string") {
    text = firstUserMessage.content;
  } else if (Array.isArray(firstUserMessage.content)) {
    // Handle multi-part messages
    const textPart = firstUserMessage.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  return text.trim() || null;
}

// Helper to get last message timestamp
function getLastMessageTimestamp(messages: any[]): Date {
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Date();
  }

  // Get timestamp from last message if available
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.createdAt) {
    return new Date(lastMessage.createdAt);
  }

  // Fallback to current time
  return new Date();
}

// GET /api/workspaces/[slug]/chat/conversations
// List all conversations for the user in this workspace
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
    const isSuperAdmin = await checkIsSuperAdmin(userId);
  const { slug } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
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

    // Parse pagination parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const skip = (page - 1) * limit;

    // Get conversations for this user in this workspace
    const [conversations, total] = await Promise.all([
      db.sharedConversation.findMany({
        where: {
          workspaceId: workspace.id,
          userId,
        },
        orderBy: {
          lastMessageAt: "desc",
        },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          lastMessageAt: true,
          messages: true,
          source: true,
          isShared: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.sharedConversation.count({
        where: {
          workspaceId: workspace.id,
          userId,
        },
      }),
    ]);

    // Transform to list items with preview
    const items: ConversationListItem[] = conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      lastMessageAt: conv.lastMessageAt?.toISOString() || null,
      preview: getMessagePreview(conv.messages as any[]),
      source: conv.source,
      isShared: conv.isShared,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
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

// POST /api/workspaces/[slug]/chat/conversations
// Create a new conversation
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const isSuperAdmin = await checkIsSuperAdmin(userId);
  const { slug } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin });
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

    // Parse request body
    const body = await request.json();

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Auto-generate title if not provided
    const title = body.title || generateTitle(body.messages);
    const lastMessageAt = getLastMessageTimestamp(body.messages);

    // Create conversation
    const conversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title,
        messages: body.messages as any,
        provenanceData: body.provenanceData as any || null,
        followUpQuestions: body.followUpQuestions as any || [],
        isShared: false, // Not shared by default
        lastMessageAt,
        source: body.source || null,
      },
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        messages: true,
        provenanceData: true,
        followUpQuestions: true,
        source: true,
        isShared: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      id: conversation.id,
      workspaceId: workspace.id,
      userId: conversation.user.id,
      title: conversation.title,
      messages: conversation.messages,
      provenanceData: conversation.provenanceData,
      followUpQuestions: conversation.followUpQuestions,
      isShared: conversation.isShared,
      lastMessageAt: conversation.lastMessageAt?.toISOString() || null,
      source: conversation.source,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      createdBy: {
        id: conversation.user.id,
        name: conversation.user.name,
        email: conversation.user.email,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
