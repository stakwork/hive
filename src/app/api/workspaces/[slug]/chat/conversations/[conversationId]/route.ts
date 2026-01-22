import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { ConversationDetail, UpdateConversationRequest } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/**
 * GET /api/workspaces/[slug]/chat/conversations/[conversationId]
 * Retrieve a specific conversation by ID with full messages, provenanceData, and followUpQuestions
 */
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

    // Get conversation
    const conversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
      include: {
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
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const response: ConversationDetail = {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      userId: conversation.userId,
      title: conversation.title,
      messages: conversation.messages,
      provenanceData: conversation.provenanceData,
      followUpQuestions: conversation.followUpQuestions,
      source: conversation.source,
      isShared: conversation.isShared,
      lastMessageAt: conversation.lastMessageAt?.toISOString() || null,
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

/**
 * PUT /api/workspaces/[slug]/chat/conversations/[conversationId]
 * Update a conversation by appending new messages and updating lastMessageAt
 */
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

    // Get existing conversation
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json() as UpdateConversationRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "messages field is required and must be an array" },
        { status: 400 }
      );
    }

    // Append new messages to existing ones
    const existingMessages = Array.isArray(existing.messages) ? existing.messages : [];
    const updatedMessages = [...existingMessages, ...body.messages];

    // Update lastMessageAt
    const lastMessageAt = new Date();

    // Update conversation
    const updated = await db.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: updatedMessages as any,
        lastMessageAt,
        ...(body.title && { title: body.title }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      lastMessageAt: updated.lastMessageAt?.toISOString() || null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]
 * Delete a conversation (hard delete)
 */
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

    // Verify conversation exists and belongs to user
    const existing = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Delete conversation
    await db.sharedConversation.delete({
      where: { id: conversationId },
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
