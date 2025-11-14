import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { TaskSourceType } from "@prisma/client";
import { extractPrArtifact } from "@/lib/helpers/tasks";

interface BadgeMetadata {
  type: "PR" | "WORKFLOW" | "LIVE";
  text: string;
  url?: string;
  color: string;
  borderColor: string;
  icon?: "GitPullRequest" | "GitMerge" | "GitPullRequestClosed" | null;
  hasExternalLink?: boolean;
}

interface E2eTestNode {
  node_type: string;
  ref_id: string;
  properties: {
    name: string;
    file: string;
    body: string;
    test_kind: string;
    node_key: string;
    start: number;
    end: number;
    token_count: number;
  };
}

interface UserJourneyResponse {
  id: string;
  title: string;
  type: "GRAPH_NODE" | "TASK";
  testFilePath: string | null;
  testFileUrl: string | null;
  createdAt: string;
  badge: BadgeMetadata;
  task?: {
    description: string | null;
    status: string;
    workflowStatus: string | null;
    stakworkProjectId: number | null;
    repository?: {
      id: string;
      name: string;
      repositoryUrl: string;
      branch: string;
    };
  };
  graphNode?: {
    body: string;
    testKind: string;
  };
}

function calculateBadge(
  type: "GRAPH_NODE" | "TASK",
  task?: {
    workflowStatus: string | null;
    prArtifact?: {
      content: {
        url: string;
        status: "IN_PROGRESS" | "DONE" | "CANCELLED";
      };
    } | null;
  },
): BadgeMetadata {
  // Graph nodes always show "Live" badge
  if (type === "GRAPH_NODE") {
    return {
      type: "LIVE",
      text: "Live",
      color: "#10b981",
      borderColor: "#10b981",
      icon: null,
      hasExternalLink: false,
    };
  }

  // For tasks, check PR artifact first (highest priority)
  if (task?.prArtifact?.content) {
    const prStatus = task.prArtifact.content.status;
    const prUrl = task.prArtifact.content.url;

    if (prStatus === "IN_PROGRESS") {
      return {
        type: "PR",
        text: "Open",
        url: prUrl,
        color: "#238636",
        borderColor: "#238636",
        icon: "GitPullRequest",
        hasExternalLink: true,
      };
    }

    if (prStatus === "CANCELLED") {
      return {
        type: "PR",
        text: "Closed",
        url: prUrl,
        color: "#6e7681",
        borderColor: "#6e7681",
        icon: "GitPullRequestClosed",
        hasExternalLink: true,
      };
    }

    if (prStatus === "DONE") {
      return {
        type: "PR",
        text: "Merged",
        url: prUrl,
        color: "#8957e5",
        borderColor: "#8957e5",
        icon: "GitMerge",
        hasExternalLink: true,
      };
    }
  }

  // Fallback to workflow status
  const workflowStatus = task?.workflowStatus;

  if (workflowStatus === "COMPLETED") {
    return {
      type: "WORKFLOW",
      text: "Completed",
      color: "#16a34a",
      borderColor: "#16a34a",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === "FAILED" || workflowStatus === "HALTED" || workflowStatus === "ERROR") {
    return {
      type: "WORKFLOW",
      text: "Failed",
      color: "#dc2626",
      borderColor: "#dc2626",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === "IN_PROGRESS" || workflowStatus === "PENDING") {
    return {
      type: "WORKFLOW",
      text: "In Progress",
      color: "#ca8a04",
      borderColor: "#ca8a04",
      icon: null,
      hasExternalLink: false,
    };
  }

  // Default: Pending
  return {
    type: "WORKFLOW",
    text: "Pending",
    color: "#6b7280",
    borderColor: "#6b7280",
    icon: null,
    hasExternalLink: false,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const { slug } = await params;

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
        swarm: {
          select: {
            id: true,
          },
        },
        members: {
          where: {
            userId: userId,
          },
          select: {
            role: true,
          },
        },
        repositories: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
            branch: true,
          },
          take: 1,
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

    // Fetch user journey tasks
    const tasks = await db.task.findMany({
      where: {
        workspaceId: workspace.id,
        deleted: false,
        sourceType: TaskSourceType.USER_JOURNEY,
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        workflowStatus: true,
        testFilePath: true,
        testFileUrl: true,
        stakworkProjectId: true,
        createdAt: true,
        repository: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
            branch: true,
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
          orderBy: {
            timestamp: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Process tasks to extract PR artifacts
    const processedTasks = await Promise.all(
      tasks.map(async (task) => {
        const prArtifact = await extractPrArtifact(task, userId);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { chatMessages, ...taskWithoutMessages } = task;
        return {
          ...taskWithoutMessages,
          prArtifact,
        };
      }),
    );

    // Filter out tasks with merged PRs (they appear as graph nodes instead)
    const pendingTasks = processedTasks.filter(
      (task) => !task.prArtifact?.content || task.prArtifact.content.status !== "DONE",
    );

    // Fetch E2E test nodes from graph
    let graphNodes: E2eTestNode[] = [];
    if (workspace.swarm) {
      try {
        const graphResponse = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`,
          {
            headers: {
              Cookie: request.headers.get("Cookie") || "",
            },
          },
        );

        if (graphResponse.ok) {
          const graphResult = await graphResponse.json();
          if (graphResult.success && Array.isArray(graphResult.data)) {
            graphNodes = graphResult.data;
          }
        }
      } catch (error) {
        console.error("Error fetching E2E tests from graph:", error);
      }
    }

    // Helper to construct GitHub URL for graph node files
    const getGithubUrlForGraphNode = (node: E2eTestNode): string | null => {
      const repo = workspace.repositories?.[0];
      if (!repo) return null;
      const branch = repo.branch || "main";
      return `${repo.repositoryUrl}/blob/${branch}/${node.properties.file}`;
    };

    // Convert graph nodes to response format
    const graphRows: UserJourneyResponse[] = graphNodes.map((node) => ({
      id: node.ref_id,
      title: node.properties.name,
      type: "GRAPH_NODE" as const,
      testFilePath: node.properties.file,
      testFileUrl: getGithubUrlForGraphNode(node),
      createdAt: new Date().toISOString(),
      badge: calculateBadge("GRAPH_NODE"),
      graphNode: {
        body: node.properties.body,
        testKind: node.properties.test_kind,
      },
    }));

    // Convert pending tasks to response format
    const taskRows: UserJourneyResponse[] = pendingTasks.map((task) => ({
      id: task.id,
      title: task.title,
      type: "TASK" as const,
      testFilePath: task.testFilePath,
      testFileUrl: task.testFileUrl,
      createdAt: task.createdAt.toISOString(),
      badge: calculateBadge("TASK", {
        workflowStatus: task.workflowStatus,
        prArtifact: task.prArtifact,
      }),
      task: {
        description: task.description,
        status: task.status,
        workflowStatus: task.workflowStatus,
        stakworkProjectId: task.stakworkProjectId,
        repository: task.repository || undefined,
      },
    }));

    // Combine and sort by created date (newest first)
    const allRows = [...graphRows, ...taskRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json(
      {
        success: true,
        data: allRows,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching user journeys:", error);
    return NextResponse.json({ error: "Failed to fetch user journeys" }, { status: 500 });
  }
}
