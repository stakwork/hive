import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  SharedConversationData,
  GetSharedConversationResponse,
  SharedMessage,
  ProvenanceData,
} from "@/types/shared-conversation";

/**
 * GET /api/w/[slug]/chat/shared/[shareId]
 * 
 * Retrieves a shared conversation if the user is a workspace member.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; shareId: string }> }
) {
  try {
    // Authentication
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, shareId } = await params;

    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userOrResponse.id);
    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get workspace ID
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Fetch shared conversation
    const sharedConversation = await db.sharedConversation.findUnique({
      where: { id: shareId },
    });

    // Check if conversation exists
    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Verify the conversation belongs to the workspace
    if (sharedConversation.workspaceId !== workspace.id) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Parse and format the conversation data
    const conversationData: SharedConversationData = {
      id: sharedConversation.id,
      workspaceId: sharedConversation.workspaceId,
      userId: sharedConversation.userId,
      title: sharedConversation.title,
      messages: sharedConversation.messages as SharedMessage[],
      provenanceData: sharedConversation.provenanceData as ProvenanceData | null,
      followUpQuestions: (sharedConversation.followUpQuestions as string[]) || [],
      createdAt: sharedConversation.createdAt.toISOString(),
      updatedAt: sharedConversation.updatedAt.toISOString(),
    };

    const response: GetSharedConversationResponse = {
      conversation: conversationData,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching shared conversation:", error);

    return NextResponse.json(
      { error: "Failed to fetch shared conversation" },
      { status: 500 }
    );
  }
}
