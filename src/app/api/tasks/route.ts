import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
      },
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
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get tasks for the workspace
    const tasks = await db.task.findMany({
      where: {
        workspaceId,
        deleted: false,
      },
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
          },
        },
        _count: {
          select: {
            chatMessages: true,
            comments: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: tasks,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      workspaceSlug,
      status,
      priority,
      assigneeId,
      repositoryId,
      estimatedHours,
      actualHours,
    } = body;

    // Validate required fields
    if (!title || !workspaceSlug) {
      return NextResponse.json(
        { error: "Missing required fields: title, workspaceId" },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
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
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    const workspaceId = workspace.id;
    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate and convert status if provided
    let taskStatus: TaskStatus = TaskStatus.TODO; // default
    if (status) {
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
          { status: 400 },
        );
      }
    }

    // Validate priority if provided
    let taskPriority: Priority = Priority.MEDIUM; // default
    if (priority && Object.values(Priority).includes(priority as Priority)) {
      taskPriority = priority as Priority;
    } else if (priority) {
      return NextResponse.json(
        {
          error: `Invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate assignee exists if provided
    if (assigneeId) {
      const assignee = await db.user.findFirst({
        where: {
          id: assigneeId,
          deleted: false,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Assignee not found" },
          { status: 400 },
        );
      }
    }

    // Validate repository exists and belongs to workspace if provided
    if (repositoryId) {
      const repository = await db.repository.findFirst({
        where: {
          id: repositoryId,
          workspaceId: workspaceId,
        },
      });

      if (!repository) {
        return NextResponse.json(
          {
            error: "Repository not found or does not belong to this workspace",
          },
          { status: 400 },
        );
      }
    }

    // Create the task
    const task = await db.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        workspaceId,
        status: taskStatus,
        priority: taskPriority,
        assigneeId: assigneeId || null,
        repositoryId: repositoryId || null,
        estimatedHours: estimatedHours || null,
        actualHours: actualHours || null,
        createdById: userId,
        updatedById: userId,
      },
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
        data: task,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 },
    );
  }
}
