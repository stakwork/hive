import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  type ContextTag,
  type Artifact,
  type ChatMessage,
} from "@/lib/chat";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
  icon?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      taskId,
      message,
      workflowUrl,
      contextTags = [] as ContextTag[],
      sourceWebsocketID,
      artifacts = [] as ArtifactRequest[],
    } = body;

    // Validate task exists (if taskId provided)
    if (taskId) {
      const task = await db.task.findFirst({
        where: {
          id: taskId,
          deleted: false,
        },
      });

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
    }

    // Create the chat message
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message: message || "",
        workflowUrl,
        role: ChatRole.ASSISTANT,
        contextTags: JSON.stringify(contextTags),
        status: ChatStatus.SENT,
        sourceWebsocketID,
        artifacts: {
          create: artifacts.map((artifact: ArtifactRequest) => ({
            type: artifact.type,
            content: artifact.content,
            icon: artifact.icon,
          })),
        },
      },
      include: {
        artifacts: true,
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // Convert to client-side type
    const clientMessage: ChatMessage = {
      ...chatMessage,
      contextTags: JSON.parse(
        chatMessage.contextTags as string,
      ) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    // Broadcast the new message via Pusher to all connected clients for this task
    if (taskId) {
      try {
        const channelName = getTaskChannelName(taskId);
        console.log(
          `🚀 Broadcasting message to Pusher channel: ${channelName}`,
        );
        console.log(`📨 Message content:`, {
          id: clientMessage.id,
          message: clientMessage.message,
          role: clientMessage.role,
          timestamp: clientMessage.timestamp,
        });

        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.NEW_MESSAGE,
          clientMessage,
        );

        console.log(
          `✅ Successfully broadcast message to Pusher channel: ${channelName}`,
        );
      } catch (error) {
        console.error("❌ Error broadcasting to Pusher:", error);
        // Don't fail the request if Pusher fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: clientMessage,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating chat response:", error);
    return NextResponse.json(
      { error: "Failed to create chat response" },
      { status: 500 },
    );
  }
}
