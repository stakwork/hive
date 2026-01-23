import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// GET /api/workspaces/[slug]/chat/conversations/[conversationId]
// Retrieve specific conversation by ID
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

    // Get conversation - user must own it
    const conversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
      select: {
        id: true,
        title: true,
        messages: true,
        provenanceData: true,
        followUpQuestions: true,
        isShared: true,
        lastMessageAt: true,
        source: true,
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

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    const response: ConversationDetail = {
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
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to get conversation:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}

// PUT /api/workspaces/[slug]/chat/conversations/[conversationId]
// Append new messages to existing conversation
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
    const body = await request.json() as UpdateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Get existing conversation - user must own it
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
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

    // Append new messages to existing messages
    const existingMessages = existing.messages as any[];
    const updatedMessages = [...existingMessages, ...body.messages];

    // Calculate new lastMessageAt from appended messages
    const newLastMessageAt = body.messages.length > 0
      ? (() => {
          const lastMsg = body.messages[body.messages.length - 1] as any;
          return lastMsg.createdAt ? new Date(lastMsg.createdAt) : new Date();
        })()
      : existing.lastMessageAt;

    // Update conversation
    const updated = await db.sharedConversation.update({
      where: {
        id: conversationId,
      },
      data: {
        messages: updatedMessages as any,
        lastMessageAt: newLastMessageAt,
        ...(body.title && { title: body.title }),
        ...(body.source && { source: body.source }),
      },
      select: {
        id: true,
        title: true,
        messages: true,
        provenanceData: true,
        followUpQuestions: true,
        isShared: true,
        lastMessageAt: true,
        source: true,
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

    const response: ConversationDetail = {
      id: updated.id,
      workspaceId: workspace.id,
      userId: updated.user.id,
      title: updated.title,
      messages: updated.messages,
      provenanceData: updated.provenanceData,
      followUpQuestions: updated.followUpQuestions,
      isShared: updated.isShared,
      lastMessageAt: updated.lastMessageAt?.toISOString() || null,
      source: updated.source,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      createdBy: {
        id: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

// DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]
// Delete conversation
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

    // Verify conversation exists and user owns it
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
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

    // Delete the conversation (hard delete - no soft delete in current schema)
    await db.sharedConversation.delete({
      where: {
        id: conversationId,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
