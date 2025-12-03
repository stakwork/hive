import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  type ContextTag,
  type Artifact,
  type ChatMessage,
  type IDEContent,
  type BrowserContent,
} from "@/lib/chat";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export const fetchCache = "force-no-store";

interface ArtifactRequest {
  type: ArtifactType;
  content?: Record<string, unknown>;
  icon?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Check API token authentication
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      taskId,
      message,
      workflowUrl,
      contextTags = [] as ContextTag[],
      sourceWebsocketID,
      artifacts = [] as ArtifactRequest[],
    } = body;

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

    // Extract podId from IDE or Browser artifacts and store on task
    if (taskId) {
      const podIdArtifact = artifacts.find(
        (a: ArtifactRequest) =>
          (a.type === ArtifactType.IDE || a.type === ArtifactType.BROWSER) &&
          (a.content as IDEContent | BrowserContent | undefined)?.podId,
      );
      if (podIdArtifact) {
        const podId = (podIdArtifact.content as IDEContent | BrowserContent)?.podId;
        if (podId) {
          try {
            await db.task.update({
              where: { id: taskId },
              data: { podId },
            });
            console.log(`✅ Stored podId ${podId} from artifact for task ${taskId}`);
          } catch (error) {
            console.error("Failed to store podId from artifact:", error);
          }
        }
      }
    }

    if (taskId) {
      try {
        const channelName = getTaskChannelName(taskId);

        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.NEW_MESSAGE,
          chatMessage.id,
        );
      } catch (error) {
        console.error("❌ Error broadcasting to Pusher:", error);
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
