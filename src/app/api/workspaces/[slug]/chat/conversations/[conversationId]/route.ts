import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import {
  ConversationDetail,
  UpdateConversationRequest,
} from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/**
 * GET /api/workspaces/[slug]/chat/conversations/[conversationId]
 * Retrieve specific conversation by ID
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

    // Fetch conversation
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
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Transform to ConversationDetail format
    const detail: ConversationDetail = {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      userId: conversation.userId,
      title: conversation.title,
      messages: conversation.messages,
      provenanceData: conversation.provenanceData,
      followUpQuestions: conversation.followUpQuestions,
      isShared: conversation.isShared,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      source: conversation.source,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      createdBy: {
        id: conversation.user.id,
        name: conversation.user.name,
        email: conversation.user.email,
      },
    };

    return NextResponse.json(detail, { status: 200 });
  } catch (error) {
    console.error("Failed to retrieve conversation:", error);
    return NextResponse.json(
      { error: "Failed to retrieve conversation" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/workspaces/[slug]/chat/conversations/[conversationId]
 * Update existing conversation (append messages or update metadata)
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

    // Verify conversation ownership
    const existingConversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = (await request.json()) as UpdateConversationRequest;

    // Build update data
    const updateData: any = {
      lastMessageAt: new Date(), // Update timestamp
    };

    // If messages provided, append to existing messages
    if (body.messages) {
      const existingMessages = Array.isArray(existingConversation.messages)
        ? existingConversation.messages
        : [];
      const newMessages = Array.isArray(body.messages) ? body.messages : [];
      updateData.messages = [...existingMessages, ...newMessages];
    }

    // Update other fields if provided
    if (body.followUpQuestions !== undefined) {
      updateData.followUpQuestions = body.followUpQuestions;
    }

    if (body.provenanceData !== undefined) {
      updateData.provenanceData = body.provenanceData;
    }

    if (body.title !== undefined) {
      updateData.title = body.title;
    }

    // Update conversation
    const updatedConversation = await db.sharedConversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return NextResponse.json(
      {
        id: updatedConversation.id,
        updatedAt: updatedConversation.updatedAt.toISOString(),
      },
      { status: 200 }
    );
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
 * Delete conversation (hard delete)
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

    // Verify conversation ownership before deletion
    const existingConversation = await db.sharedConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId: workspace.id,
        userId,
      },
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Delete conversation (hard delete)
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
