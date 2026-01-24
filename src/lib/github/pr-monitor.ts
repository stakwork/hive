/**
 * PR Monitor Service
 *
 * Monitors open pull requests for conflicts and CI failures.
 * When issues are detected, it can:
 * 1. Update the PR artifact's progress state
 * 2. Notify the user via Pusher
 * 3. Trigger a fix based on task mode:
 *    - "agent" mode: Direct connection to agent server for streaming fixes
 *    - "live" mode: Stakwork workflow for automated fixes
 */

import { Octokit } from "@octokit/rest";
import { db } from "@/lib/db";
import { Prisma, ChatRole, ChatStatus, TaskStatus } from "@prisma/client";
import { getUserAppTokens } from "@/lib/githubApp";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { EncryptionService } from "@/lib/encryption";
import { createWebhookToken, generateWebhookSecret } from "@/lib/auth/agent-jwt";
import { createChatMessageAndTriggerStakwork } from "@/services/task-workflow";
import type { PullRequestProgress, PullRequestContent } from "@/lib/chat";
import { fetchCIStatus } from "./pr-ci";

const LOG_PREFIX = "[PRMonitor]";
const encryptionService = EncryptionService.getInstance();

// Retry limits to prevent infinite loops
const PR_FIX_MAX_ATTEMPTS = parseInt(process.env.PR_FIX_MAX_ATTEMPTS || "6", 10);
const PR_FIX_COOLDOWN_MS = parseInt(process.env.PR_FIX_COOLDOWN_MS || "600000", 10); // 10 minutes

// Simple console logging helpers
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
};

// Types for GitHub API responses
interface GitHubPRData {
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}

// Result of checking a single PR
export interface PRCheckResult {
  artifactId: string;
  taskId: string;
  prNumber: number;
  owner: string;
  repo: string;
  state: PullRequestProgress["state"];
  mergeable: boolean | null;
  ciStatus: PullRequestProgress["ciStatus"];
  ciSummary?: string;
  problemDetails?: string;
  conflictFiles?: string[];
  failedChecks?: string[];
  failedCheckLogs?: Record<string, string>;
  prState: "open" | "closed";
  merged: boolean;
  headBranch: string;
  baseBranch: string;
}

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number
 */
export function parsePRUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  // Match patterns like:
  // https://github.com/owner/repo/pull/123
  // https://github.com/owner/repo/pull/123/files
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * Fetch PR status from GitHub API
 */
async function fetchPRStatus(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<GitHubPRData> {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return data as GitHubPRData;
}

/**
 * Check if the PR branch is behind the base branch
 * Returns true if base branch has commits not in the head branch
 */
async function isPRBehindBase(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseBranch: string,
  headBranch: string,
): Promise<boolean> {
  try {
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: headBranch,
      head: baseBranch,
    });
    // If base is ahead of head, the PR is behind
    return data.ahead_by > 0;
  } catch (error) {
    log.warn("Failed to compare branches", { owner, repo, baseBranch, headBranch, error: String(error) });
    return false;
  }
}

/**
 * Merge the base branch into the PR's head branch using GitHub's Merges API
 *
 * This creates a merge commit, similar to the "Update branch" button in GitHub UI.
 * Works when there are no conflicts - will fail if conflicts exist.
 *
 * @returns Object with success status and optional error/sha
 */
