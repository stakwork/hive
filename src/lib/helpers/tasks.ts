import { db } from "@/lib/db";
import { serviceConfigs } from "@/config/services";
import { getUserAppTokens } from "@/lib/githubApp";
import { TaskStatus, Prisma } from "@prisma/client";
import { releaseTaskPod } from "@/lib/pods/utils";

/**
 * Task sanitization helpers
 *
 * These functions remove sensitive fields from task objects before
 * sending them to the frontend, preventing credential leaks.
 */

/**
 * Remove sensitive agent credentials from a task object
 *
 * @param task - Task object potentially containing sensitive fields
 * @returns Sanitized task without agentPassword and agentUrl
 */
export function sanitizeTask<T extends { agentPassword?: string | null; agentUrl?: string | null }>(
  task: T,
): Omit<T, "agentPassword" | "agentUrl"> {
  const { agentPassword: _, agentUrl: __, ...sanitized } = task;
  return sanitized;
}

/**
 * Remove sensitive agent credentials from an array of task objects
 *
 * @param tasks - Array of task objects
 * @returns Array of sanitized tasks
 */
export function sanitizeTasks<T extends { agentPassword?: string | null; agentUrl?: string | null }>(
  tasks: T[],
): Omit<T, "agentPassword" | "agentUrl">[] {
  return tasks.map(sanitizeTask);
}

interface PrArtifactContent {
  url: string;
  status: "IN_PROGRESS" | "DONE" | "CANCELLED";
  progress?: {
    ciStatus?: "pending" | "success" | "failure";
    ciSummary?: string;
    state?: string;
  };
}

interface TaskPrContext {
  id: string;
  status: TaskStatus;
  podId?: string | null;
  workspaceId?: string;
  chatMessages?: Array<{
    artifacts?: Array<{
      id: string;
      type: string;
      content: Prisma.JsonValue;
    }>;
  }>;
}

