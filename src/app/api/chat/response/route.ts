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
  type WorkflowContent,
} from "@/lib/chat";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";

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

    // Check for WORKFLOW artifacts with workflowVersionId but no workflowJson
    // If found, fetch the updated workflow spec from Stakwork
    for (const dbArtifact of chatMessage.artifacts) {
      if (dbArtifact.type === ArtifactType.WORKFLOW) {
        const content = dbArtifact.content as WorkflowContent | null;
        if (content?.workflowVersionId && content?.workflowId && !content?.workflowJson) {
          try {
            // Fetch the updated workflow definition from Stakwork
            const workflowUrl = `${config.STAKWORK_BASE_URL}/workflows/${content.workflowId}/`;
            console.log("Fetching updated workflow from:", workflowUrl);

            const workflowResponse = await fetch(workflowUrl, {
              method: "GET",
              headers: {
                Authorization: `Token token=${config.STAKWORK_API_KEY}`,
                "Content-Type": "application/json",
              },
            });

            if (workflowResponse.ok) {
              const workflowResult = await workflowResponse.json();
              const updatedWorkflowJson =
                workflowResult.data?.workflow?.workflow_json ||
                workflowResult.data?.spec ||
                workflowResult.data?.workflow_json ||
                workflowResult.workflow_json;

              if (updatedWorkflowJson) {
                // Update the artifact with the fetched workflowJson
                await db.artifact.update({
                  where: { id: dbArtifact.id },
                  data: {
                    content: {
                      ...content,
                      workflowJson: updatedWorkflowJson,
                    },
                  },
                });
                console.log(`✅ Updated WORKFLOW artifact ${dbArtifact.id} with fetched workflowJson`);

                // Update the local artifact for the response
                (dbArtifact.content as WorkflowContent).workflowJson = updatedWorkflowJson as string;
              }
            } else {
              console.error("Failed to fetch workflow from Stakwork:", await workflowResponse.text());
            }
          } catch (fetchError) {
            console.error("Error fetching workflow spec:", fetchError);
          }
        }
      }
    }

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

    // Extract podId and agentPassword from IDE or Browser artifacts and store on task
    if (taskId) {
      const podArtifact = artifacts.find(
        (a: ArtifactRequest) =>
          (a.type === ArtifactType.IDE || a.type === ArtifactType.BROWSER) &&
          ((a.content as IDEContent | BrowserContent | undefined)?.podId ||
            (a.content as IDEContent | BrowserContent | undefined)?.agentPassword),
      );
      if (podArtifact) {
        const content = podArtifact.content as IDEContent | BrowserContent;
        const podId = content?.podId;
        const agentPassword = content?.agentPassword;

        if (podId || agentPassword) {
          try {
            const updateData: { podId?: string; agentPassword?: string } = {};

            if (podId) {
              updateData.podId = podId;
            }

            if (agentPassword) {
              const encryptionService = EncryptionService.getInstance();
              const encrypted = encryptionService.encryptField("agentPassword", agentPassword);
              updateData.agentPassword = JSON.stringify(encrypted);
            }

            const updatedTask = await db.task.update({
              where: { id: taskId },
              data: updateData,
              include: {
                workspace: {
                  select: { slug: true },
                },
              },
            });
            console.log(`✅ Stored podId=${podId}, agentPassword=${agentPassword ? "[encrypted]" : "undefined"} from artifact for task ${taskId}`);

            // Broadcast podId update to both channels for real-time UI updates
            const podUpdatePayload = {
              taskId,
              podId,
              timestamp: new Date(),
            };

            // Send to task channel (for task detail page)
            try {
              const taskChannelName = getTaskChannelName(taskId);
              await pusherServer.trigger(
                taskChannelName,
                PUSHER_EVENTS.TASK_TITLE_UPDATE,
                podUpdatePayload,
              );
            } catch (pusherError) {
              console.error("Failed to broadcast podId update to task channel:", pusherError);
            }

            // Send to workspace channel (for task list)
            if (updatedTask.workspace?.slug) {
              try {
                const workspaceChannelName = getWorkspaceChannelName(updatedTask.workspace.slug);
                await pusherServer.trigger(
                  workspaceChannelName,
                  PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
                  podUpdatePayload,
                );
              } catch (pusherError) {
                console.error("Failed to broadcast podId update to workspace channel:", pusherError);
              }
            }
          } catch (error) {
            console.error("Failed to store podId/agentPassword from artifact:", error);
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
