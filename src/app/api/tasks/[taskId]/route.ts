import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { requireAuthWithApiToken } from "@/lib/middleware/auth-helpers";
import { db } from "@/lib/db";
import { startTaskWorkflow } from "@/services/task-workflow";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await request.json();
    const { startWorkflow, mode } = body;

    const context = getMiddlewareContext(request);
    const authResult = await requireAuthWithApiToken(request, context, {
      taskId,
    });
    if (authResult instanceof NextResponse) return authResult;

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
                userId: authResult.userId,
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
    const isOwner = task.workspace.ownerId === authResult.userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Start workflow if requested
    if (startWorkflow) {
      const workflowResult = await startTaskWorkflow({
        taskId,
        userId: authResult.userId,
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