export async function mergeBaseBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  headBranch: string,
  baseBranch: string,
  commitMessage?: string,
): Promise<{ success: boolean; sha?: string; error?: string }> {
  try {
    const { data } = await octokit.repos.merge({
      owner,
      repo,
      base: headBranch, // The branch to merge INTO (PR's head branch)
      head: baseBranch, // The branch to merge FROM (e.g., main)
      commit_message: commitMessage || `Merge branch '${baseBranch}' into ${headBranch}`,
    });

    log.info("Successfully merged base branch into PR branch", {
      owner,
      repo,
      headBranch,
      baseBranch,
      sha: data.sha,
    });

    return { success: true, sha: data.sha };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // GitHub returns 409 Conflict if there are merge conflicts
    if (errorMessage.includes("409") || errorMessage.includes("Merge conflict")) {
      log.info("Cannot auto-merge: conflicts exist", { owner, repo, headBranch, baseBranch });
      return { success: false, error: "Merge conflicts exist" };
    }

    log.error("Failed to merge base branch", {
      owner,
      repo,
      headBranch,
      baseBranch,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Check a single PR and return its current state
 */
export async function checkPR(
  octokit: Octokit,
  artifactId: string,
  taskId: string,
  prUrl: string,
): Promise<PRCheckResult | null> {
  const parsed = parsePRUrl(prUrl);
  if (!parsed) {
    log.warn("Could not parse PR URL", { prUrl });
    return null;
  }

  const { owner, repo, prNumber } = parsed;

  try {
    // Fetch PR data
    const prData = await fetchPRStatus(octokit, owner, repo, prNumber);

    // If PR is closed/merged, return that state
    if (prData.state === "closed") {
      return {
        artifactId,
        taskId,
        prNumber,
        owner,
        repo,
        state: "healthy",
        mergeable: null,
        ciStatus: undefined,
        prState: "closed",
        merged: prData.merged,
        headBranch: prData.head.ref,
        baseBranch: prData.base.ref,
      };
    }

    // Fetch CI status
    const ciResult = await fetchCIStatus(octokit, owner, repo, prData.head.sha);

    // Determine state
    let state: PullRequestProgress["state"] = "healthy";
    let problemDetails: string | undefined;
    let conflictFiles: string[] | undefined;

    // Check for merge conflicts
    // mergeable can be: true, false, or null (still computing)
    if (prData.mergeable === false) {
      state = "conflict";
      problemDetails = `PR cannot be merged due to conflicts with ${prData.base.ref}`;
      // Note: GitHub doesn't provide conflict file list via API without attempting merge
      // The agent will need to discover this when fixing
    } else if (prData.mergeable === null) {
      // GitHub is still computing mergeability
      state = "checking";
    }

    // Check for CI status (conflict takes precedence)
    if (state === "healthy") {
      if (ciResult.status === "failure") {
        state = "ci_failure";
        problemDetails = `CI checks failed: ${ciResult.failedChecks.join(", ")}`;
      } else if (ciResult.status === "pending") {
        // CI is still running - use "checking" state so we re-check soon
        state = "checking";
      }
    }

    // Check if PR is behind base branch (only if otherwise healthy and CI passed)
    if (state === "healthy" && prData.mergeable === true) {
      const isBehind = await isPRBehindBase(octokit, owner, repo, prData.base.ref, prData.head.ref);
      if (isBehind) {
        state = "out_of_date";
        problemDetails = `PR branch is behind ${prData.base.ref} and needs to be updated`;
      }
    }

    return {
      artifactId,
      taskId,
      prNumber,
      owner,
      repo,
      state,
      mergeable: prData.mergeable,
      ciStatus: ciResult.status,
      ciSummary: ciResult.summary,
      problemDetails,
      conflictFiles,
      failedChecks: ciResult.failedChecks.length > 0 ? ciResult.failedChecks : undefined,
      failedCheckLogs: Object.keys(ciResult.failedCheckLogs).length > 0 ? ciResult.failedCheckLogs : undefined,
      prState: prData.state,
      merged: prData.merged,
      headBranch: prData.head.ref,
      baseBranch: prData.base.ref,
    };
  } catch (error) {
    log.error("Error checking PR", { owner, repo, prNumber, error: String(error) });
    return null;
  }
}

/**
 * Update a PR artifact with new progress state
 */
export async function updatePRArtifactProgress(
  artifactId: string,
  progress: PullRequestProgress,
  prStatus?: "IN_PROGRESS" | "DONE" | "CANCELLED",
): Promise<void> {
  // Fetch current artifact content
  const artifact = await db.artifact.findUnique({
    where: { id: artifactId },
    select: { content: true },
  });

  if (!artifact?.content) {
    log.warn("Artifact not found or has no content", { artifactId });
    return;
  }

  const content = artifact.content as unknown as PullRequestContent;

  // Update content with new progress
  const updatedContent = {
    ...content,
    progress,
    ...(prStatus && { status: prStatus }),
  } as unknown as Prisma.InputJsonValue;

  await db.artifact.update({
    where: { id: artifactId },
    data: { content: updatedContent },
  });

  log.info("Updated artifact progress", {
    artifactId,
    state: progress.state,
    resolution: progress.resolution?.status,
  });
}

/**
 * Send a Pusher notification about PR status change
 */
export async function notifyPRStatusChange(
  taskId: string,
  prNumber: number,
  state: PullRequestProgress["state"],
  problemDetails?: string,
): Promise<void> {
  const channelName = getTaskChannelName(taskId);

  await pusherServer.trigger(channelName, PUSHER_EVENTS.PR_STATUS_CHANGE, {
    taskId,
    prNumber,
    state,
    problemDetails,
    timestamp: new Date(),
  });

  log.info("Sent Pusher notification", { taskId, prNumber, state });
}

/**
 * Find open PR artifacts that need monitoring
 *
 * Uses raw SQL for efficient JSON filtering to avoid loading all PR artifacts.
 * Only fetches PRs where:
 * - status is not DONE or CANCELLED (open PRs)
 * - resolution status is not "in_progress" or "gave_up"
 * - task is not deleted/archived
 */
export async function findOpenPRArtifacts(limit: number = 50): Promise<
  Array<{
    artifactId: string;
    taskId: string;
    prUrl: string;
    workspaceId: string;
    ownerId: string;
    podId: string | null;
    progress: PullRequestProgress | undefined;
  }>
> {
  // Use raw query for efficient JSON filtering at the database level
  // This avoids loading potentially 100k+ artifacts into memory
  // Table/column mappings from schema.prisma:
  //   artifacts (message_id, created_at)
  //   chat_messages (task_id)
  //   tasks (workspace_id, pod_id)
  //   workspaces (owner_id)
  const artifacts = await db.$queryRaw<
    Array<{
      id: string;
      content: PullRequestContent;
      task_id: string;
      pod_id: string | null;
      workspace_id: string;
      owner_id: string;
    }>
  >`
    SELECT 
      a.id,
      a.content,
      t.id as task_id,
      t.pod_id,
      t.workspace_id,
      w.owner_id
    FROM artifacts a
    JOIN chat_messages m ON a.message_id = m.id
    JOIN tasks t ON m.task_id = t.id
    JOIN workspaces w ON t.workspace_id = w.id
    WHERE 
      -- Indexed filters first (fast)
      a.type = 'PULL_REQUEST'
      AND t.deleted = false
      AND t.archived = false
      -- Simple JSON checks (moderate)
      AND a.content->>'url' IS NOT NULL
      AND COALESCE(a.content->>'status', 'open') NOT IN ('DONE', 'CANCELLED')
      AND COALESCE(a.content->'progress'->'resolution'->>'status', '') NOT IN ('in_progress', 'gave_up')
      -- Cooldown logic: only "healthy" PRs (CI passed, no issues) have 1-hour cooldown
      -- All other states (checking, conflict, ci_failure) are re-checked every cron run
      AND (
        COALESCE(a.content->'progress'->>'state', '') != 'healthy'
        OR a.content->'progress'->>'lastCheckedAt' IS NULL
        OR (a.content->'progress'->>'lastCheckedAt')::timestamptz < NOW() - INTERVAL '1 hour'
      )
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `;

  return artifacts.map((artifact) => ({
    artifactId: artifact.id,
    taskId: artifact.task_id,
    prUrl: artifact.content.url,
    workspaceId: artifact.workspace_id,
    ownerId: artifact.owner_id,
    podId: artifact.pod_id,
    progress: artifact.content.progress,
  }));
}

/**
 * Get an authenticated Octokit client for a workspace
 */
export async function getOctokitForWorkspace(userId: string, owner: string): Promise<Octokit | null> {
  const tokens = await getUserAppTokens(userId, owner);
  if (!tokens?.accessToken) {
    return null;
  }
  return new Octokit({ auth: tokens.accessToken });
}

/**
 * Build the prompt for the agent to fix a PR issue
 */
export function buildFixPrompt(result: PRCheckResult): string {
  if (result.state === "conflict") {
    return `The PR (#${result.prNumber}) created from the branch you are on (${result.headBranch}) in ${result.owner}/${result.repo} has merge conflicts.

Please:
1. Fetch the latest changes from the base branch (${result.problemDetails?.includes("with") ? result.problemDetails.split("with ")[1] : "main"})
2. Resolve any merge conflicts
3. Changes will be pushed to the PR automatically, you don't need to push manually.

${result.problemDetails || ""}`;
  }

  if (result.state === "ci_failure") {
    let prompt = `The pull request #${result.prNumber} in ${result.owner}/${result.repo} has failing CI checks.

Failed checks: ${result.failedChecks?.join(", ") || "unknown"}

Please:
1. Review the CI failure logs below
2. Fix the issues causing the failures
3. Changes will be pushed to the PR automatically, you don't need to push manually.

${result.problemDetails || ""}`;

    // Append log excerpts if available
    if (result.failedCheckLogs && Object.keys(result.failedCheckLogs).length > 0) {
      prompt += "\n\n<logs>\n";
      for (const [checkName, logs] of Object.entries(result.failedCheckLogs)) {
        prompt += `### ${checkName}\n${logs}\n\n`;
      }
      prompt += "</logs>";
    }

    return prompt;
  }

  return `Please check the status of pull request #${result.prNumber} in ${result.owner}/${result.repo}.`;
}

/**
 * Main monitoring function - checks all open PRs and handles issues
 *
 * @param maxPRs - Maximum number of PRs to check in one run (for rate limiting)
 * @returns Summary of the monitoring run
 */
export async function monitorOpenPRs(maxPRs: number = 10): Promise<{
  checked: number;
  conflicts: number;
  ciFailures: number;
  ciPending: number;
  outOfDate: number;
  autoMerged: number;
  healthy: number;
  errors: number;
  agentTriggered: number;
  notified: number;
}> {
  const stats = {
    checked: 0,
    conflicts: 0,
    ciFailures: 0,
    ciPending: 0,
    outOfDate: 0,
    autoMerged: 0,
    healthy: 0,
    errors: 0,
    agentTriggered: 0,
    notified: 0,
  };

  // Query is already limited at the DB level for efficiency
  const openPRs = await findOpenPRArtifacts(maxPRs);
  log.info("Found open PRs to check", {
    count: openPRs.length,
    maxPRs,
    prUrls: openPRs.slice(0, 5).map((p) => p.prUrl), // Log first 5 URLs for debugging
  });

  for (const pr of openPRs) {
    try {
      // Parse to get owner for auth
      const parsed = parsePRUrl(pr.prUrl);
      if (!parsed) {
        stats.errors++;
        continue;
      }

      // Get authenticated client
      const octokit = await getOctokitForWorkspace(pr.ownerId, parsed.owner);
      if (!octokit) {
        log.warn("Could not get Octokit client", {
          taskId: pr.taskId,
          owner: parsed.owner,
        });
        stats.errors++;
        continue;
      }

      // Check PR status
      const result = await checkPR(octokit, pr.artifactId, pr.taskId, pr.prUrl);
      if (!result) {
        stats.errors++;
        continue;
      }

      stats.checked++;

      log.info("PR check result", {
        taskId: pr.taskId,
        prNumber: result.prNumber,
        repo: `${result.owner}/${result.repo}`,
        state: result.state,
        mergeable: result.mergeable,
        ciStatus: result.ciStatus,
        ciSummary: result.ciSummary,
        prState: result.prState,
        merged: result.merged,
      });

      // Handle closed/merged PRs
      if (result.prState === "closed") {
        const newStatus = result.merged ? "DONE" : "CANCELLED";
        await updatePRArtifactProgress(
          pr.artifactId,
          {
            state: "healthy",
            lastCheckedAt: new Date().toISOString(),
          },
          newStatus,
        );

        // Update task status to DONE if PR was merged
        if (result.merged) {
          await db.task.update({
            where: { id: pr.taskId },
            data: { status: TaskStatus.DONE },
          });
          log.info("Updated task status to DONE for merged PR", {
            taskId: pr.taskId,
            prNumber: result.prNumber,
          });
        }

        stats.healthy++;
        continue;
      }

      // Build progress object
      const progress: PullRequestProgress = {
        state: result.state,
        lastCheckedAt: new Date().toISOString(),
        mergeable: result.mergeable,
        ciStatus: result.ciStatus,
        ciSummary: result.ciSummary,
        problemDetails: result.problemDetails,
        conflictFiles: result.conflictFiles,
        failedChecks: result.failedChecks,
        failedCheckLogs: result.failedCheckLogs,
      };

      // Check if state changed and requires action
      const previousState = pr.progress?.state;
      const stateChanged = previousState !== result.state;
      const needsAgentFix = result.state === "conflict" || result.state === "ci_failure";

      // Handle out_of_date: try auto-merge first (no agent needed)
      if (result.state === "out_of_date") {
        stats.outOfDate++;

        log.info("PR is out of date, attempting auto-merge", {
          taskId: pr.taskId,
          prNumber: result.prNumber,
          repo: `${result.owner}/${result.repo}`,
          headBranch: result.headBranch,
          baseBranch: result.baseBranch,
        });

        const mergeResult = await mergeBaseBranch(
          octokit,
          result.owner,
          result.repo,
          result.headBranch,
          result.baseBranch,
        );

        if (mergeResult.success) {
          stats.autoMerged++;
          log.info("Auto-merged base branch into PR", {
            taskId: pr.taskId,
            prNumber: result.prNumber,
            sha: mergeResult.sha,
          });

          // Update progress to checking (CI will run on new merge commit)
          progress.state = "checking";
          progress.problemDetails = undefined;
          await updatePRArtifactProgress(pr.artifactId, progress);
        } else {
          // Auto-merge failed (likely conflicts appeared) - update state and let next check handle it
          log.warn("Auto-merge failed", {
            taskId: pr.taskId,
            prNumber: result.prNumber,
            error: mergeResult.error,
          });
          await updatePRArtifactProgress(pr.artifactId, progress);
        }
      } else if (needsAgentFix) {
        if (result.state === "conflict") {
          stats.conflicts++;
        } else {
          stats.ciFailures++;
        }

        const currentAttempts = pr.progress?.resolution?.attempts || 0;
        const lastAttemptAt = pr.progress?.resolution?.lastAttemptAt;
        const cooldownElapsed = !lastAttemptAt || Date.now() - new Date(lastAttemptAt).getTime() > PR_FIX_COOLDOWN_MS;

        // Check if we've exceeded max attempts
        if (currentAttempts >= PR_FIX_MAX_ATTEMPTS) {
          progress.resolution = {
            status: "gave_up",
            attempts: currentAttempts,
            lastAttemptAt: lastAttemptAt,
            lastError: `Max fix attempts (${PR_FIX_MAX_ATTEMPTS}) exceeded`,
          };
          log.warn("PR fix max attempts exceeded", {
            taskId: pr.taskId,
            prNumber: result.prNumber,
            attempts: currentAttempts,
            maxAttempts: PR_FIX_MAX_ATTEMPTS,
          });
        } else if (stateChanged || !pr.progress?.resolution) {
          // Initialize/update resolution tracking for new problem
          progress.resolution = {
            status: pr.podId ? "in_progress" : "notified",
            attempts: currentAttempts + 1,
            lastAttemptAt: new Date().toISOString(),
          };
        }

        // Update artifact
        await updatePRArtifactProgress(pr.artifactId, progress);

        // Notify via Pusher and create chat message
        log.info("Notifying PR status change", {
          taskId: pr.taskId,
          prNumber: result.prNumber,
          state: result.state,
          problemDetails: result.problemDetails,
          hasPod: !!pr.podId,
        });
        await notifyPRStatusChange(pr.taskId, result.prNumber, result.state, result.problemDetails);
        stats.notified++;

        // If pod is available and this is a new problem, trigger an automatic fix
        // The triggerFix function auto-detects whether to use agent mode or live mode
        // Only trigger if: not gave_up, state changed, and cooldown elapsed
        const shouldTriggerFix =
          pr.podId && stateChanged && cooldownElapsed && progress.resolution?.status !== "gave_up";

        if (shouldTriggerFix) {
          const fixPrompt = buildFixPrompt(result);
          log.info("Triggering PR fix", {
            taskId: pr.taskId,
            podId: pr.podId,
            state: result.state,
            prNumber: result.prNumber,
            repo: `${result.owner}/${result.repo}`,
            attempt: progress.resolution?.attempts,
            maxAttempts: PR_FIX_MAX_ATTEMPTS,
          });

          const triggerResult = await triggerFix(pr.taskId, fixPrompt);
          if (triggerResult.success) {
            stats.agentTriggered++;
          }
        } else if (pr.podId && stateChanged && !cooldownElapsed) {
          log.info("Skipping PR fix due to cooldown", {
            taskId: pr.taskId,
            prNumber: result.prNumber,
            lastAttemptAt,
            cooldownMs: PR_FIX_COOLDOWN_MS,
          });
        }
      } else {
        // Track checking (CI pending) vs truly healthy
        if (result.state === "checking") {
          stats.ciPending++;
        } else {
          stats.healthy++;
        }

        // If was problematic and is now healthy, mark as resolved
        if (previousState === "conflict" || previousState === "ci_failure" || previousState === "out_of_date") {
          progress.resolution = {
            ...pr.progress?.resolution,
            status: "resolved",
            attempts: pr.progress?.resolution?.attempts || 0,
          };
          await notifyPRStatusChange(pr.taskId, result.prNumber, "healthy");
          stats.notified++;
        }

        await updatePRArtifactProgress(pr.artifactId, progress);
      }
    } catch (error) {
      log.error("Error processing PR", { taskId: pr.taskId, error: String(error) });
      stats.errors++;
    }
  }

  log.info("Monitoring run complete", stats);
  return stats;
}

/**
 * Trigger the agent to fix a PR issue in "agent" mode (server-side, no streaming)
 *
 * This function is for tasks with mode="agent":
 * 1. Saves a system message explaining the issue
 * 2. Creates/refreshes an agent session with the remote agent server
 * 3. Sends the fix prompt to the agent (fire-and-forget)
 *
 * The agent's response will be persisted via the webhook callback.
 *
 * @param taskId - The task ID (must be in "agent" mode)
 * @param prompt - The fix prompt describing the issue and resolution steps
 */
export async function triggerAgentModeFix(
  taskId: string,
  prompt: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Load task
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        agentUrl: true,
        agentPassword: true,
        agentWebhookSecret: true,
        mode: true,
        podId: true,
      },
    });

    if (!task) {
      return { success: false, error: "Task not found" };
    }

    if (task.mode !== "agent") {
      return { success: false, error: "Task is not in agent mode" };
    }

    if (!task.podId) {
      return { success: false, error: "No pod assigned to task" };
    }

    // 2. Determine agent URL
    const agentUrl = process.env.CUSTOM_GOOSE_URL || task.agentUrl;
    if (!agentUrl) {
      return { success: false, error: "Agent URL not configured" };
    }

    // 3. Decrypt agent password
    const agentPassword = task.agentPassword
      ? encryptionService.decryptField("agentPassword", task.agentPassword)
      : null;

    // 4. Handle webhook secret
    let webhookSecret: string;
    if (task.agentWebhookSecret) {
      webhookSecret = encryptionService.decryptField("agentWebhookSecret", task.agentWebhookSecret);
    } else {
      webhookSecret = generateWebhookSecret();
      const encryptedSecret = encryptionService.encryptField("agentWebhookSecret", webhookSecret);
      await db.task.update({
        where: { id: taskId },
        data: { agentWebhookSecret: JSON.stringify(encryptedSecret) },
      });
    }

    // 5. Create webhook URL
    const webhookToken = await createWebhookToken(taskId, webhookSecret);
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const webhookUrl = `${baseUrl}/api/agent/webhook?token=${webhookToken}`;

    // 6. Save system message about the fix attempt
    await db.chatMessage.create({
      data: {
        taskId,
        message: `[PR Monitor] Detected issue with pull request. Attempting automatic fix...\n\n${prompt}`,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      },
    });

    // 7. Create agent session
    const sessionUrl = agentUrl.replace(/\/$/, "") + "/session";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (agentPassword) {
      headers["Authorization"] = `Bearer ${agentPassword}`;
    }

    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: taskId,
        webhookUrl,
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      log.error("Failed to create agent session", { taskId, status: sessionResponse.status, error: errorText });
      return { success: false, error: "Failed to create agent session" };
    }

    const sessionData = await sessionResponse.json();
    const streamToken = sessionData.token;

    if (!streamToken) {
      return { success: false, error: "No stream token returned from agent" };
    }

    // 8. Send prompt to agent (fire-and-forget, don't wait for stream)
    const streamUrl = agentUrl.replace(/\/$/, "") + `/stream/${taskId}`;

    // We don't await the full stream - just initiate it
    // The agent will process and send results via webhook
    fetch(`${streamUrl}?token=${encodeURIComponent(streamToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, resume: true }),
    }).catch((error) => {
      log.error("Error initiating agent stream", { taskId, error: String(error) });
    });

    log.info("Triggered agent mode fix", { taskId });
    return { success: true };
  } catch (error) {
    log.error("Error triggering agent mode fix", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Trigger a fix for a PR issue in "live" mode via Stakwork workflow
 *
 * This function is for tasks with mode="live":
 * 1. Looks up the workspace owner for authentication
 * 2. Checks workflowStatus to avoid triggering duplicate workflows
 * 3. Sends the fix prompt to Stakwork workflow
 *
 * The response will be delivered via Stakwork webhook callback.
 *
 * @param taskId - The task ID (must be in "live" mode)
 * @param prompt - The fix prompt describing the issue and resolution steps
 */
export async function triggerLiveModeFix(
  taskId: string,
  prompt: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Load task to get workspace owner and workflow status
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        mode: true,
        workflowStatus: true,
        workspace: {
          select: {
            ownerId: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false, error: "Task not found" };
    }

    if (task.mode !== "live") {
      return { success: false, error: "Task is not in live mode" };
    }

    // 2. Check workflowStatus to avoid duplicate triggers
    // Only trigger auto-fix if no workflow is currently running
    if (task.workflowStatus !== "COMPLETED") {
      log.info("Skipping live mode fix - workflow already in progress", {
        taskId,
        workflowStatus: task.workflowStatus,
      });
      return { success: false, error: `Workflow already in progress (status: ${task.workflowStatus})` };
    }

    const userId = task.workspace.ownerId;

    // 2. Create the fix message with PR monitor context
    const message = `[PR Monitor] Detected issue with pull request. Attempting automatic fix...\n\n${prompt}`;

    // 3. Send message to Stakwork workflow
    const result = await createChatMessageAndTriggerStakwork({
      taskId,
      message,
      userId,
      generateChatTitle: false,
      mode: "live",
    });

    if (!result.stakworkData?.success) {
      log.error("Failed to trigger Stakwork workflow", {
        taskId,
        error: result.stakworkData?.error,
      });
      return { success: false, error: "Failed to trigger Stakwork workflow" };
    }

    log.info("Triggered live mode fix", { taskId, projectId: result.stakworkData.data?.project_id });
    return { success: true };
  } catch (error) {
    log.error("Error triggering live mode fix", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Trigger a fix for a PR issue based on the task's mode
 *
 * This is a convenience wrapper that automatically selects the correct
 * fix function based on the task's mode setting.
 *
 * @param taskId - The task ID
 * @param prompt - The fix prompt describing the issue and resolution steps
 */
export async function triggerFix(taskId: string, prompt: string): Promise<{ success: boolean; error?: string }> {
  // Load task to determine mode
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { mode: true },
  });

  if (!task) {
    return { success: false, error: "Task not found" };
  }

  if (task.mode === "agent") {
    return triggerAgentModeFix(taskId, prompt);
  } else if (task.mode === "live") {
    return triggerLiveModeFix(taskId, prompt);
  } else {
    return { success: false, error: `Unsupported task mode: ${task.mode}` };
  }
}
