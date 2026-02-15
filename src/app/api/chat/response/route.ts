import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma, PodUsageStatus } from "@prisma/client";
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

    let taskMode: string | undefined;
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
      // Access mode field (may not be in generated types if prisma generate hasn't been run)
      taskMode = (task as unknown as { mode?: string }).mode;
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

    // Check for WORKFLOW artifacts with workflowVersionId - fetch updated spec and compare with original
    // This only applies to workflow_editor mode tasks
    for (const dbArtifact of chatMessage.artifacts) {
      if (dbArtifact.type === ArtifactType.WORKFLOW) {
        const content = dbArtifact.content as WorkflowContent | null;
        console.log("[chat/response] Processing WORKFLOW artifact:", {
          workflowId: content?.workflowId,
          workflowVersionId: content?.workflowVersionId,
          taskMode,
        });
        // If we have workflowVersionId and workflowId, fetch the updated workflow spec
        if (content?.workflowVersionId && content?.workflowId) {
          try {
            // First, check if we need to preserve originalWorkflowJson from a previous artifact
            // This only applies to workflow_editor mode
            // Ignore incoming originalWorkflowJson if it's too short (likely invalid)
            let originalWorkflowJson = content.originalWorkflowJson;
            if (originalWorkflowJson && originalWorkflowJson.length < 100) {
              originalWorkflowJson = undefined;
            }

            if (!originalWorkflowJson && taskId && taskMode === "workflow_editor") {
              // Look for WORKFLOW artifacts in this task's history
              const previousWorkflowArtifacts = await db.artifact.findMany({
                where: {
                  type: ArtifactType.WORKFLOW,
                  message: {
                    taskId: taskId,
                  },
                  id: {
                    not: dbArtifact.id,
                  },
                },
                orderBy: {
                  createdAt: "asc",
                },
                select: {
                  content: true,
                },
              });

              // Filter to only artifacts for the SAME workflow
              const sameWorkflowArtifacts = previousWorkflowArtifacts.filter((art) => {
                const c = art.content as WorkflowContent | null;
                return c?.workflowId === content.workflowId;
              });

              // Find the first artifact with a VALID originalWorkflowJson (must be > 100 chars)
              for (const prevArtifact of sameWorkflowArtifacts) {
                const prevContent = prevArtifact.content as WorkflowContent | null;
                if (prevContent?.originalWorkflowJson && prevContent.originalWorkflowJson.length > 100) {
                  originalWorkflowJson = prevContent.originalWorkflowJson;
                  break;
                }
              }

              // If still no originalWorkflowJson, use the workflowJson from the first artifact
              if (!originalWorkflowJson) {
                for (const prevArtifact of sameWorkflowArtifacts) {
                  const prevContent = prevArtifact.content as WorkflowContent | null;
                  if (prevContent?.workflowJson && prevContent.workflowJson.length > 100) {
                    originalWorkflowJson = prevContent.workflowJson;
                    break;
                  }
                }
              }
            }

            // Fetch the workflow version from the graph API using workflowVersionId
            const graphApiUrl = process.env.STAKWORK_JARVIS_URL;
            const graphApiKey = process.env.STAKWORK_GRAPH_API_KEY;

            if (!graphApiKey) {
              console.error("STAKWORK_GRAPH_API_KEY not configured");
              continue;
            }

            const workflowResponse = await fetch(`${graphApiUrl}/api/graph/search/attributes`, {
              method: "POST",
              headers: {
                "x-api-token": graphApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                top_node_count: 10,
                node_type: ["Workflow_version"],
                include_properties: true,
                limit: 1,
                skip: 0,
                skip_cache: true,
                search_filters: [
                  {
                    attribute: "workflow_version_id",
                    value: content.workflowVersionId,
                    comparator: "=",
                  },
                ],
              }),
            });

            if (workflowResponse.ok) {
              const workflowResult = await workflowResponse.json();
              console.log(
                "[chat/response] Graph API response for workflowVersionId",
                content.workflowVersionId,
                ":",
                JSON.stringify(workflowResult).substring(0, 500),
              );
              const workflowVersionNode = workflowResult.nodes?.[0] || workflowResult.data?.[0];
              const updatedWorkflowJson =
                workflowVersionNode?.properties?.workflow_json || workflowVersionNode?.workflow_json;

              console.log(
                "[chat/response] Found workflowVersionNode:",
                !!workflowVersionNode,
                "updatedWorkflowJson:",
                !!updatedWorkflowJson,
              );

              if (updatedWorkflowJson) {
                const formattedUpdatedJson =
                  typeof updatedWorkflowJson === "string" ? updatedWorkflowJson : JSON.stringify(updatedWorkflowJson);

                // Update the artifact: set workflowJson to updated, preserve originalWorkflowJson if in workflow_editor mode
                const updatedContent: WorkflowContent = {
                  ...content,
                  workflowJson: formattedUpdatedJson,
                  ...(taskMode === "workflow_editor" && originalWorkflowJson ? { originalWorkflowJson } : {}),
                };

                await db.artifact.update({
                  where: { id: dbArtifact.id },
                  data: {
                    content: updatedContent as unknown as Prisma.InputJsonValue,
                  },
                });

                // Update the local artifact for the response
                Object.assign(dbArtifact.content as WorkflowContent, updatedContent);
              }
            } else {
              const errorText = await workflowResponse.text();
              console.error(
                "[chat/response] Failed to fetch workflow from graph API:",
                workflowResponse.status,
                errorText,
              );
            }
          } catch (fetchError) {
            console.error("Error fetching workflow spec:", fetchError);
          }
        }
      }
    }

    const clientMessage: ChatMessage = {
      ...chatMessage,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
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
            console.log(
              `✅ Stored podId=${podId}, agentPassword=${agentPassword ? "[encrypted]" : "undefined"} from artifact for task ${taskId}`,
            );

            // Sync pods table so pool status stays accurate
            // Stakwork claims pods via Pool Manager directly, so we need to mark the pod as USED here
            if (podId) {
              try {
                await db.pod.updateMany({
                  where: { podId, deletedAt: null },
                  data: {
                    usageStatus: PodUsageStatus.USED,
                    usageStatusMarkedAt: new Date(),
                    usageStatusMarkedBy: taskId,
                  },
                });
                console.log(`✅ Synced pods table: marked ${podId} as USED for task ${taskId}`);
              } catch (podSyncError) {
                console.error("Failed to sync pods table:", podSyncError);
              }
            }

            // Broadcast podId update to both channels for real-time UI updates
            const podUpdatePayload = {
              taskId,
              podId,
              timestamp: new Date(),
            };

            // Send to task channel (for task detail page)
            try {
              const taskChannelName = getTaskChannelName(taskId);
              await pusherServer.trigger(taskChannelName, PUSHER_EVENTS.TASK_TITLE_UPDATE, podUpdatePayload);
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
        await pusherServer.trigger(channelName, PUSHER_EVENTS.NEW_MESSAGE, chatMessage.id);
      } catch (error) {
        console.error("Error broadcasting to Pusher:", error);
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
    return NextResponse.json({ error: "Failed to create chat response" }, { status: 500 });
  }
}
