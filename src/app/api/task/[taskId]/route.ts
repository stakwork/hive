import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { extractPrArtifact } from "@/lib/helpers/tasks";

export async function GET(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    // Check for API key authentication
    const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization");
    let userId: string | undefined;
    let isApiKeyAuth = false;

    if (apiKey && process.env.API_KEY && apiKey === process.env.API_KEY) {
      // Valid API key authentication
      isApiKeyAuth = true;
    } else if (apiKey && process.env.API_KEY) {
      // Invalid API key provided
      return NextResponse.json({ error: "Unauthorized - Invalid API key" }, { status: 401 });
    } else {
      // Fall back to session authentication
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      userId = (session.user as { id?: string })?.id;
      if (!userId) {
        return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
      }
    }

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    // Fetch the task with all related data
    const task = await db.task.findUnique({
      where: {
        id: taskId,
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
        mode: true,
        stakworkProjectId: true,
        testFilePath: true,
        testFileUrl: true,
        estimatedHours: true,
        actualHours: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
        assignee: {
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
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            ownerId: true,
            members: {
              where: isApiKeyAuth ? undefined : {
                userId: userId,
              },
              select: {
                role: true,
                userId: true,
              },
            },
          },
        },
        chatMessages: {
          select: {
            id: true,
            role: true,
            message: true,
            timestamp: true,
            artifacts: {
              select: {
                id: true,
                type: true,
                content: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: "desc",
              },
            },
          },
          orderBy: {
            timestamp: "asc",
          },
        },
        _count: {
          select: {
            chatMessages: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify user has access to the workspace
    const workspace = task.workspace as {
      id: string;
      name: string;
      slug: string;
      ownerId: string;
      members: Array<{ role: string; userId: string }>;
    };

    if (isApiKeyAuth) {
      // For API key auth, extract userId from workspace owner or any member
      userId = workspace.ownerId;
    } else {
      // For session auth, verify access
      const isOwner = workspace.ownerId === userId;
      const isMember = workspace.members.length > 0;

      if (!isOwner && !isMember) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // Ensure userId is defined at this point
    if (!userId) {
      return NextResponse.json({ error: "Unable to determine user context" }, { status: 500 });
    }

    // Extract PR artifact if it exists
    const prArtifact = await extractPrArtifact(task, userId);

    // Return task with PR artifact
    return NextResponse.json(
      {
        success: true,
        data: {
          ...task,
          prArtifact,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching task:", error);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}
