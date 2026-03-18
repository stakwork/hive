import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus, NotificationTriggerType } from "@prisma/client";
import { pusherServer, getTaskChannelName, getFeatureChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { createAndSendNotification } from "@/services/notifications";
import { retryWorkflowEditorTask } from "@/services/workflow-editor-retry";

export const fetchCache = "force-no-store";

function buildWorkflowTimestamps(status: WorkflowStatus): Record<string, unknown> {
  const data: Record<string, unknown> = {
    workflowStatus: status,
    updatedAt: new Date(),
  };
  if (status === WorkflowStatus.IN_PROGRESS) {
    data.workflowStartedAt = new Date();
  } else if (
    status === WorkflowStatus.COMPLETED ||
    status === WorkflowStatus.FAILED ||
    status === WorkflowStatus.HALTED
  ) {
    data.workflowCompletedAt = new Date();
  }
  return data;
}

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
      // Skip broadcasting COMPLETED for DIAGRAM_GENERATION — the result webhook
      // (/api/webhook/stakwork/response) broadcasts after the whiteboard is saved,
      // so broadcasting here would cause the frontend to fetch stale data.
      const skipBroadcast =
        updatedRun.type === "DIAGRAM_GENERATION" &&
        workflowStatus === WorkflowStatus.COMPLETED;

      if (!skipBroadcast) {
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
      select: {
        id: true,
        workspaceId: true,
        workflowStatus: true,
        assigneeId: true,
        createdById: true,
        title: true,
        featureId: true,
        mode: true,
        haltRetryAttempted: true,
        workspace: { select: { slug: true } },
      },
    });

    if (!task) {
      // If no task found, check if this is a feature (plan mode uses featureId as taskId)
      const feature = await db.feature.findFirst({
        where: { id: finalTaskId },
        select: {
          id: true,
          workspaceId: true,
          workflowStatus: true,
          assigneeId: true,
          createdById: true,
          title: true,
          workspace: { select: { slug: true } },
        },
      });

      if (feature) {
        await db.feature.update({
          where: { id: feature.id },
          data: buildWorkflowTimestamps(workflowStatus),
        });

        // Fire WORKFLOW_HALTED notification for feature path (fire-and-forget)
        if (workflowStatus === WorkflowStatus.HALTED) {
          void (async () => {
            try {
              const targetUserId = feature.assigneeId ?? feature.createdById;
              const planUrl = `${process.env.NEXTAUTH_URL}/w/${feature.workspace.slug}/plan/${feature.id}`;
              const targetUser = await db.user.findUnique({
                where: { id: targetUserId },
                select: { sphinxAlias: true, name: true },
              });
              const alias = targetUser?.sphinxAlias ?? targetUser?.name ?? "User";
              await createAndSendNotification({
                targetUserId,
                featureId: feature.id,
                workspaceId: feature.workspaceId,
                notificationType: NotificationTriggerType.WORKFLOW_HALTED,
                message: `@${alias} — A workflow for '${feature.title}' has halted and needs your attention: ${planUrl}`,
              });
            } catch (notifError) {
              console.error("[stakwork/webhook] Error firing WORKFLOW_HALTED (feature) notification:", notifError);
            }
          })();
        }

        try {
          await pusherServer.trigger(
            getFeatureChannelName(feature.id),
            PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
            { taskId: feature.id, workflowStatus },
          );
        } catch (error) {
          console.error("Error broadcasting feature status to Pusher:", error);
        }

        return NextResponse.json({
          success: true,
          data: { featureId: feature.id, workflowStatus },
        }, { status: 200 });
      }

      console.error(`Task not found: ${finalTaskId}`);
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Auto-retry once for workflow_editor tasks on terminal status before surfacing failure
    const isTerminal =
      workflowStatus === WorkflowStatus.HALTED ||
      workflowStatus === WorkflowStatus.FAILED ||
      workflowStatus === WorkflowStatus.ERROR;

    if (isTerminal) {
      const retried = await retryWorkflowEditorTask(task.id);
      if (retried) {
        return NextResponse.json({ success: true, action: "retried" }, { status: 200 });
      }
    }

    const updatedTask = await db.task.update({
      where: { id: finalTaskId },
      data: buildWorkflowTimestamps(workflowStatus),
      select: {
        workflowStartedAt: true,
        workflowCompletedAt: true,
        featureId: true,
      },
    });

    // Fire WORKFLOW_HALTED notification for task path (fire-and-forget)
    if (workflowStatus === WorkflowStatus.HALTED) {
      void (async () => {
        try {
          const targetUserId = task.assigneeId ?? task.createdById;
          const taskUrl = `${process.env.NEXTAUTH_URL}/w/${task.workspace.slug}/task/${task.id}`;
          const targetUser = await db.user.findUnique({
            where: { id: targetUserId },
            select: { sphinxAlias: true, name: true },
          });
          const alias = targetUser?.sphinxAlias ?? targetUser?.name ?? "User";
          await createAndSendNotification({
            targetUserId,
            taskId: task.id,
            workspaceId: task.workspaceId,
            notificationType: NotificationTriggerType.WORKFLOW_HALTED,
            message: `@${alias} — A workflow for task '${task.title}' has halted and needs your attention: ${taskUrl}`,
          });
        } catch (notifError) {
          console.error("[stakwork/webhook] Error firing WORKFLOW_HALTED (task) notification:", notifError);
        }
      })();
    }

    // Sync feature status if task belongs to a feature
    if (updatedTask.featureId) {
      try {
        await updateFeatureStatusFromTasks(updatedTask.featureId);
      } catch (error) {
        console.error('Failed to sync feature status:', error);
        // Don't fail the request if feature sync fails
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
