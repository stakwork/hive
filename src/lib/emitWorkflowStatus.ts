import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "./pusher";
import { WorkflowStatus } from "@prisma/client";

export type EmitWorkflowStatusArgs = {
  taskId: string;
  workflowStatus: WorkflowStatus;
  workflowStartedAt?: Date | null;
  workflowCompletedAt?: Date | null;
};

export async function emitWorkflowStatus({
  taskId,
  workflowStatus,
  workflowStartedAt,
  workflowCompletedAt,
}: EmitWorkflowStatusArgs) {
  try {
    const channelName = getTaskChannelName(taskId);
    await pusherServer.trigger(
      channelName,
      PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      {
        taskId,
        workflowStatus,
        workflowStartedAt: workflowStartedAt ?? null,
        workflowCompletedAt: workflowCompletedAt ?? null,
        timestamp: new Date(),
      },
    );
  } catch (err) {
    console.error("emitWorkflowStatus error", err);
  }
}
