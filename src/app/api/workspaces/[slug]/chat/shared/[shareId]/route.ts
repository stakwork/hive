import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { SharedConversationData } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; shareId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug, shareId } = await params;

  try {
    // Find workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is a workspace member (owner or explicit member)
    const isOwner = workspace.ownerId === userId;
    const isMember = isOwner || await db.workspaceMember.findFirst({
      where: {
        workspaceId: workspace.id,
        userId,
        leftAt: null,
      },
    });

    if (!isMember) {
      return NextResponse.json(
        { error: "Access denied. You must be a workspace member to view shared conversations." },
        { status: 403 }
      );
    }

    // Fetch the shared conversation
    const sharedConversation = await db.sharedConversation.findUnique({
      where: {
        id: shareId,
      },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
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

    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Verify the shared conversation belongs to the workspace
    // Return 404 instead of 403 to avoid information leakage about resources in other workspaces
    if (sharedConversation.workspaceId !== workspace.id) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Return the conversation data
    const response: SharedConversationData = {
      id: sharedConversation.id,
      workspaceId: sharedConversation.workspaceId,
      userId: sharedConversation.userId,
      title: sharedConversation.title,
      messages: sharedConversation.messages,
      provenanceData: sharedConversation.provenanceData,
      followUpQuestions: sharedConversation.followUpQuestions,
      isShared: sharedConversation.isShared,
      lastMessageAt: sharedConversation.lastMessageAt?.toISOString() ?? null,
      source: sharedConversation.source,
      createdAt: sharedConversation.createdAt.toISOString(),
      updatedAt: sharedConversation.updatedAt.toISOString(),
      createdBy: {
        id: sharedConversation.user.id,
        name: sharedConversation.user.name,
        email: sharedConversation.user.email,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared conversation" },
      { status: 500 }
    );
  }
}
