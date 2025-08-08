import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

interface StakworkStatusPayload {
  project_output?: Record<string, unknown>;
  workflow_id: number;
  workflow_version_id: number;
  workflow_version: number;
  project_status: string;
  task_id?: string; // We'll need to include this in the webhook URL
}

// Map Stakwork status values to our WorkflowStatus enum
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
      console.warn(`Unknown Stakwork status: ${status}, keeping existing status`);
      return null; // Keep existing status for unknown values
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as StakworkStatusPayload;
    const { project_status, workflow_id, task_id } = body;

    console.log("Received Stakwork webhook:", {
      project_status,
      workflow_id,
      task_id,
    });

    // Extract task_id from URL query params if not in body
    const url = new URL(request.url);
    const taskIdFromQuery = url.searchParams.get("task_id");
    const finalTaskId = task_id || taskIdFromQuery;

    if (!finalTaskId) {
      console.error("No task_id provided in webhook");
      return NextResponse.json(
        { error: "task_id is required" },
        { status: 400 }
      );
    }

    if (!project_status) {
      console.error("No project_status provided in webhook");
      return NextResponse.json(
        { error: "project_status is required" },
        { status: 400 }
      );
    }

    // Validate task exists
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

    // Map Stakwork status to our WorkflowStatus
    const workflowStatus = mapStakworkStatus(project_status);
    
    // Only update if we have a valid status mapping
    if (workflowStatus === null) {
      console.log(`Unknown status '${project_status}' - keeping existing workflow status for task ${finalTaskId}`);
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
        { status: 200 }
      );
    }
    
    // Prepare update data
    const updateData: any = {
      workflowStatus,
      updatedAt: new Date(),
    };

    // Set timestamps based on status
    if (workflowStatus === WorkflowStatus.IN_PROGRESS) {
      updateData.workflowStartedAt = new Date();
    } else if (
      workflowStatus === WorkflowStatus.COMPLETED ||
      workflowStatus === WorkflowStatus.FAILED ||
      workflowStatus === WorkflowStatus.HALTED
    ) {
      updateData.workflowCompletedAt = new Date();
    }

    // Update task workflow status
    const updatedTask = await db.task.update({
      where: { id: finalTaskId },
      data: updateData,
    });

    console.log("Updated task workflow status:", {
      taskId: finalTaskId,
      oldStatus: task.workflowStatus,
      newStatus: workflowStatus,
    });

    // Broadcast workflow status update via Pusher
    try {
      const channelName = getTaskChannelName(finalTaskId);
      const eventPayload = {
        taskId: finalTaskId,
        workflowStatus,
        workflowStartedAt: updatedTask.workflowStartedAt,
        workflowCompletedAt: updatedTask.workflowCompletedAt,
        timestamp: new Date(),
      };

      console.log(`Broadcasting workflow status to Pusher channel: ${channelName}`);
      
      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        eventPayload
      );

      console.log("Successfully broadcast workflow status update to Pusher");
    } catch (error) {
      console.error("Error broadcasting to Pusher:", error);
      // Don't fail the request if Pusher fails
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
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing Stakwork webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}