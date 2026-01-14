import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import type { SharedConversationData } from "@/types/shared-conversation";

/**
 * GET /api/w/[slug]/chat/shared/[shareId]
 * Retrieves a shared conversation if the user is a member of the workspace
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
    const workspaceValidation = await validateWorkspaceAccess(slug, userOrResponse.id);

    if (!workspaceValidation.hasAccess || !workspaceValidation.workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Fetch shared conversation
    const sharedConversation = await db.sharedConversation.findUnique({
      where: {
        id: shareId,
      },
    });

    // Check if conversation exists
    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Verify the conversation belongs to the same workspace
    if (sharedConversation.workspaceId !== workspaceValidation.workspace.id) {
      return NextResponse.json(
        { error: "Access denied: conversation belongs to a different workspace" },
        { status: 403 }
      );
    }

    // Build response with properly typed data
    const response: SharedConversationData = {
      id: sharedConversation.id,
      workspaceId: sharedConversation.workspaceId,
      userId: sharedConversation.userId,
      title: sharedConversation.title,
      messages: sharedConversation.messages as any[], // Prisma Json type
      provenanceData: sharedConversation.provenanceData as any | null, // Prisma Json type
      followUpQuestions: sharedConversation.followUpQuestions as string[], // Prisma Json type
      createdAt: sharedConversation.createdAt,
      updatedAt: sharedConversation.updatedAt,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching shared conversation:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch shared conversation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
