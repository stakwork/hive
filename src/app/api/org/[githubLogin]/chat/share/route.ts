import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { CreateSharedConversationRequest, SharedConversationResponse } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

function generateTitle(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Untitled Conversation";
  }
  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) {
    return "Untitled Conversation";
  }
  let text = "";
  if (typeof firstUserMessage.content === "string") {
    text = firstUserMessage.content;
  } else if (Array.isArray(firstUserMessage.content)) {
    const textPart = firstUserMessage.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Untitled Conversation";
  }
  return trimmed.length > 50 ? trimmed.substring(0, 50) + "..." : trimmed;
}

function getLastMessageTimestamp(messages: any[]): Date | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.createdAt) {
    return new Date(lastMessage.createdAt);
  }
  return new Date();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { githubLogin } = await params;

  try {
    // Look up the org
    const org = await db.sourceControlOrg.findFirst({
      where: { githubLogin },
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Verify user has access to this org via SourceControlToken
    const token = await db.sourceControlToken.findFirst({
      where: { userId, sourceControlOrgId: org.id },
    });

    if (!token) {
      return NextResponse.json(
        { error: "Access denied. You must be an organization member." },
        { status: 403 }
      );
    }

    const body = await request.json() as CreateSharedConversationRequest;

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

    const title = body.title || generateTitle(body.messages as any[]);
    const lastMessageAt = getLastMessageTimestamp(body.messages as any[]);

    const sharedConversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: org.id,
        userId,
        title,
        messages: body.messages as any,
        provenanceData: body.provenanceData as any || null,
        followUpQuestions: body.followUpQuestions as any,
        isShared: true,
        lastMessageAt,
        source: body.source || null,
      },
    });

    const response: SharedConversationResponse = {
      shareId: sharedConversation.id,
      url: `/org/${githubLogin}/chat/shared/${sharedConversation.id}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Failed to create org shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to create shared conversation" },
      { status: 500 }
    );
  }
}
