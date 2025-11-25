import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mapStakworkStatus } from "@/utils/conversions";
import { StakworkStatusPayload } from "@/types";

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
      return NextResponse.json(
        { error: "Either task_id or run_id is required" },
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
      return NextResponse.json(
        { error: "task_id is required for task updates" },
        { status: 400 }
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
    
    // Handle malformed JSON (client error)
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }
    
    // Handle other server errors
    const errorMessage = error instanceof Error ? error.message : "Failed to process webhook";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }
}
