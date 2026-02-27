import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { CreateSharedConversationRequest, SharedConversationResponse } from "@/types/shared-conversation";
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

// Helper to get last message timestamp
function getLastMessageTimestamp(messages: any[]): Date | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  // Get timestamp from last message if available
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.createdAt) {
    return new Date(lastMessage.createdAt);
  }

  // Fallback to current time
  return new Date();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
    const isSuperAdmin = session.user?.isSuperAdmin ?? false;
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

    // Parse and validate request body
    const body = await request.json() as CreateSharedConversationRequest;

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

    // Auto-generate title if not provided
    const title = body.title || generateTitle(body.messages as any[]);
    const lastMessageAt = getLastMessageTimestamp(body.messages as any[]);

    let sharedConversation;

    // If conversationId provided, update existing conversation
    if (body.conversationId) {
      // Verify conversation exists and user has access
      const existing = await db.sharedConversation.findFirst({
        where: {
          id: body.conversationId,
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

      // Update existing conversation
      sharedConversation = await db.sharedConversation.update({
        where: {
          id: body.conversationId,
        },
        data: {
          title,
          messages: body.messages as any,
          provenanceData: body.provenanceData as any || null,
          followUpQuestions: body.followUpQuestions as any,
          isShared: true, // Mark as shared when sharing
          lastMessageAt,
          source: body.source || existing.source,
        },
      });
    } else {
      // Create new shared conversation
      sharedConversation = await db.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId,
          title,
          messages: body.messages as any,
          provenanceData: body.provenanceData as any || null,
          followUpQuestions: body.followUpQuestions as any,
          isShared: true, // Mark as shared when creating via share endpoint
          lastMessageAt,
          source: body.source || null,
        },
      });
    }

    const response: SharedConversationResponse = {
      shareId: sharedConversation.id,
      url: `/w/${slug}/chat/shared/${sharedConversation.id}`,
    };

    return NextResponse.json(response, { status: body.conversationId ? 200 : 201 });
  } catch (error) {
    console.error("Failed to create shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to create shared conversation" },
      { status: 500 }
    );
  }
}
