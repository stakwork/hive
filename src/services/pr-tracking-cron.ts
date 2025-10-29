import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";

export interface PRTrackingExecutionResult {
  success: boolean;
  tasksProcessed: number;
  tasksCompleted: number;
  errorCount: number;
  errors: Array<{
    taskId: string;
    error: string;
  }>;
  timestamp: string;
}

/**
 * Extract owner and repo from a GitHub PR URL
 * Format: https://github.com/owner/repo/pull/new/branchName or
 *         https://github.com/owner/repo/pull/123
 */
function parseGitHubPRUrl(prUrl: string): { owner: string; repo: string } | null {
  try {
    const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      };
    }
    return null;
  } catch (error) {
    console.error("Error parsing PR URL:", error);
    return null;
  }
}

/**
 * Check if a PR has been merged using GitHub API
 */
async function checkPRMergeStatus(
  owner: string,
  repo: string,
  branchName: string,
  githubToken: string
): Promise<{ merged: boolean; mergedAt: Date | null; prNumber?: number }> {
  try {
    // First, search for PRs with this branch as the head
    const searchUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&head=${owner}:${branchName}`;
    
    console.log(`[PRTracking] Checking PR status: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!searchResponse.ok) {
      console.error(`[PRTracking] GitHub API error: ${searchResponse.status}`);
      return { merged: false, mergedAt: null };
    }

    const prs = await searchResponse.json() as Array<{
      number: number;
      merged_at: string | null;
      state: string;
    }>;

    if (prs.length === 0) {
      console.log(`[PRTracking] No PR found for branch ${branchName}`);
      return { merged: false, mergedAt: null };
    }

    // Take the first PR (most recent)
    const pr = prs[0];
    
    if (pr.merged_at) {
      console.log(`[PRTracking] PR #${pr.number} merged at ${pr.merged_at}`);
      return {
        merged: true,
        mergedAt: new Date(pr.merged_at),
        prNumber: pr.number,
      };
    }

    console.log(`[PRTracking] PR #${pr.number} not merged yet (state: ${pr.state})`);
    return { merged: false, mergedAt: null, prNumber: pr.number };
  } catch (error) {
    console.error("[PRTracking] Error checking PR merge status:", error);
    return { merged: false, mergedAt: null };
  }
}

/**
 * Execute PR tracking - check agent tasks with open PRs and mark completed when merged
 */
export async function executePRTracking(): Promise<PRTrackingExecutionResult> {
  const startTime = new Date();
  const errors: Array<{ taskId: string; error: string }> = [];
  let tasksProcessed = 0;
  let tasksCompleted = 0;

  try {
    console.log("[PRTracking] Starting execution at", startTime.toISOString());

    // Find agent mode tasks that:
    // 1. Have a PR URL and branch
    // 2. Are not yet marked as merged (prMergedAt is null)
    // 3. Are in IN_PROGRESS or TODO status (not already DONE)
    const tasksWithPRs = await db.task.findMany({
      where: {
        mode: "agent",
        prUrl: {
          not: null,
        },
        prBranch: {
          not: null,
        },
        prMergedAt: null, // Only check PRs that haven't been marked as merged
        status: {
          in: ["IN_PROGRESS", "TODO"],
        },
        deleted: false,
      },
      include: {
        workspace: {
          include: {
            sourceControlOrg: true,
            owner: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    console.log(`[PRTracking] Found ${tasksWithPRs.length} tasks with open PRs to check`);

    for (const task of tasksWithPRs) {
      try {
        tasksProcessed++;
        
        if (!task.prUrl || !task.prBranch) {
          console.log(`[PRTracking] Skipping task ${task.id}: missing PR URL or branch`);
          continue;
        }

        // Parse the PR URL to get owner and repo
        const prInfo = parseGitHubPRUrl(task.prUrl);
        if (!prInfo) {
          console.log(`[PRTracking] Skipping task ${task.id}: could not parse PR URL ${task.prUrl}`);
          errors.push({
            taskId: task.id,
            error: `Could not parse PR URL: ${task.prUrl}`,
          });
          continue;
        }

        // Get GitHub token for the workspace
        if (!task.workspace.sourceControlOrg) {
          console.log(`[PRTracking] Skipping task ${task.id}: no source control org linked`);
          continue;
        }

        const tokens = await getUserAppTokens(
          task.workspace.ownerId,
          task.workspace.sourceControlOrg.githubLogin
        );

        if (!tokens?.accessToken) {
          console.log(`[PRTracking] Skipping task ${task.id}: no GitHub token available`);
          errors.push({
            taskId: task.id,
            error: "No GitHub access token available",
          });
          continue;
        }

        // Check if the PR has been merged
        const mergeStatus = await checkPRMergeStatus(
          prInfo.owner,
          prInfo.repo,
          task.prBranch,
          tokens.accessToken
        );

        if (mergeStatus.merged && mergeStatus.mergedAt) {
          // Update the task to mark it as completed
          await db.task.update({
            where: { id: task.id },
            data: {
              status: "DONE",
              prMergedAt: mergeStatus.mergedAt,
              workflowStatus: "COMPLETED",
              workflowCompletedAt: mergeStatus.mergedAt,
            },
          });

          tasksCompleted++;
          console.log(
            `[PRTracking] ✓ Task ${task.id} marked as DONE - PR #${mergeStatus.prNumber} merged at ${mergeStatus.mergedAt.toISOString()}`
          );
        } else {
          console.log(`[PRTracking] Task ${task.id} - PR not merged yet`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[PRTracking] Error processing task ${task.id}:`, errorMessage);
        errors.push({
          taskId: task.id,
          error: errorMessage,
        });
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.log(
      `[PRTracking] Execution completed in ${duration}ms. Processed ${tasksProcessed} tasks, completed ${tasksCompleted} tasks, ${errors.length} errors`
    );

    return {
      success: errors.length === 0,
      tasksProcessed,
      tasksCompleted,
      errorCount: errors.length,
      errors,
      timestamp: endTime.toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PRTracking] Critical error during execution:", errorMessage);

    return {
      success: false,
      tasksProcessed,
      tasksCompleted,
      errorCount: errors.length + 1,
      errors: [
        ...errors,
        {
          taskId: "SYSTEM",
          error: `Critical execution error: ${errorMessage}`,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }
}
