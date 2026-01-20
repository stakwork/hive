/**
 * PR Monitor Service
 *
 * Monitors open pull requests for conflicts and CI failures.
 * When issues are detected, it can:
 * 1. Update the PR artifact's progress state
 * 2. Notify the user via Pusher
 * 3. Trigger the agent to fix the issue (if pod is available)
 */

import { Octokit } from "@octokit/rest";
import { db } from "@/lib/db";
import { Prisma, ChatRole, ChatStatus } from "@prisma/client";
import { getUserAppTokens } from "@/lib/githubApp";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { EncryptionService } from "@/lib/encryption";
import { createWebhookToken, generateWebhookSecret } from "@/lib/auth/agent-jwt";
import type { PullRequestProgress, PullRequestContent } from "@/lib/chat";

const LOG_PREFIX = "[PRMonitor]";
const encryptionService = EncryptionService.getInstance();

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
  base: { ref: string };
}

interface GitHubCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
}

interface GitHubCombinedStatus {
  state: "pending" | "success" | "failure" | "error";
  statuses: Array<{
    context: string;
    state: string;
    description: string | null;
  }>;
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
  prState: "open" | "closed";
  merged: boolean;
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
 * Fetch CI check status for a PR
 */
async function fetchCIStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ status: PullRequestProgress["ciStatus"]; summary: string; failedChecks: string[] }> {
  // Fetch both check runs (GitHub Actions) and commit statuses (legacy CI)
  const [checkRuns, combinedStatus] = await Promise.all([
    octokit.checks.listForRef({ owner, repo, ref }).then((r) => r.data),
    octokit.repos.getCombinedStatusForRef({ owner, repo, ref }).then((r) => r.data as GitHubCombinedStatus),
  ]);

  const failedChecks: string[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let pendingChecks = 0;

  // Process check runs (GitHub Actions)
  for (const check of checkRuns.check_runs as GitHubCheckRun[]) {
    totalChecks++;
    if (check.status !== "completed") {
      pendingChecks++;
    } else if (check.conclusion === "success" || check.conclusion === "skipped") {
      passedChecks++;
    } else if (check.conclusion === "failure" || check.conclusion === "timed_out") {
      failedChecks.push(check.name);
    }
  }

  // Process legacy commit statuses
  for (const status of combinedStatus.statuses) {
    totalChecks++;
    if (status.state === "pending") {
      pendingChecks++;
    } else if (status.state === "success") {
      passedChecks++;
    } else if (status.state === "failure" || status.state === "error") {
      failedChecks.push(status.context);
    }
  }

  // Determine overall status
  let status: PullRequestProgress["ciStatus"];
  if (totalChecks === 0) {
    status = "success"; // No checks configured
  } else if (failedChecks.length > 0) {
    status = "failure";
  } else if (pendingChecks > 0) {
    status = "pending";
  } else {
    status = "success";
  }

  const summary =
    totalChecks === 0
      ? "No checks configured"
      : `${passedChecks}/${totalChecks} passed${pendingChecks > 0 ? ` (${pendingChecks} pending)` : ""}`;

  return { status, summary, failedChecks };
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

    // Check for CI failures (conflict takes precedence)
    if (state === "healthy" && ciResult.status === "failure") {
      state = "ci_failure";
      problemDetails = `CI checks failed: ${ciResult.failedChecks.join(", ")}`;
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
      prState: prData.state,
      merged: prData.merged,
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
 * Find all open PR artifacts that need monitoring
 */
export async function findOpenPRArtifacts(): Promise<
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
  // Find all PULL_REQUEST artifacts where status is not DONE or CANCELLED
  const artifacts = await db.artifact.findMany({
    where: {
      type: "PULL_REQUEST",
      message: {
        task: {
          deleted: false,
          archived: false,
        },
      },
    },
    select: {
      id: true,
      content: true,
      message: {
        select: {
          taskId: true,
          task: {
            select: {
              id: true,
              podId: true,
              workspaceId: true,
              workspace: {
                select: {
                  ownerId: true,
                  sourceControlOrg: {
                    select: {
                      githubLogin: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const openPRs: Array<{
    artifactId: string;
    taskId: string;
    prUrl: string;
    workspaceId: string;
    ownerId: string;
    podId: string | null;
    progress: PullRequestProgress | undefined;
  }> = [];

  for (const artifact of artifacts) {
    const content = artifact.content as PullRequestContent | null;
    if (!content?.url) continue;

    // Skip if already merged or closed
    if (content.status === "DONE" || content.status === "CANCELLED") continue;

    // Skip if resolution is in progress or gave up
    if (content.progress?.resolution?.status === "in_progress" || content.progress?.resolution?.status === "gave_up") {
      continue;
    }

    const task = artifact.message?.task;
    if (!task) continue;

    openPRs.push({
      artifactId: artifact.id,
      taskId: task.id,
      prUrl: content.url,
      workspaceId: task.workspaceId,
      ownerId: task.workspace.ownerId,
      podId: task.podId,
      progress: content.progress,
    });
  }

  return openPRs;
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
    return `The pull request #${result.prNumber} in ${result.owner}/${result.repo} has merge conflicts.

Please:
1. Fetch the latest changes from the base branch (${result.problemDetails?.includes("with") ? result.problemDetails.split("with ")[1] : "main"})
2. Resolve any merge conflicts
3. Push the resolved changes

${result.problemDetails || ""}`;
  }

  if (result.state === "ci_failure") {
    return `The pull request #${result.prNumber} in ${result.owner}/${result.repo} has failing CI checks.

Failed checks: ${result.failedChecks?.join(", ") || "unknown"}

Please:
1. Review the CI failure logs
2. Fix the issues causing the failures
3. Push the fixes

${result.problemDetails || ""}`;
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
  healthy: number;
  errors: number;
  agentTriggered: number;
  notified: number;
}> {
  const stats = {
    checked: 0,
    conflicts: 0,
    ciFailures: 0,
    healthy: 0,
    errors: 0,
    agentTriggered: 0,
    notified: 0,
  };

  const openPRs = await findOpenPRArtifacts();
  log.info("Found open PRs to check", {
    count: openPRs.length,
    prUrls: openPRs.slice(0, 5).map((p) => p.prUrl), // Log first 5 URLs for debugging
  });

  // Limit to maxPRs
  const prsToCheck = openPRs.slice(0, maxPRs);

  for (const pr of prsToCheck) {
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
      };

      // Check if state changed and requires action
      const previousState = pr.progress?.state;
      const stateChanged = previousState !== result.state;
      const isProblematic = result.state === "conflict" || result.state === "ci_failure";

      if (isProblematic) {
        if (result.state === "conflict") {
          stats.conflicts++;
        } else {
          stats.ciFailures++;
        }

        // Initialize resolution tracking if this is a new problem
        if (stateChanged || !pr.progress?.resolution) {
          progress.resolution = {
            status: pr.podId ? "in_progress" : "notified",
            attempts: (pr.progress?.resolution?.attempts || 0) + 1,
            lastAttemptAt: new Date().toISOString(),
          };
        }

        // Update artifact
        await updatePRArtifactProgress(pr.artifactId, progress);

        // Notify via Pusher
        log.info("Notifying PR status change via Pusher", {
          taskId: pr.taskId,
          prNumber: result.prNumber,
          state: result.state,
          problemDetails: result.problemDetails,
          hasPod: !!pr.podId,
        });
        await notifyPRStatusChange(pr.taskId, result.prNumber, result.state, result.problemDetails);
        stats.notified++;

        // If pod is available and this is a new problem, would trigger the agent
        // TODO: Uncomment when ready to enable auto-fix
        if (pr.podId && stateChanged) {
          const fixPrompt = buildFixPrompt(result);
          log.info("WOULD TRIGGER AGENT (disabled)", {
            taskId: pr.taskId,
            podId: pr.podId,
            state: result.state,
            prNumber: result.prNumber,
            repo: `${result.owner}/${result.repo}`,
            prompt: fixPrompt.substring(0, 200) + "...",
          });
          // Uncomment below to enable agent auto-fix:
          // const triggerResult = await triggerAgentFix(pr.taskId, fixPrompt);
          // if (triggerResult.success) {
          //   stats.agentTriggered++;
          // }
        }
      } else {
        stats.healthy++;

        // If was problematic and is now healthy, mark as resolved
        if (previousState === "conflict" || previousState === "ci_failure") {
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
 * Trigger the agent to fix a PR issue (server-side, no streaming)
 *
 * This function:
 * 1. Saves a system message explaining the issue
 * 2. Creates/refreshes an agent session
 * 3. Sends the fix prompt to the agent (fire-and-forget)
 *
 * The agent's response will be persisted via the webhook callback.
 */
export async function triggerAgentFix(taskId: string, prompt: string): Promise<{ success: boolean; error?: string }> {
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

    log.info("Triggered agent fix", { taskId });
    return { success: true };
  } catch (error) {
    log.error("Error triggering agent fix", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}
