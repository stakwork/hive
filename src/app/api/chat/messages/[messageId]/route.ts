import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { type ChatMessage, type ContextTag, type Artifact } from "@/lib/chat";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { messageId } = await params;

    if (!messageId) {
      return NextResponse.json(
        { error: "Message ID is required" },
        { status: 400 },
      );
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
        feature: {
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            githubAuth: {
              select: { githubUsername: true },
            },
          },
        },
      },
    });

    if (!chatMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Authorize via task or feature workspace membership
    const workspace = chatMessage.task?.workspace ?? chatMessage.feature?.workspace;
    if (!workspace) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const clientMessage = {
      ...chatMessage,
      contextTags: JSON.parse(
        chatMessage.contextTags as string,
      ) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    } as ChatMessage;

    return NextResponse.json(
      { success: true, data: clientMessage },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching message by id:", error);
    return NextResponse.json(
      { error: "Failed to fetch message" },
      { status: 500 },
    );
  }
}
