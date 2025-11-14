import { db } from "@/lib/db";
import { getTaskChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { WorkflowStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

interface GraphWebhookPayload {
  node_ids: string[];
  status: string;
  workspace_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GraphWebhookPayload;
    const { node_ids, status, workspace_id } = body;

    console.log(body, "body");
    console.log(node_ids, "node_ids");
    console.log(status, "status");
    console.log(workspace_id, "workspace_id");

    if (!node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
      console.error("No node_ids provided in webhook or invalid format");
      return NextResponse.json(
        { error: "node_ids array is required" },
        { status: 400 },
      );
    }

    if (!status) {
      console.error("No status provided in webhook");
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 },
      );
    }

    // Find tasks by node IDs
    const tasks = await db.task.findMany({
      where: {
        id: {
          in: node_ids,
        },
        deleted: false,
        ...(workspace_id ? { workspaceId: workspace_id } : {}),
      },
    });

    if (tasks.length === 0) {
      console.error(`No tasks found for node IDs: ${node_ids.join(", ")}`);
      return NextResponse.json(
        { error: "No tasks found for provided node IDs" },
        { status: 404 }
      );
    }

    const workflowStatus = mapStakworkStatus(status);

    if (workflowStatus === null) {
      return NextResponse.json(
        {
          success: true,
          message: `Unknown status '${status}' - no update performed`,
          data: {
            nodeIds: node_ids,
            receivedStatus: status,
            action: "ignored",
          },
        },
        { status: 200 },
      );
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

    // Update all tasks
    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        return await db.task.update({
          where: { id: task.id },
          data: updateData,
        });
      })
    );

    // Broadcast updates for each task
    const broadcastPromises = updatedTasks.map(async (updatedTask) => {
      try {
        const channelName = getTaskChannelName(updatedTask.id);
        const eventPayload = {
          taskId: updatedTask.id,
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
        console.error(`Error broadcasting for task ${updatedTask.id}:`, error);
      }
    });

    await Promise.all(broadcastPromises);

    return NextResponse.json(
      {
        success: true,
        data: {
          updatedTasks: updatedTasks.length,
          nodeIds: node_ids,
          workflowStatus,
          tasks: updatedTasks.map(task => ({
            id: task.id,
            workflowStatus: task.workflowStatus,
            previousStatus: tasks.find(t => t.id === task.id)?.workflowStatus,
          })),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing Graph webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}