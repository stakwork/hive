import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { CreateSharedConversationRequest, SharedConversationResponse } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug } = await params;

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

    // Parse and validate request body
    const body = await request.json() as CreateSharedConversationRequest & { conversationId?: string };

    if (!body.messages) {
      return NextResponse.json(
        { error: "messages field is required" },
        { status: 400 }
      );
    }

    if (!body.followUpQuestions) {
      return NextResponse.json(
        { error: "followUpQuestions field is required" },
        { status: 400 }
      );
    }

    // Create shared conversation
    const sharedConversation = await db.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId,
        title: body.title || null,
        messages: body.messages as any,
        provenanceData: body.provenanceData as any || null,
        followUpQuestions: body.followUpQuestions as any,
      },
    });

    // If conversationId provided, link the shared conversation to the private conversation
    if (body.conversationId) {
      await db.conversation.update({
        where: {
          id: body.conversationId,
          userId,
          workspaceId: workspace.id,
        },
        data: {
          sharedConversationId: sharedConversation.id,
        },
      }).catch((error) => {
        console.error("Failed to link shared conversation to private conversation:", error);
        // Non-fatal error, continue with response
      });
    }

    const response: SharedConversationResponse = {
      shareId: sharedConversation.id,
      url: `/w/${slug}/chat/shared/${sharedConversation.id}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Failed to create shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to create shared conversation" },
      { status: 500 }
    );
  }
}