async function syncMergedTaskFallback(
  task: TaskPrContext,
  { queryTaskForPodContext = false }: { queryTaskForPodContext?: boolean } = {},
): Promise<void> {
  let podId = task.podId;
  let workspaceId = task.workspaceId;

  if (task.status !== TaskStatus.DONE) {
    try {
      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.DONE },
      });
    } catch (error) {
      console.error("Error syncing merged PR task status:", error);
    }
  }

  if (queryTaskForPodContext && (!workspaceId || podId === undefined)) {
    try {
      const currentTask = await db.task.findUnique({
        where: { id: task.id },
        select: {
          workspaceId: true,
          podId: true,
        },
      });

      workspaceId = currentTask?.workspaceId;
      podId = currentTask?.podId;
    } catch (error) {
      console.error("Error loading merged PR task pod context:", error);
    }
  }

  if (!workspaceId || !podId) {
    return;
  }

  try {
    const result = await releaseTaskPod({
      taskId: task.id,
      podId,
      workspaceId,
      verifyOwnership: true,
      clearTaskFields: true,
      newWorkflowStatus: null,
    });

    if (!result.success) {
      console.error("Merged PR fallback failed to release pod:", {
        taskId: task.id,
        podId,
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Error releasing pod for merged PR fallback:", error);
  }
}

const PUBLISH_ARTIFACT_TYPES = ["PUBLISH_WORKFLOW", "PUBLISH_SCRIPT", "PUBLISH_PROMPT"] as const;
type PublishArtifactType = (typeof PUBLISH_ARTIFACT_TYPES)[number];

interface PublishArtifactContent {
  published?: boolean;
  name?: string;
  workflowName?: string;
  scriptName?: string;
  promptName?: string;
  [key: string]: Prisma.JsonValue | undefined;
}

/**
 * Extract the last publish artifact (Workflow, Script, or Prompt) from task chat messages.
 * PUBLISH_SKILL is explicitly excluded as it follows the PR flow.
 *
 * @param task - Task object with chatMessages array containing artifacts
 * @returns The last publish artifact or null if none found
 */
export function extractPublishArtifact(
  task: TaskPrContext,
): { id: string; type: PublishArtifactType; content: { published?: boolean; name?: string } } | null {
  if (!task.chatMessages || task.chatMessages.length === 0) {
    return null;
  }

  let result: { id: string; type: PublishArtifactType; content: { published?: boolean; name?: string } } | null = null;

  for (const message of task.chatMessages) {
    if (!message.artifacts || message.artifacts.length === 0) continue;
    for (const artifact of message.artifacts) {
      if (PUBLISH_ARTIFACT_TYPES.includes(artifact.type as PublishArtifactType)) {
        const raw = artifact.content as PublishArtifactContent | null;
        const name = raw?.workflowName ?? raw?.scriptName ?? raw?.promptName ?? raw?.name;
        result = {
          id: artifact.id,
          type: artifact.type as PublishArtifactType,
          content: {
            published: typeof raw?.published === "boolean" ? raw.published : undefined,
            name: typeof name === "string" ? name : undefined,
          },
        };
      }
    }
  }

  return result;
}

/**
 * Extract PR artifact from task chat messages and update status from GitHub
 *
 * This function searches through task chat messages to find PULL_REQUEST artifacts,
 * fetches the latest PR status from GitHub API, updates the artifact content in the database,
 * and updates the task status if the PR is merged.
 *
 * @param task - Task object with chatMessages array containing artifacts
 * @param userId - User ID for GitHub token authentication
 * @returns PR artifact with updated status, or null if no PR found
 */
export async function extractPrArtifact(
  task: TaskPrContext,
  userId: string,
): Promise<{ id: string; type: string; content: PrArtifactContent } | null> {
  if (!task.chatMessages || task.chatMessages.length === 0) {
    return null;
  }

  // Search through chat messages for PR artifact
  for (const message of task.chatMessages) {
    if (message.artifacts && message.artifacts.length > 0) {
      const prArt = message.artifacts.find((a) => a.type === "PULL_REQUEST");
      if (prArt && prArt.content) {
        const content = prArt.content as unknown as PrArtifactContent;
        const prUrl = content.url;

        // Skip GitHub API check if status is already DONE (merged PRs can't change)
        // Note: CANCELLED is not terminal - a closed PR can be re-opened or replaced with a new PR
        if (content.status === "DONE") {
          await syncMergedTaskFallback(task, {
            queryTaskForPodContext: task.podId !== undefined || task.workspaceId !== undefined,
          });
          return { id: prArt.id, type: prArt.type, content };
        }

        // Try to get fresh PR status from GitHub if PR URL exists
        if (prUrl && typeof prUrl === "string") {
          const prMatch = prUrl.match(/\/pull\/(\d+)/);
          if (prMatch && prMatch.input) {
            const [, owner, repo] = new URL(prMatch.input).pathname.split("/");
            const prNumber = parseInt(prMatch[1], 10);
            try {
              const tokens = await getUserAppTokens(userId, owner);
              if (tokens?.accessToken) {
                const response = await fetch(`${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/pulls/${prNumber}`, {
                  headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${tokens.accessToken}`,
                    "X-GitHub-Api-Version": "2022-11-28",
                  },
                });

                if (response.ok) {
                  const prData = await response.json();
                  const newStatus = prData.merged_at ? "DONE" : prData.state === "open" ? "IN_PROGRESS" : "CANCELLED";

                  // Update content object with new status
                  content.status = newStatus;

                  // Update artifact content in database
                  await db.artifact.update({
                    where: { id: prArt.id },
                    data: { content: content as unknown as import("@prisma/client").Prisma.InputJsonValue },
                  });

                  if (newStatus === "DONE") {
                    await syncMergedTaskFallback(task, { queryTaskForPodContext: true });
                  }
                }
              }
            } catch (error) {
              console.error("Error checking PR status:", error);
            }
          }
        } else {
          console.error("No PR URL found for task:", task.id);
        }

        return { id: prArt.id, type: prArt.type, content };
      }
    }
  }

  return null;
}
