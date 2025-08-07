import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export const fetchCache = "force-no-store";

interface StakworkStatusPayload {
  project_output?: Record<string, unknown>;
  workflow_id: number;
  workflow_version_id: number;
  workflow_version: number;
  project_status: string;
  task_id?: string;
}

const mapStakworkStatus = (status: string): WorkflowStatus | null => {
  switch (status.toLowerCase()) {
    case "in_progress":
    case "running":
    case "processing":
      return WorkflowStatus.IN_PROGRESS;
    case "completed":
    case "success":
    case "finished":
      return WorkflowStatus.COMPLETED;
    case "error":
    case "failed":
      return WorkflowStatus.FAILED;
    case "halted":
    case "paused":
    case "stopped":
      return WorkflowStatus.HALTED;
    default:
      console.warn(
        `Unknown Stakwork status: ${status}, keeping existing status`,
      );
      return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StakworkStatusPayload;
    const { project_status, task_id } = body;

    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const finalTaskId = task_id || taskIdFromQuery;

    if (!finalTaskId) {
      console.error("No task_id provided in webhook");
      return NextResponse.json(
        { error: "task_id is required" },
        { status: 400 },
      );
    }

    if (!project_status) {
      console.error("No project_status provided in webhook");
      return NextResponse.json(
        { error: "project_status is required" },
        { status: 400 },
      );
    }

    const task = await db.task.findFirst({
      where: {
        id: finalTaskId,
        deleted: false,
      },
    });

    if (!task) {
      console.error(`Task not found: ${finalTaskId}`);
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const workflowStatus = mapStakworkStatus(project_status);

    if (workflowStatus === null) {
      return NextResponse.json(
        {
          success: true,
          message: `Unknown status '${project_status}' - no update performed`,
          data: {
            taskId: finalTaskId,
            receivedStatus: project_status,
            action: "ignored",
          },
        },
        { status: 200 },
      );
    }

    const updateData: any = {
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

    try {
      const channelName = getTaskChannelName(finalTaskId);
      const eventPayload = {
        taskId: finalTaskId,
        workflowStatus,
        workflowStartedAt: updatedTask.workflowStartedAt,
        workflowCompletedAt: updatedTask.workflowCompletedAt,
        timestamp: new Date(),
      };

      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        eventPayload,
      );
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
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
