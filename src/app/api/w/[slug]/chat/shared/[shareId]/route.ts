import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { SharedConversationData } from "@/types/shared-conversation";

/**
 * GET /api/w/[slug]/chat/shared/[shareId]
 * 
 * Retrieves a shared conversation by ID
 * - Authenticates user
 * - Validates workspace membership
 * - Ensures conversation belongs to the workspace
 * - Returns full conversation data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; shareId: string }> }
) {
  try {
    // 1. Authenticate user
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Get params
    const { slug, shareId } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    if (!shareId) {
      return NextResponse.json(
        { error: "Share ID is required" },
        { status: 400 }
      );
    }

    // 3. Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId);

    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // 4. Get workspace to validate workspaceId
    const workspace = await db.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // 5. Fetch shared conversation
    const sharedConversation = await db.sharedConversation.findUnique({
      where: { id: shareId },
    });

    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // 6. Validate that conversation belongs to the workspace
    if (sharedConversation.workspaceId !== workspace.id) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // 7. Build response
    const response: SharedConversationData = {
      id: sharedConversation.id,
      workspaceId: sharedConversation.workspaceId,
      userId: sharedConversation.userId,
      title: sharedConversation.title,
      messages: sharedConversation.messages as any,
      provenanceData: sharedConversation.provenanceData as any,
      followUpQuestions: sharedConversation.followUpQuestions as any,
      createdAt: sharedConversation.createdAt.toISOString(),
      updatedAt: sharedConversation.updatedAt.toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching shared conversation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
