import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { extractPrArtifact, sanitizeTask } from "@/lib/helpers/tasks";
import { Priority, Prisma, TaskSourceType, TaskStatus, WorkflowStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "5");
    const includeLatestMessage = searchParams.get("includeLatestMessage") === "true";
    const sourceType = searchParams.get("sourceType");
    const includeArchived = searchParams.get("includeArchived");
    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const hasPod = searchParams.get("hasPod") || undefined;
    const priority = searchParams.get("priority") || undefined;
    const requestContext = {
      workspaceId,
      page,
      limit,
      includeLatestMessage,
      sourceType,
      includeArchived,
      search,
      status,
      hasPod,
      priority,
      userId,
      url: request.url,
    };

    console.log("[api/tasks] GET start", requestContext);

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId query parameter is required" }, { status: 400 });
    }

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 1000) {
      return NextResponse.json(
        {
          error: "Invalid pagination parameters. Page must be >= 1, limit must be 1-100",
        },
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
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get tasks for the workspace with pagination
    const skip = (page - 1) * limit;

    // Build where clause
    // Filter by archived status based on includeArchived param
    // - includeArchived="true" -> show only archived tasks
    // - includeArchived="false" or not provided -> show only non-archived tasks
    const isShowingArchived = includeArchived === "true";

    const whereClause: Prisma.TaskWhereInput = {
      workspaceId,
      deleted: false,
      archived: isShowingArchived,
      // Exclude user journey tasks - they have their own dedicated page
      sourceType: { not: TaskSourceType.USER_JOURNEY },
    };

    // If showing non-archived tasks (Recent tab), apply visibility rules
    if (!isShowingArchived) {
      whereClause.OR = [
        // Show non-TODO tasks (active work)
        { status: { not: TaskStatus.TODO } },
        // Show agent mode tasks regardless of status
        { mode: "agent" },
        // Show Stakwork tasks regardless of status
        { stakworkProjectId: { not: null } },
        // Hide user journey tasks regardless of status
        // { sourceType: TaskSourceType.USER_JOURNEY },
      ];
    }

    // Add sourceType filter if provided
    if (sourceType && Object.values(TaskSourceType).includes(sourceType as TaskSourceType)) {
      whereClause.sourceType = sourceType as TaskSourceType;
    }

    // Add status filter if provided (status=running maps to workflowStatus=IN_PROGRESS)
    if (status) {
      if (status === "running") {
        whereClause.workflowStatus = WorkflowStatus.IN_PROGRESS;
      } else {
        // Validate against WorkflowStatus enum
        if (Object.values(WorkflowStatus).includes(status as WorkflowStatus)) {
          whereClause.workflowStatus = status as WorkflowStatus;
        } else {
          return NextResponse.json(
            {
              error: `Invalid status parameter. Must be 'running' or one of: ${Object.values(WorkflowStatus).join(", ")}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Add hasPod filter if provided
    if (hasPod !== undefined) {
      if (hasPod === "true") {
        whereClause.podId = { not: null };
      } else if (hasPod === "false") {
        whereClause.podId = null;
      } else {
        return NextResponse.json(
          {
            error: "Invalid hasPod parameter. Must be 'true' or 'false'",
          },
          { status: 400 }
        );
      }
    }

    // Add priority filter if provided
    if (priority !== undefined) {
      const validPriorities = ["LOW", "MEDIUM", "HIGH"];
      if (validPriorities.includes(priority)) {
        whereClause.priority = priority as "LOW" | "MEDIUM" | "HIGH";
      } else {
        return NextResponse.json(
          {
            error: `Invalid priority parameter. Must be one of: ${validPriorities.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Add search filter if provided
    if (search && search.trim()) {
      const existingOR = whereClause.OR;

      // Create search conditions
      const searchConditions = [
        {
          title: {
            contains: search.trim(),
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: search.trim(),
            mode: 'insensitive' as const,
          },
        },
      ];

      // If there's already an OR clause (from visibility rules), we need to combine them with AND
      if (existingOR && Array.isArray(existingOR)) {
        whereClause.AND = [
          { OR: existingOR },
          { OR: searchConditions },
        ];
        delete whereClause.OR;
      } else {
        whereClause.OR = searchConditions;
      }
    }

    const [tasks, totalCount] = await Promise.all([
      db.task.findMany({
        where: whereClause,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
          sourceType: true,
          mode: true,
          podId: true,
          stakworkProjectId: true,
          testFilePath: true,
          testFileUrl: true,
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
              branch: true,
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
          chatMessages: {
            select: {
              id: true,
              timestamp: true,
              artifacts: {
                where: {
                  type: "PULL_REQUEST",
                },
                select: {
                  id: true,
                  type: true,
                  content: true,
                },
                orderBy: {
                  createdAt: "desc",
                },
                take: 1,
              },
            },
            ...(includeLatestMessage && {
              orderBy: {
                timestamp: "desc",
              },
              take: 1,
            }),
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        skip,
        take: limit,
      }),
      db.task.count({
        where: whereClause,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    console.log("[api/tasks] GET success", {
      ...requestContext,
      returned: tasks.length,
      totalCount,
      totalPages,
      hasMore,
      isShowingArchived,
    });

    // Process tasks to add hasActionArtifact flag and PR artifact info
    const processedTasks = await Promise.all(
      tasks.map(async (task) => {
        let hasActionArtifact = false;

        // Only check for action artifacts if the workflow is pending or in_progress
        if (
          includeLatestMessage &&
          task.chatMessages &&
          task.chatMessages.length > 0 &&
          (task.workflowStatus === WorkflowStatus.PENDING || task.workflowStatus === WorkflowStatus.IN_PROGRESS)
        ) {
          const latestMessage = task.chatMessages[0];
          hasActionArtifact =
            latestMessage.artifacts?.some((artifact: { type: string }) => artifact.type === "FORM") || false;
        }

        // Extract PR artifact if it exists using shared utility
        const prArtifact = await extractPrArtifact(task, userId);

        // Update task status in memory if it was updated by extractPrArtifact
        if (prArtifact?.content?.status === "DONE") {
          task.status = TaskStatus.DONE;
        }

        // Return task with hasActionArtifact flag and PR artifact, removing chatMessages array to keep response clean
        const { chatMessages: _, ...taskWithoutMessages } = task;
        return {
          ...taskWithoutMessages,
          hasActionArtifact,
          prArtifact,
        };
      }),
    );

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
    console.error("[api/tasks] Error fetching tasks", {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
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
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
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
      mode,
      runBuild,
      runTestSuite,
    } = body;

    // Validate required fields
    if (!title || !workspaceSlug) {
      return NextResponse.json({ error: "Missing required fields: title, workspaceId" }, { status: 400 });
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
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const workspaceId = workspace.id;

    // Verify that the user exists in the database
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

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
        return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
      }
    }

    // Validate repository exists and belongs to workspace if provided
    if (repositoryId) {
      const repository = await db.repository.findFirst({
        where: {
          id: repositoryId,
        },
      });

      if (!repository || repository.workspaceId !== workspaceId) {
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
        mode: mode || "live", // Save the task mode, default to "live"
        runBuild: runBuild ?? true,
        runTestSuite: runTestSuite ?? true,
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
        data: sanitizeTask(task),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
