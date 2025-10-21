import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { startTaskWorkflow } from "@/services/task-workflow";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { taskId } = await params;
    const body = await request.json();
    const { startWorkflow, mode } = body;

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
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
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
        { status: 200 }
      );
    }

    // If no workflow start requested, just return task
    return NextResponse.json(
      {
        success: true,
        task,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}
