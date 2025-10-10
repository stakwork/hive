import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";
import { Artifact } from "@/lib/chat";

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get("x-middleware-user-id")!;
    const workspaceId = request.headers.get("x-middleware-workspace-id")!;
    if (!userId || !workspaceId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "5");
    const includeLatestMessage = searchParams.get("includeLatestMessage") === "true";
    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: "Invalid pagination parameters. Page must be >= 1, limit must be 1-100",
        },
        { status: 400 },
      );
    }
    // ...existing code...

    // Get tasks for the workspace with pagination
    const skip = (page - 1) * limit;

    const [tasks, totalCount] = await Promise.all([
      db.task.findMany({
        where: {
          workspaceId,
          deleted: false,
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
          sourceType: true,
          stakworkProjectId: true,
          createdAt: true,
          updatedAt: true,
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
          _count: {
            select: {
              chatMessages: true,
            },
          },
          ...(includeLatestMessage && {
            chatMessages: {
              orderBy: {
                timestamp: "desc",
              },
              take: 1,
              select: {
                id: true,
                timestamp: true,
                artifacts: {
                  select: {
                    id: true,
                    type: true,
                  },
                },
              },
            },
          }),
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      db.task.count({
        where: {
          workspaceId,
          deleted: false,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    // Process tasks to add hasActionArtifact flag
    const processedTasks = tasks.map((task: any) => {
      let hasActionArtifact = false;

      // Only check for action artifacts if the workflow is pending or in_progress
      if (
        includeLatestMessage &&
        task.chatMessages &&
        task.chatMessages.length > 0 &&
        (task.workflowStatus === WorkflowStatus.PENDING || task.workflowStatus === WorkflowStatus.IN_PROGRESS)
      ) {
        const latestMessage = task.chatMessages[0];
        hasActionArtifact = latestMessage.artifacts?.some((artifact: Artifact) => artifact.type === "FORM") || false;
      }

      // Return task with hasActionArtifact flag, removing chatMessages array to keep response clean
      const { chatMessages, ...taskWithoutMessages } = task;
      return {
        ...taskWithoutMessages,
        hasActionArtifact,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: includeLatestMessage ? processedTasks : tasks,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasMore,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get("x-middleware-user-id")!;
    const workspaceId = request.headers.get("x-middleware-workspace-id")!;
    const body = await request.json();
    const { title, description, status, priority, assigneeId, repositoryId, estimatedHours, actualHours } = body;
    // Validate required fields
    if (!title) {
      return NextResponse.json({ error: "Missing required field: title" }, { status: 400 });
    }
    // Validate and convert status if provided
    let taskStatus: TaskStatus = TaskStatus.TODO; // default
    if (status) {
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
    if (priority) {
      if (Object.values(Priority).includes(priority as Priority)) {
        taskPriority = priority as Priority;
      } else {
        return NextResponse.json(
          {
            error: `Invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`,
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
        workspaceId: workspaceId,
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
        data: task,
      },
      { status: 201 },
    );
    return NextResponse.json(
      {
        success: true,
        data: task,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
