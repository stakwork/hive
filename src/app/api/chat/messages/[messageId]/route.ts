import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { type ChatMessage, type ContextTag, type Artifact } from "@/lib/chat";

export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const { messageId } = await params;

    if (!messageId) {
      return NextResponse.json({ error: "Message ID is required" }, { status: 400 });
    }

    const chatMessage = await db.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        task: {
          select: {
            id: true,
            workspace: {
              select: {
                id: true,
                ownerId: true,
                members: {
                  where: { userId },
                  select: { role: true },
                },
              },
            },
          },
        },
        artifacts: {
          orderBy: { createdAt: "asc" },
        },
        attachments: true,
      },
    });

    if (!chatMessage || !chatMessage.task) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const isOwner = chatMessage.task.workspace.ownerId === userId;
    const isMember = chatMessage.task.workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const clientMessage: ChatMessage = {
      ...chatMessage,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    return NextResponse.json({ success: true, data: clientMessage }, { status: 200 });
  } catch (error) {
    console.error("Error fetching message by id:", error);
    return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 });
  }
}
