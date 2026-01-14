import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import type {
  CreateSharedConversationRequest,
  CreateSharedConversationResponse,
  SharedConversationMessage,
} from "@/types/shared-conversation";

/**
 * POST /api/w/[slug]/chat/share
 * Creates a shared conversation for the authenticated user in the workspace
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Authentication
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    // Validate workspace access
    const workspaceValidation = await validateWorkspaceAccess(slug, userOrResponse.id);

    if (!workspaceValidation.hasAccess || !workspaceValidation.workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Parse request body
    let body: CreateSharedConversationRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Validate request body
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Validate message structure
    for (const msg of body.messages) {
      if (!msg.id || !msg.content || !msg.role || !msg.timestamp) {
        return NextResponse.json(
          { error: "Each message must have id, content, role, and timestamp" },
          { status: 400 }
        );
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        return NextResponse.json(
          { error: "Message role must be 'user' or 'assistant'" },
          { status: 400 }
        );
      }
    }

    // Auto-generate title from first user message (limit to 100 chars)
    const firstUserMessage = body.messages.find(
      (msg: SharedConversationMessage) => msg.role === "user"
    );
    let title: string | null = null;
    if (firstUserMessage) {
      title = firstUserMessage.content.substring(0, 100);
      // Add ellipsis if truncated
      if (firstUserMessage.content.length > 100) {
        title += "...";
      }
    }

    // Create shared conversation
    const sharedConversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspaceValidation.workspace.id,
        userId: userOrResponse.id,
        title,
        messages: body.messages,
        provenanceData: body.provenanceData || null,
        followUpQuestions: body.followUpQuestions || [],
      },
    });

    // Build response
    const response: CreateSharedConversationResponse = {
      shareId: sharedConversation.id,
      url: `/w/${slug}/chat/shared/${sharedConversation.id}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating shared conversation:", error);
    return NextResponse.json(
      {
        error: "Failed to create shared conversation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
