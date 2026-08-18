import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus, NotificationTriggerType } from "@prisma/client";
import { pusherServer, getTaskChannelName, getFeatureChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { notifyFeatureCanvasRefresh } from "@/lib/canvas";
import { syncPlannerWorkflowStatusToCanvas } from "@/services/canvas-planner-fanout";
import { createAndSendNotification } from "@/services/notifications";
import { retryWorkflowEditorTask } from "@/services/workflow-editor-retry";
import { releaseTaskPod } from "@/lib/pods/utils";

export const fetchCache = "force-no-store";

/** Truncates untrusted request-controlled strings before logging them. */
const truncate = (s: string, max = 200): string =>
  typeof s === "string" && s.length > max ? s.slice(0, max) + "…" : s;

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
      console.error("[stakwork/webhook] No task_id or run_id provided in webhook");
      return NextResponse.json({ error: "Either task_id or run_id is required" }, { status: 400 });
    }

    if (!project_status) {
      console.error("[stakwork/webhook] No project_status provided in webhook");
      return NextResponse.json({ error: "project_status is required" }, { status: 400 });
    }

    const workflowStatus = mapStakworkStatus(project_status);

    console.log("[stakwork/webhook]", {
      finalTaskId,
      finalRunId,
      rawProjectStatus: truncate(project_status),
      mappedStatus: workflowStatus,
    });

    if (workflowStatus === null) {
      console.warn("[stakwork/webhook]", {
        finalTaskId,
        finalRunId,
        rawProjectStatus: truncate(project_status),
      });
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
        console.error("[stakwork/webhook]", {
          message: "StakworkRun not found",
          finalTaskId,
          finalRunId,
          rawProjectStatus: truncate(project_status),
        });
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      const updatedRun = await db.stakworkRun.update({
        where: { id: finalRunId },
        data: {
          status: workflowStatus,
          updatedAt: new Date(),
        },
      });

      console.log("[stakwork/webhook]", {
        entityType: "run",
        entityId: finalRunId,
        priorStatus: run.status,
        newStatus: workflowStatus,
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
        podId: true,
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
          parentCanvasConversationId: true,
          workspace: { select: { slug: true } },
        },
      });

      if (feature) {
        const priorFeatureStatus = feature.workflowStatus;
        await db.feature.update({
          where: { id: feature.id },
          data: buildWorkflowTimestamps(workflowStatus),
        });

        console.log("[stakwork/webhook]", {
          entityType: "feature",
          featureId: feature.id,
          priorStatus: priorFeatureStatus,
          newStatus: workflowStatus,
        });

        // Patch the (frozen) `source.workflowStatus` snapshot on the
        // feature's latest planner row in its owning canvas conversation,
        // so the `SubAgentRunCard` pill reflects the just-written status
        // (the planner message usually fanned out a few seconds earlier,
        // while the feature still read IN_PROGRESS). No-ops when there's
        // no owning conversation / planner row, and self-heals on reload
        // if missed — so it never blocks the webhook.
        if (feature.parentCanvasConversationId) {
          await syncPlannerWorkflowStatusToCanvas(
            feature.parentCanvasConversationId,
            feature.id,
            workflowStatus,
          );
        }

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
          // Uniformly timestamped so client-side discriminator and
          // dedup logic works consistently: taskId === featureId →
          // planner event; timestamp allows ordering/dedup.
          await pusherServer.trigger(
            getFeatureChannelName(feature.id),
            PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
            { taskId: feature.id, workflowStatus, timestamp: new Date() },
          );
        } catch (error) {
          console.error("Error broadcasting feature status to Pusher:", error);
        }

        return NextResponse.json({
          success: true,
          data: { featureId: feature.id, workflowStatus },
        }, { status: 200 });
      }

      console.error("[stakwork/webhook]", {
        message: "Task not found",
        finalTaskId,
        finalRunId,
        rawProjectStatus: truncate(project_status),
      });
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
        console.warn("[stakwork/webhook]", {
          message: "terminal status swallowed into retryWorkflowEditorTask",
          taskId: task.id,
          originalStatus: workflowStatus,
        });
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

    console.log("[stakwork/webhook]", {
      entityType: "task",
      entityId: finalTaskId,
      featureId: updatedTask.featureId,
      priorStatus: task.workflowStatus,
      newStatus: workflowStatus,
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

    // Release pod for non-agent HALTED tasks (fire-and-forget, failure-tolerant)
    if (workflowStatus === WorkflowStatus.HALTED && task.podId && task.mode !== "agent") {
      void releaseTaskPod({
        taskId: task.id,
        podId: task.podId,
        workspaceId: task.workspaceId,
        verifyOwnership: true,
        resetRepositories: false,
        clearTaskFields: true,
        // newWorkflowStatus: null is REQUIRED — omitting it causes releaseTaskPod
        // to default to "COMPLETED", silently overwriting the HALTED status just written.
        newWorkflowStatus: null,
      }).catch((err) =>
        console.error("[stakwork/webhook] Pod release failed for HALTED task:", task.id, err)
      );
    }

    // Sync feature status if task belongs to a feature
    if (updatedTask.featureId) {
      const featureId = updatedTask.featureId;
      try {
        await updateFeatureStatusFromTasks(featureId);
      } catch (error) {
        console.error('Failed to sync feature status:', error);
        // Don't fail the request if feature sync fails
      }
      // Stakwork webhook fires on every workflow status transition,
      // including PENDING→IN_PROGRESS and IN_PROGRESS→COMPLETED. Both
      // change the milestone's agent count. Refresh the canvas.
      void notifyFeatureCanvasRefresh(featureId, "stakwork-status", {
        taskId: finalTaskId,
      });

      // Fan out child-task status to the feature's Pusher channel so
      // Feature cards on the org canvas can show a live task-agent
      // count badge without polling.
      // Discriminator for consumers: taskId !== featureId → child-task event.
      try {
        await pusherServer.trigger(
          getFeatureChannelName(featureId),
          PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
          { taskId: finalTaskId, workflowStatus, timestamp: new Date() },
        );
        console.log(
          "[stakwork/webhook] fan out task status to feature channel",
          { featureId, taskId: finalTaskId, workflowStatus },
        );
      } catch (error) {
        console.error("[stakwork/webhook] Error broadcasting task status to feature channel:", error);
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
