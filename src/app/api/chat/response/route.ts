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

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

// TODO: Implement real-time connection management
// const connections = new Map<string, Response>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      taskId,
      message,
      contextTags = [] as ContextTag[],
      sourceWebsocketID,
      artifacts = [] as ArtifactRequest[],
    } = body;

    // Validate required fields
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

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
        message,
        role: ChatRole.ASSISTANT,
        contextTags: JSON.stringify(contextTags),
        status: ChatStatus.SENT,
        sourceWebsocketID,
        artifacts: {
          create: artifacts.map((artifact: ArtifactRequest) => ({
            type: artifact.type,
            content: artifact.content,
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
        chatMessage.contextTags as string
      ) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    // TODO: Implement real-time broadcasting via WebSocket or SSE
    // For now, we just store the message in the database
    // The frontend can poll for new messages or use a WebSocket library
    console.log(
      "Chat message created and ready for broadcast:",
      clientMessage.id
    );

    return NextResponse.json(
      {
        success: true,
        data: clientMessage,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating chat response:", error);
    return NextResponse.json(
      { error: "Failed to create chat response" },
      { status: 500 }
    );
  }
}

// GET endpoint for Server-Sent Events connection (simplified for now)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspace");

  // TODO: Implement proper SSE/WebSocket connection
  // For now, return a simple response indicating the endpoint is available
  return NextResponse.json({
    message: "Real-time endpoint available",
    workspaceId,
    timestamp: new Date().toISOString(),
  });
}
