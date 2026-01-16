import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/workspaces/[slug]/shared/conversations/[shareCode]
 * Retrieves a shared conversation by share code (workspace members only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; shareCode: string }> }
) {
  try {
    // Authenticate user
    const context = getMiddlewareContext(request);
    const user = requireAuth(context);
    if (user instanceof NextResponse) {
      return user;
    }

    const { slug, shareCode } = await params;

    // Look up shared conversation by shareCode
    const sharedConversation = await db.sharedConversation.findUnique({
      where: {
        shareCode,
      },
      include: {
        workspace: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    // Return 404 if share code not found
    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 }
      );
    }

    // Verify the workspace slug matches
    if (sharedConversation.workspace.slug !== slug) {
      return NextResponse.json(
        { error: "Shared conversation not found in this workspace" },
        { status: 404 }
      );
    }

    // Verify user is workspace member
    const workspaceAccess = await validateWorkspaceAccess(slug, user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Access denied. You must be a member of this workspace to view shared conversations." },
        { status: 403 }
      );
    }

    // Return parsed messages JSON with metadata
    return NextResponse.json({
      id: sharedConversation.id,
      shareCode: sharedConversation.shareCode,
      title: sharedConversation.title,
      messages: sharedConversation.messages, // Already parsed from JSON by Prisma
      workspace: {
        id: sharedConversation.workspace.id,
        slug: sharedConversation.workspace.slug,
        name: sharedConversation.workspace.name,
      },
      createdBy: {
        id: sharedConversation.createdBy.id,
        name: sharedConversation.createdBy.name,
        email: sharedConversation.createdBy.email,
        image: sharedConversation.createdBy.image,
      },
      createdAt: sharedConversation.createdAt.toISOString(),
      updatedAt: sharedConversation.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error retrieving shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to retrieve shared conversation" },
      { status: 500 }
    );
  }
}
