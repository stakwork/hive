import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import type { ConversationData, ConversationResponse, UpdateConversationRequest } from "@/types/conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// GET /api/workspaces/[slug]/chat/conversations/[conversationId]
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

    // Fetch conversation
    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

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

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}

// PUT /api/workspaces/[slug]/chat/conversations/[conversationId]
export async function PUT(
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

    // Verify conversation ownership
    const existingConversation = await db.conversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existingConversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Parse request body
    const body = (await request.json()) as UpdateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages field is required and must be an array" }, { status: 400 });
    }

    // Update title if not provided (from first user message)
    let title = body.title !== undefined ? body.title : existingConversation.title;
    if (!title && body.messages.length > 0) {
      const firstUserMessage = body.messages.find((m) => m.role === "user" && m.content.trim());
      if (firstUserMessage) {
        title = firstUserMessage.content.slice(0, 50) + (firstUserMessage.content.length > 50 ? "..." : "");
      }
    }

    // Update conversation
    const conversation = await db.conversation.update({
      where: { id: conversationId },
      data: {
        title,
        messages: body.messages as any,
        provenanceData: body.provenanceData !== undefined ? (body.provenanceData as any) : existingConversation.provenanceData,
        followUpQuestions: body.followUpQuestions !== undefined ? body.followUpQuestions : (existingConversation.followUpQuestions as any),
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

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}

// DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]
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

    // Verify conversation ownership and delete
    const deletedConversation = await db.conversation.deleteMany({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (deletedConversation.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
