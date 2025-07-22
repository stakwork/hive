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

// Connection management for SSE
interface SSEConnection {
  id: string;
  taskId: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
}

const connections = new Map<string, SSEConnection>();

// Helper function to broadcast messages to connections for a specific task
function broadcastToTask(taskId: string, message: ChatMessage) {
  const taskConnections = Array.from(connections.values()).filter(
    (conn) => conn.taskId === taskId
  );

  taskConnections.forEach((connection) => {
    try {
      const data = `data: ${JSON.stringify({
        type: "message",
        payload: message,
      })}\n\n`;

      connection.controller.enqueue(connection.encoder.encode(data));
    } catch (error) {
      console.error("Error broadcasting to connection:", error);
      // Remove failed connection
      connections.delete(connection.id);
    }
  });
}

// Helper function to send keep-alive pings
function sendKeepAlive(connection: SSEConnection) {
  try {
    const data = `data: ${JSON.stringify({ type: "ping" })}\n\n`;
    connection.controller.enqueue(connection.encoder.encode(data));
  } catch (error) {
    console.error("Error sending keep-alive:", error);
    connections.delete(connection.id);
  }
}

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

    // Broadcast the new message to connected clients for this task
    if (taskId) {
      broadcastToTask(taskId, clientMessage);
      console.log(
        `Broadcasting message to ${connections.size} total connections`
      );
    }

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

// SSE endpoint for real-time message streaming
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId parameter is required" },
      { status: 400 }
    );
  }

  // Verify task exists
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      deleted: false,
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const connectionId = `${taskId}_${Date.now()}_${Math.random()}`;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Store the connection
      connections.set(connectionId, {
        id: connectionId,
        taskId,
        controller,
        encoder,
      });

      // Send initial connection confirmation
      const initialData = `data: ${JSON.stringify({
        type: "connected",
        connectionId,
        taskId,
      })}\n\n`;

      controller.enqueue(encoder.encode(initialData));

      // Set up keep-alive interval
      const keepAliveInterval = setInterval(() => {
        const connection = connections.get(connectionId);
        if (connection) {
          sendKeepAlive(connection);
        } else {
          clearInterval(keepAliveInterval);
        }
      }, 30000); // Send keep-alive every 30 seconds

      console.log(
        `SSE connection established: ${connectionId} for task ${taskId}`
      );
    },

    cancel() {
      // Clean up connection when client disconnects
      connections.delete(connectionId);
      console.log(`SSE connection closed: ${connectionId}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}
