import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";

interface UpdateWorkflowStatusOptions {
  taskId: string;
  workflowStatus: WorkflowStatus;
  workflowStartedAt?: Date;
  workflowCompletedAt?: Date;
  additionalData?: Record<string, unknown>;
  skipPusher?: boolean;
}

interface UpdateWorkflowStatusResult {
  workflowStartedAt: Date | null;
  workflowCompletedAt: Date | null;
  featureId: string | null;
}

/**
 * Updates a task's workflow status and broadcasts to Pusher for real-time UI updates.
 * Centralizes workflowStatus updates to ensure consistent Pusher notifications.
 */
export async function updateTaskWorkflowStatus(
  options: UpdateWorkflowStatusOptions
): Promise<UpdateWorkflowStatusResult> {
  const {
    taskId,
    workflowStatus,
    workflowStartedAt,
    workflowCompletedAt,
    additionalData,
    skipPusher,
  } = options;

  const updatedTask = await db.task.update({
    where: { id: taskId },
    data: {
      workflowStatus,
      ...(workflowStartedAt && { workflowStartedAt }),
      ...(workflowCompletedAt && { workflowCompletedAt }),
      ...additionalData,
    },
    select: {
      workflowStartedAt: true,
      workflowCompletedAt: true,
      featureId: true,
    },
  });

  // Sync feature status if task belongs to a feature
  if (updatedTask.featureId) {
    try {
      await updateFeatureStatusFromTasks(updatedTask.featureId);
    } catch (error) {
      console.error("Failed to sync feature status:", error);
    }
  }

  // Broadcast to task channel for real-time UI updates
  if (!skipPusher) {
    try {
      await pusherServer.trigger(
        getTaskChannelName(taskId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        {
          taskId,
          workflowStatus,
          workflowStartedAt: updatedTask.workflowStartedAt,
          workflowCompletedAt: updatedTask.workflowCompletedAt,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      console.error("Error broadcasting workflow status to Pusher:", error);
    }
  }

  return updatedTask;
}
