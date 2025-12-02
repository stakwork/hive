import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ArtifactType, TaskSourceType, TaskStatus, WorkflowStatus } from "@prisma/client";
import { extractPrArtifact } from "@/lib/helpers/tasks";
import { EncryptionService } from "@/lib/encryption";
import { getUserAppTokens } from "@/lib/githubApp";
import { matchTaskToGraphViaPR } from "@/lib/github";

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
  testFilePath: string | null;
  testFileUrl: string | null;
  createdAt: string;
  hasVideo: boolean;
  badge: BadgeMetadata;
  task: {
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
}

interface TaskWithPR {
  id: string;
  testFilePath: string | null;
  chatMessages?: {
    artifacts?: {
      content?: {
        url?: string;
        status?: string;
      };
    }[];
  }[];
}

/**
 * Extract relative file path by removing owner/repo prefix if present
 * Example: "stakwork/hive/src/file.ts" -> "src/file.ts"
 */
function extractRelativePath(filePath: string, repositoryUrl?: string): string {
  if (!repositoryUrl) return filePath;

  try {
    // Extract owner/repo from GitHub URL
    // Example: https://github.com/stakwork/hive -> stakwork/hive
    const urlMatch = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!urlMatch) return filePath;

    const [, owner, repo] = urlMatch;
    const prefix = `${owner}/${repo}/`;

    // Remove prefix if present
    if (filePath.startsWith(prefix)) {
      return filePath.substring(prefix.length);
    }

    return filePath;
  } catch (error) {
    console.error("[extractRelativePath] Error:", error);
    return filePath;
  }
}

/**
 * Fetch E2E test nodes from graph microservice
 */
