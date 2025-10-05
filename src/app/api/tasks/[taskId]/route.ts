import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    // Fetch task with workspace to verify authorization
    const existingTask = await db.task.findFirst({
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
                userId: userId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = existingTask.workspace.ownerId === userId;
    const isMember = existingTask.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      description,
      status,
      priority,
      assigneeId,
      repositoryId,
      estimatedHours,
      actualHours,
    } = body;

    // Validate status if provided
    let taskStatus: TaskStatus | undefined;
    if (status !== undefined) {
      // Handle frontend sending "active" status - map to IN_PROGRESS
      if (status === "active") {
        taskStatus = TaskStatus.IN_PROGRESS;
      } else if (Object.values(TaskStatus).includes(status as TaskStatus)) {
        taskStatus = status as TaskStatus;
      } else {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${Object.values(TaskStatus).join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Validate priority if provided
    let taskPriority: Priority | undefined;
    if (priority !== undefined && !Object.values(Priority).includes(priority as Priority)) {
      return NextResponse.json(
        {
          error: `Invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`,
        },
        { status: 400 }
      );
    } else if (priority !== undefined) {
      taskPriority = priority as Priority;
    }

    // Validate assignee exists if provided
    if (assigneeId !== undefined && assigneeId !== null) {
      const assignee = await db.user.findFirst({
        where: {
          id: assigneeId,
          deleted: false,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Assignee not found" },
          { status: 400 }
        );
      }
    }

    // Validate repository exists and belongs to workspace if provided
    if (repositoryId !== undefined && repositoryId !== null) {
      const repository = await db.repository.findFirst({
        where: {
          id: repositoryId,
        },
      });

      if (!repository || repository.workspaceId !== existingTask.workspaceId) {
        return NextResponse.json(
          {
            error: "Repository not found or does not belong to this workspace",
          },
          { status: 400 }
        );
      }
    }

    // Build update data object with only provided fields
    const updateData: any = {
      updatedById: userId,
    };

    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (taskStatus !== undefined) updateData.status = taskStatus;
    if (taskPriority !== undefined) updateData.priority = taskPriority;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    if (repositoryId !== undefined) updateData.repositoryId = repositoryId;
    if (estimatedHours !== undefined) updateData.estimatedHours = estimatedHours;
    if (actualHours !== undefined) updateData.actualHours = actualHours;

    // Update the task
    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        repository: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            githubAuth: {
              select: {
                githubUsername: true,
              },
            },
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedTask,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    // Fetch task with workspace to verify authorization
    const existingTask = await db.task.findFirst({
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
                userId: userId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = existingTask.workspace.ownerId === userId;
    const isMember = existingTask.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Soft delete the task
    await db.task.update({
      where: { id: taskId },
      data: {
        deleted: true,
        deletedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Task deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting task:", error);
    return NextResponse.json(
      { error: "Failed to delete task" },
      { status: 500 }
    );
  }
}