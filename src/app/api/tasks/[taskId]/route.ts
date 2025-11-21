import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { startTaskWorkflow } from "@/services/task-workflow";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import { sanitizeTask } from "@/lib/helpers/tasks";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { taskId } = await params;
    const body = await request.json();
    const { startWorkflow, mode, status, workflowStatus, archived, runBuild, runTestSuite } = body;

    // Verify task exists and user has access
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      include: {
        workspace: {
          select: {
            id: true,
            slug: true,
            ownerId: true,
            members: {
              where: {
                userId: userOrResponse.id,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userOrResponse.id;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Start workflow if requested
    if (startWorkflow) {
      const workflowResult = await startTaskWorkflow({
        taskId,
        userId: userOrResponse.id,
        mode: mode || "live",
      });

      // Fetch updated task with workflow status
      const updatedTask = await db.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
          stakworkProjectId: true,
          updatedAt: true,
        },
      });

      return NextResponse.json(
        {
          success: true,
          task: updatedTask,
          workflow: workflowResult.stakworkData,
        },
        { status: 200 },
      );
    }

    // Handle status, workflowStatus, and archived updates
    if (status || workflowStatus || archived !== undefined) {
      // Validate status if provided
      if (status && !Object.values(TaskStatus).includes(status as TaskStatus)) {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${Object.values(TaskStatus).join(", ")}`,
          },
          { status: 400 },
        );
      }

      // Validate workflowStatus if provided
      if (workflowStatus && !Object.values(WorkflowStatus).includes(workflowStatus as WorkflowStatus)) {
        return NextResponse.json(
          {
            error: `Invalid workflowStatus. Must be one of: ${Object.values(WorkflowStatus).join(", ")}`,
          },
          { status: 400 },
        );
      }

      // Validate archived if provided
      if (archived !== undefined && typeof archived !== "boolean") {
        return NextResponse.json(
          {
            error: "Invalid archived value. Must be a boolean.",
          },
          { status: 400 },
        );
      }

      // Update task
      const updatedTask = await db.task.update({
        where: { id: taskId },
        data: {
          ...(status && { status: status as TaskStatus }),
          ...(workflowStatus && { workflowStatus: workflowStatus as WorkflowStatus }),
          ...(archived !== undefined && {
            archived,
            archivedAt: archived ? new Date() : null,
          }),
          ...(runBuild !== undefined && { runBuild }),
          ...(runTestSuite !== undefined && { runTestSuite }),
          updatedById: userOrResponse.id,
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
          stakworkProjectId: true,
          archived: true,
          archivedAt: true,
          updatedAt: true,
        },
      });

      // Broadcast status update to real-time subscribers
      try {
        const statusUpdatePayload = {
          taskId: updatedTask.id,
          status: updatedTask.status,
          workflowStatus: updatedTask.workflowStatus,
          archived: updatedTask.archived,
          archivedAt: updatedTask.archivedAt,
          timestamp: new Date(),
        };

        // Broadcast to workspace channel (for task lists like UserJourneys)
        if (task.workspace?.slug) {
          const workspaceChannelName = getWorkspaceChannelName(task.workspace.slug);
          await pusherServer.trigger(
            workspaceChannelName,
            PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, // Reuse existing event for task updates
            statusUpdatePayload,
          );
        }

        console.log(`Task status updated and broadcasted: ${taskId}`);
      } catch (error) {
        console.error("Error broadcasting status update to Pusher:", error);
        // Don't fail the request if Pusher fails
      }

      return NextResponse.json(
        {
          success: true,
          task: updatedTask,
        },
        { status: 200 },
      );
    }

    // If no workflow start requested, just return task
    return NextResponse.json(
      {
        success: true,
        task: sanitizeTask(task),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
