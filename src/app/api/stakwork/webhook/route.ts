import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus, ArtifactType, ChatRole, ChatStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { config } from "@/config/env";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StakworkStatusPayload;
    const { project_status, task_id } = body;

    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const runIdFromQuery = url.searchParams.get("run_id");
    const finalTaskId = task_id || taskIdFromQuery;
    const finalRunId = runIdFromQuery;

    // Must provide either task_id or run_id
    if (!finalTaskId && !finalRunId) {
      console.error("No task_id or run_id provided in webhook");
      return NextResponse.json({ error: "Either task_id or run_id is required" }, { status: 400 });
    }

    if (!project_status) {
      console.error("No project_status provided in webhook");
      return NextResponse.json({ error: "project_status is required" }, { status: 400 });
    }

    const workflowStatus = mapStakworkStatus(project_status);

    if (workflowStatus === null) {
      return NextResponse.json(
        {
          success: true,
          message: `Unknown status '${project_status}' - no update performed`,
          data: {
            taskId: finalTaskId,
            runId: finalRunId,
            receivedStatus: project_status,
            action: "ignored",
          },
        },
        { status: 200 },
      );
    }

    // Handle StakworkRun updates
    if (finalRunId) {
      const run = await db.stakworkRun.findFirst({
        where: {
          id: finalRunId,
        },
        include: {
          workspace: {
            select: {
              slug: true,
            },
          },
        },
      });

      if (!run) {
        console.error(`StakworkRun not found: ${finalRunId}`);
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      const updatedRun = await db.stakworkRun.update({
        where: { id: finalRunId },
        data: {
          status: workflowStatus,
          updatedAt: new Date(),
        },
      });

      // Broadcast via Pusher
      try {
        const channelName = getWorkspaceChannelName(run.workspace.slug);
        await pusherServer.trigger(channelName, PUSHER_EVENTS.STAKWORK_RUN_UPDATE, {
          runId: finalRunId,
          type: updatedRun.type,
          status: workflowStatus,
          featureId: updatedRun.featureId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("Error broadcasting to Pusher:", error);
      }

      return NextResponse.json(
        {
          success: true,
          data: {
            runId: finalRunId,
            workflowStatus,
            previousStatus: run.status,
          },
        },
        { status: 200 },
      );
    }

    // Handle Task updates (existing logic)
    if (!finalTaskId) {
      return NextResponse.json({ error: "task_id is required for task updates" }, { status: 400 });
    }

    const task = await db.task.findFirst({
      where: {
        id: finalTaskId,
        deleted: false,
      },
      include: {
        chatMessages: {
          include: {
            artifacts: true,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 1, // Get the first message which contains workflow info
        },
      },
    });

    if (!task) {
      console.error(`Task not found: ${finalTaskId}`);
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      workflowStatus,
      updatedAt: new Date(),
    };

    if (workflowStatus === WorkflowStatus.IN_PROGRESS) {
      updateData.workflowStartedAt = new Date();
    } else if (
      workflowStatus === WorkflowStatus.COMPLETED ||
      workflowStatus === WorkflowStatus.FAILED ||
      workflowStatus === WorkflowStatus.HALTED
    ) {
      updateData.workflowCompletedAt = new Date();
    }

    const updatedTask = await db.task.update({
      where: { id: finalTaskId },
      data: updateData,
    });

    // Create PUBLISH_WORKFLOW artifact and update WORKFLOW artifact for workflow_editor tasks when completed
    if (task.mode === "workflow_editor" && workflowStatus === WorkflowStatus.COMPLETED) {
      try {
        // Find workflow info from the first message's WORKFLOW artifact
        const workflowArtifact = task.chatMessages[0]?.artifacts?.find((a) => a.type === ArtifactType.WORKFLOW);

        const workflowContent = workflowArtifact?.content as {
          workflowId?: number;
          workflowName?: string;
          workflowRefId?: string;
          workflowJson?: string;
          projectId?: string;
        } | null;

        if (workflowContent?.workflowId) {
          // Fetch the latest workflow JSON from Stakwork
          let updatedWorkflowJson: string | null = null;
          try {
            const workflowUrl = `${config.STAKWORK_BASE_URL}/workflows/${workflowContent.workflowId}`;
            const workflowResponse = await fetch(workflowUrl, {
              method: "GET",
              headers: {
                Authorization: `Token token=${config.STAKWORK_API_KEY}`,
                "Content-Type": "application/json",
              },
            });

            if (workflowResponse.ok) {
              const workflowData = await workflowResponse.json();
              // The spec contains the workflow transitions and connections
              if (workflowData?.spec) {
                updatedWorkflowJson = JSON.stringify(workflowData.spec);
              }
            } else {
              console.error(`Failed to fetch workflow ${workflowContent.workflowId}:`, await workflowResponse.text());
            }
          } catch (fetchError) {
            console.error("Error fetching updated workflow:", fetchError);
          }

          // Create artifacts array for the message
          const artifactsToCreate: Array<{
            type: ArtifactType;
            content: Record<string, unknown>;
          }> = [
            {
              type: ArtifactType.PUBLISH_WORKFLOW,
              content: {
                workflowId: workflowContent.workflowId,
                workflowName: workflowContent.workflowName || `Workflow ${workflowContent.workflowId}`,
                workflowRefId: workflowContent.workflowRefId,
              },
            },
          ];

          // Add updated WORKFLOW artifact if we fetched the latest data
          if (updatedWorkflowJson) {
            artifactsToCreate.push({
              type: ArtifactType.WORKFLOW,
              content: {
                workflowId: workflowContent.workflowId,
                workflowName: workflowContent.workflowName,
                workflowRefId: workflowContent.workflowRefId,
                workflowJson: updatedWorkflowJson,
                projectId: workflowContent.projectId,
              },
            });
          }

          // Create a new chat message with PUBLISH_WORKFLOW and optionally WORKFLOW artifacts
          const publishMessage = await db.chatMessage.create({
            data: {
              taskId: finalTaskId,
              message: "Workflow edit completed. Ready to publish.",
              role: ChatRole.ASSISTANT,
              status: ChatStatus.SENT,
              contextTags: "[]",
              artifacts: {
                create: artifactsToCreate,
              },
            },
            include: {
              artifacts: true,
            },
          });

          // Broadcast the new message via Pusher
          const channelName = getTaskChannelName(finalTaskId);
          await pusherServer.trigger(channelName, PUSHER_EVENTS.CHAT_MESSAGE, {
            id: publishMessage.id,
            taskId: finalTaskId,
            message: publishMessage.message,
            role: publishMessage.role,
            status: publishMessage.status,
            timestamp: publishMessage.createdAt,
            artifacts: publishMessage.artifacts,
          });
        }
      } catch (error) {
        console.error("Error creating PUBLISH_WORKFLOW artifact:", error);
        // Don't fail the webhook if artifact creation fails
      }
    }

    try {
      const channelName = getTaskChannelName(finalTaskId);
      const eventPayload = {
        taskId: finalTaskId,
        workflowStatus,
        workflowStartedAt: updatedTask.workflowStartedAt,
        workflowCompletedAt: updatedTask.workflowCompletedAt,
        timestamp: new Date(),
      };

      await pusherServer.trigger(channelName, PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, eventPayload);
    } catch (error) {
      console.error("Error broadcasting to Pusher:", error);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          taskId: finalTaskId,
          workflowStatus,
          previousStatus: task.workflowStatus,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing Stakwork webhook:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
