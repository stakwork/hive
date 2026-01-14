import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  CreateSharedConversationRequest,
  CreateSharedConversationResponse,
  SharedMessage,
} from "@/types/shared-conversation";

/**
 * POST /api/w/[slug]/chat/share
 * 
 * Creates a shared conversation that can be accessed by workspace members.
 * Automatically generates a title from the first user message (limited to 100 chars).
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
    const access = await validateWorkspaceAccess(slug, userOrResponse.id);
    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
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

    // Parse request body
    let body: CreateSharedConversationRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid request body" },
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
      if (!msg.role || !msg.content || typeof msg.content !== "string") {
        return NextResponse.json(
          { error: "Each message must have role and content fields" },
          { status: 400 }
        );
      }
      if (!["user", "assistant"].includes(msg.role)) {
        return NextResponse.json(
          { error: "Message role must be 'user' or 'assistant'" },
          { status: 400 }
        );
      }
    }

    // Generate title from first user message
    const firstUserMessage = body.messages.find((msg) => msg.role === "user");
    let title: string | null = null;
    
    if (firstUserMessage) {
      // Extract first 100 characters, clean up whitespace
      const rawTitle = firstUserMessage.content.trim().substring(0, 100);
      // If we truncated in the middle of a word, try to cut at last space
      if (firstUserMessage.content.length > 100) {
        const lastSpace = rawTitle.lastIndexOf(" ");
        title = lastSpace > 50 ? rawTitle.substring(0, lastSpace) + "..." : rawTitle + "...";
      } else {
        title = rawTitle;
      }
    }

    // Create shared conversation
    const sharedConversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId: userOrResponse.id,
        title,
        messages: body.messages as unknown as Prisma.JsonArray,
        provenanceData: body.provenanceData as unknown as Prisma.JsonObject | undefined,
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
    
    // Handle specific database errors
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid workspace or user reference" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to create shared conversation" },
      { status: 500 }
    );
  }
}
