import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { ensureUniqueShareCode } from "@/lib/share-code";
import { validateWorkspaceAccess } from "@/services/workspace";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/workspaces/[slug]/conversations/share
 * Creates a shared conversation with a unique share code
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Authenticate user
    const context = getMiddlewareContext(request);
    const user = requireAuth(context);
    if (user instanceof NextResponse) {
      return user;
    }

    const { slug } = await params;

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccess(slug, user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Access denied to workspace" },
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
    const body = await request.json();
    const { messages, title } = body;

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Generate unique share code
    const shareCode = await ensureUniqueShareCode();

    // Create shared conversation
    const sharedConversation = await db.sharedConversation.create({
      data: {
        shareCode,
        title: title || null,
        workspaceId: workspace.id,
        createdById: user.id,
        messages: messages, // JSON snapshot of messages array
      },
    });

    // Return share code and URL
    return NextResponse.json(
      {
        shareCode: sharedConversation.shareCode,
        shareUrl: `/w/${slug}/shared/conversations/${sharedConversation.shareCode}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating shared conversation:", error);
    
    // Check if it's the retry exhaustion error
    if (error instanceof Error && error.message.includes("Failed to generate unique share code")) {
      return NextResponse.json(
        { error: "Unable to generate unique share code. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create shared conversation" },
      { status: 500 }
    );
  }
}