async function fetchE2eTestsFromGraph(swarmUrl: string, swarmApiKey: string): Promise<E2eTestNode[]> {
  try {
    const swarmUrlObj = new URL(swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";
    const graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355/nodes`;

    const url = new URL(graphUrl);
    url.searchParams.append("node_type", "E2etest");
    url.searchParams.append("output", "json");

    console.log("[fetchE2eTestsFromGraph] Fetching nodes", { graphUrl, hostname: swarmUrlObj.hostname });

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-token": swarmApiKey,
      },
    });

    if (!response.ok) {
      console.error("[fetchE2eTestsFromGraph] Request failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }

    const data = await response.json();
    const nodes = Array.isArray(data) ? data : [];

    console.log("[fetchE2eTestsFromGraph] Fetched nodes", { count: nodes.length });

    return nodes;
  } catch (error) {
    console.error("[fetchE2eTestsFromGraph] Error:", error);
    return [];
  }
}

/**
 * Calculate badge metadata for a task
 */
function calculateBadge(
  task: {
    status: TaskStatus;
    workflowStatus: WorkflowStatus | null;
  },
  prArtifact?: {
    content: {
      url: string;
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    };
  } | null,
): BadgeMetadata {
  // Check if deployed to graph first (highest priority)
  if (task.status === TaskStatus.DONE && task.workflowStatus === WorkflowStatus.COMPLETED) {
    return {
      type: "LIVE",
      text: "Live",
      color: "#10b981",
      borderColor: "#10b981",
      icon: null,
      hasExternalLink: false,
    };
  }

  // Check PR artifact (second priority)
  if (prArtifact?.content) {
    const prStatus = prArtifact.content.status;
    const prUrl = prArtifact.content.url;

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
  const workflowStatus = task.workflowStatus;

  if (
    workflowStatus === WorkflowStatus.FAILED ||
    workflowStatus === WorkflowStatus.ERROR ||
    workflowStatus === WorkflowStatus.HALTED
  ) {
    return {
      type: "WORKFLOW",
      text: "Failed",
      color: "#dc2626",
      borderColor: "#dc2626",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === WorkflowStatus.IN_PROGRESS || workflowStatus === WorkflowStatus.PENDING) {
    return {
      type: "WORKFLOW",
      text: "In Progress",
      color: "#ca8a04",
      borderColor: "#ca8a04",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === WorkflowStatus.COMPLETED) {
    return {
      type: "WORKFLOW",
      text: "Completed",
      color: "#16a34a",
      borderColor: "#16a34a",
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

/**
 * Construct GitHub URL for a file path
 */
function constructGithubUrl(
  repository: { repositoryUrl: string; branch: string } | null,
  filePath: string,
): string | null {
  if (!repository) return null;
  const branch = repository.branch || "main";
  return `${repository.repositoryUrl}/blob/${branch}/${filePath}`;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
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
            swarmUrl: true,
            swarmApiKey: true,
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

    const repository = workspace.repositories[0] || null;

    // 1. Fetch ALL existing tasks (including archived ones for matching)
    const allTasks = await db.task.findMany({
      where: {
        workspaceId: workspace.id,
        deleted: false,
        sourceType: TaskSourceType.USER_JOURNEY,
      },
      include: {
        repository: true,
        chatMessages: {
          orderBy: { timestamp: "desc" },
          take: 1,
          include: {
            artifacts: {
              where: { type: "PULL_REQUEST" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 2. Fetch graph nodes directly (no self-call)
    let graphNodes: E2eTestNode[] = [];
    if (workspace.swarm?.swarmUrl && workspace.swarm?.swarmApiKey) {
      const encryptionService = EncryptionService.getInstance();
      const decryptedApiKey = encryptionService.decryptField("swarmApiKey", workspace.swarm.swarmApiKey);
      graphNodes = await fetchE2eTestsFromGraph(workspace.swarm.swarmUrl, decryptedApiKey);
    }

    // 3. Group graph nodes by file (one task per file)
    // Extract relative paths by removing owner/repo prefix if present
    const nodesByFile = new Map<string, E2eTestNode[]>();
    const repositoryUrl = repository?.repositoryUrl;

    graphNodes.forEach((node) => {
      const rawFilePath = node.properties.file;
      const relativePath = extractRelativePath(rawFilePath, repositoryUrl);

      if (!nodesByFile.has(relativePath)) {
        nodesByFile.set(relativePath, []);
      }
      nodesByFile.get(relativePath)!.push(node);
    });

    console.log("[user-journeys] Syncing graph nodes to tasks", {
      workspaceId: workspace.id,
      filesInGraph: nodesByFile.size,
      existingTasks: allTasks.length,
    });

    // 4. Sync graph files to tasks
    const tasksToUpdate: Array<{ id: string; filePath: string; testFileUrl: string | null }> = [];
    const tasksToCreate: Array<{ filePath: string; nodes: E2eTestNode[] }> = [];

    // Get GitHub token for PR correlation
    let githubToken: string | null = null;
    try {
      const tokens = await getUserAppTokens(userId);
      githubToken = tokens?.accessToken || null;
    } catch (error) {
      console.log("[user-journeys] No GitHub token available for PR correlation", error);
    }

    for (const [filePath, nodes] of nodesByFile) {
      // Try to match existing task by testName (task.title)
      const testName = nodes[0].properties.name; // First test's name in the file
      let existingTask = allTasks.find((t) => t.title === testName);

      // Fallback: PR correlation (handles path changes)
      if (!existingTask && githubToken) {
        const mergedTasks = allTasks.filter(
          (t) =>
            t.chatMessages[0]?.artifacts[0]?.content &&
            typeof t.chatMessages[0].artifacts[0].content === "object" &&
            "status" in t.chatMessages[0].artifacts[0].content &&
            t.chatMessages[0].artifacts[0].content.status === "DONE",
        );

        for (const task of mergedTasks) {
          const match = await matchTaskToGraphViaPR(task as TaskWithPR, nodes, githubToken);
          if (match) {
            existingTask = task;
            console.log("[user-journeys] Matched task via PR correlation", {
              taskId: task.id,
              originalTitle: task.title,
              testName: testName,
            });
            break;
          }
        }
      }

      // Skip archived tasks - don't recreate or update them
      if (existingTask?.archived) {
        console.log("[user-journeys] Skipping archived task", {
          taskId: existingTask.id,
          testName: testName,
        });
        continue;
      }

      if (existingTask) {
        tasksToUpdate.push({
          id: existingTask.id,
          filePath: filePath,
          testFileUrl: constructGithubUrl(repository, filePath),
        });
      } else {
        tasksToCreate.push({ filePath, nodes });
      }
    }

    // Update existing tasks to mark as deployed and sync file paths
    if (tasksToUpdate.length > 0) {
      await Promise.all(
        tasksToUpdate.map((task) =>
          db.task.update({
            where: { id: task.id },
            data: {
              status: TaskStatus.DONE,
              workflowStatus: WorkflowStatus.COMPLETED,
              testFilePath: task.filePath,
              testFileUrl: task.testFileUrl,
            },
          }),
        ),
      );
      console.log("[user-journeys] Updated tasks", { count: tasksToUpdate.length });
    }

    // Create new tasks for unmatched graph files (manually added tests)
    for (const { filePath, nodes } of tasksToCreate) {
      await db.task.create({
        data: {
          title: nodes[0].properties.name,
          description: `E2E test file: ${filePath}`,
          workspaceId: workspace.id,
          sourceType: TaskSourceType.USER_JOURNEY,
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
          priority: "MEDIUM",
          testFilePath: filePath,
          testFileUrl: constructGithubUrl(repository, filePath),
          repositoryId: repository?.id || null,
          createdById: workspace.ownerId,
          updatedById: workspace.ownerId,
        },
      });
    }

    if (tasksToCreate.length > 0) {
      console.log("[user-journeys] Created tasks", { count: tasksToCreate.length });
    }

    // 5. Refresh tasks after sync (exclude archived)
    const updatedTasks = await db.task.findMany({
      where: {
        workspaceId: workspace.id,
        deleted: false,
        archived: false,
        sourceType: TaskSourceType.USER_JOURNEY,
      },
      include: {
        repository: true,
        chatMessages: {
          orderBy: { timestamp: "desc" },
          take: 1,
          include: {
            artifacts: {
              where: { type: "PULL_REQUEST" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 6. Check for video artifacts (separate optimized query)
    const taskIds = updatedTasks.map(t => t.id);
    console.log("[user-journeys] Checking videos for task IDs:", taskIds);
    const tasksWithVideos = await db.task.findMany({
      where: {
        id: { in: taskIds }
      },
      include: {
        chatMessages: {
          orderBy: { timestamp: "desc" },
          take: 10,
          include: {
            artifacts: {
              where: { type: ArtifactType.MEDIA },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
    console.log("[user-journeys] Tasks with messages found:", tasksWithVideos.length);
    console.log("[user-journeys] Message/artifact details:", tasksWithVideos.map(t => ({
      taskId: t.id,
      messageCount: t.chatMessages.length,
      artifactCounts: t.chatMessages.map(m => m.artifacts.length),
      artifactTypes: t.chatMessages.flatMap(m => m.artifacts.map(a => a.type))
    })));

    // Build Set for O(1) lookup
    const videoTaskIds = new Set<string>();
    for (const task of tasksWithVideos) {
      for (const message of task.chatMessages) {
        if (message.artifacts && message.artifacts.length > 0) {
          for (const artifact of message.artifacts) {
            try {
              // Prisma returns JSON fields as objects, not strings
              const content = typeof artifact.content === 'string'
                ? JSON.parse(artifact.content)
                : artifact.content;

              if (content && typeof content === 'object' && content.mediaType === "video" && content.s3Key) {
                videoTaskIds.add(task.id);
                break;
              }
            } catch (error) {
              console.error("[user-journeys] Error parsing artifact content:", error);
            }
          }
          if (videoTaskIds.has(task.id)) break;
        }
      }
    }
    console.log("[user-journeys] Tasks with videos:", Array.from(videoTaskIds));

    // 7. Process tasks with PR artifacts and video detection
    const processedTasks: UserJourneyResponse[] = await Promise.all(
      updatedTasks.map(async (task) => {
        const prArtifact = await extractPrArtifact(task, userId);
        return {
          id: task.id,
          title: task.title,
          testFilePath: task.testFilePath,
          testFileUrl: task.testFileUrl,
          createdAt: task.createdAt.toISOString(),
          hasVideo: videoTaskIds.has(task.id),
          badge: calculateBadge(task, prArtifact),
          task: {
            description: task.description,
            status: task.status,
            workflowStatus: task.workflowStatus,
            stakworkProjectId: task.stakworkProjectId,
            repository: task.repository || undefined,
          },
        };
      }),
    );

    console.log("[user-journeys] Returning processed tasks", { count: processedTasks.length });

    return NextResponse.json(
      {
        success: true,
        data: processedTasks,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching user journeys:", error);
    return NextResponse.json({ error: "Failed to fetch user journeys" }, { status: 500 });
  }
}
