import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import {
  CreateSharedConversationRequest,
  CreateSharedConversationResponse,
  SharedMessage,
} from "@/types/shared-conversation";

/**
 * POST /api/w/[slug]/chat/share
 * 
 * Creates a shared conversation within a workspace
 * - Authenticates user
 * - Validates workspace membership
 * - Generates title from first user message (max 100 chars)
 * - Returns shareId and URL for accessing the shared conversation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
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

    // 2. Get workspace slug from params
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
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

    // 4. Parse request body
    let body: CreateSharedConversationRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { messages, provenanceData, followUpQuestions } = body;

    // 5. Validate request body
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    if (!followUpQuestions || !Array.isArray(followUpQuestions)) {
      return NextResponse.json(
        { error: "followUpQuestions array is required" },
        { status: 400 }
      );
    }

    // Validate message structure
    for (const message of messages) {
      if (!message.role || !message.content) {
        return NextResponse.json(
          { error: "Each message must have role and content" },
          { status: 400 }
        );
      }
      if (message.role !== "user" && message.role !== "assistant") {
        return NextResponse.json(
          { error: "Message role must be 'user' or 'assistant'" },
          { status: 400 }
        );
      }
    }

    // 6. Get workspace by slug to retrieve workspaceId
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

    // 7. Generate title from first user message (max 100 chars)
    const firstUserMessage = messages.find(
      (msg: SharedMessage) => msg.role === "user"
    );
    const title = firstUserMessage
      ? firstUserMessage.content.slice(0, 100)
      : null;

    // 8. Create shared conversation in database
    const sharedConversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title,
        messages: messages as unknown as any, // Prisma Json type
        provenanceData: provenanceData || null,
        followUpQuestions: followUpQuestions as unknown as any, // Prisma Json type
      },
    });

    // 9. Build response with shareId and URL
    const response: CreateSharedConversationResponse = {
      shareId: sharedConversation.id,
      url: `/w/${slug}/chat/shared/${sharedConversation.id}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating shared conversation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
