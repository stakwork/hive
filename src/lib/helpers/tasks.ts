import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import { TaskStatus, Prisma } from "@prisma/client";

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { agentPassword, agentUrl, ...sanitized } = task;
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
  [key: string]: Prisma.JsonValue;
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
  task: {
    id: string;
    status: TaskStatus;
    chatMessages?: Array<{
      artifacts?: Array<{
        id: string;
        type: string;
        content: Prisma.JsonValue;
      }>;
    }>;
  },
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
        const content = prArt.content as PrArtifactContent;
        const prUrl = content.url;

        // Skip GitHub API check if status is already in a terminal state (DONE or CANCELLED)
        const isTerminalState = content.status === "DONE" || content.status === "CANCELLED";
        if (isTerminalState) {
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
                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
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
                    data: { content: content },
                  });

                  // If PR is merged, update task status
                  if (newStatus === "DONE" && task.status !== TaskStatus.DONE) {
                    await db.task.update({
                      where: { id: task.id },
                      data: { status: TaskStatus.DONE },
                    });
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

/**
 * Update task status to DONE when a PULL_REQUEST artifact is present
 *
 * This function checks if any artifact is a PULL_REQUEST and automatically
 * sets the task status to DONE. This matches agent mode behavior where
 * tasks are marked complete as soon as a PR is created (not when merged).
 *
 * @param taskId - Task ID to update
 * @param artifacts - Array of artifacts to check
 */
export async function updateTaskStatusForPullRequest(
  taskId: string,
  artifacts: Array<{ type: string }>,
): Promise<void> {
  const hasPullRequest = artifacts.some((artifact) => artifact.type === "PULL_REQUEST");

  if (hasPullRequest) {
    await db.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.DONE },
    });
  }
}
