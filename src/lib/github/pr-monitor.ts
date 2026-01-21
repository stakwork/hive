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
import { Prisma, ChatRole, ChatStatus } from "@prisma/client";
import { getUserAppTokens } from "@/lib/githubApp";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { EncryptionService } from "@/lib/encryption";
import { createWebhookToken, generateWebhookSecret } from "@/lib/auth/agent-jwt";
import { createChatMessageAndTriggerStakwork } from "@/services/task-workflow";
import type { PullRequestProgress, PullRequestContent } from "@/lib/chat";

const LOG_PREFIX = "[PRMonitor]";
const encryptionService = EncryptionService.getInstance();

// Retry limits to prevent infinite loops
const PR_FIX_MAX_ATTEMPTS = parseInt(process.env.PR_FIX_MAX_ATTEMPTS || "3", 10);
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
  base: { ref: string };
}

interface GitHubCheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
}

interface GitHubJobStep {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  number: number;
}

interface GitHubJobDetails {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  steps: GitHubJobStep[];
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
  failedCheckLogs?: Record<string, string>;
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
 * Fetch job details including steps from GitHub API
 */
async function fetchJobDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  jobId: number,
): Promise<GitHubJobDetails | null> {
  try {
    const { data } = await octokit.actions.getJobForWorkflowRun({
      owner,
      repo,
      job_id: jobId,
    });
    return data as unknown as GitHubJobDetails;
  } catch (error) {
    log.warn("Failed to fetch job details", { owner, repo, jobId, error: String(error) });
    return null;
  }
}

/**
 * Extract logs for a specific step from the full job logs.
 *
 * GitHub Actions logs have step markers in the format:
 * "2024-01-15T10:30:00.0000000Z ##[group]Step Name"
 * Each step section ends when the next step begins or at EOF.
 */
function extractStepLogs(fullLogs: string, stepNumber: number, stepName: string): string | null {
  const lines = fullLogs.split("\n");

  // GitHub Actions log format: each line starts with timestamp, step markers use ##[group]
  // Steps are numbered, and we can identify them by the pattern or by step name
  // Format: "TIMESTAMP ##[group]STEP_NAME" starts a step
  // Format: "TIMESTAMP ##[endgroup]" ends a step section

  let inTargetStep = false;
  let stepLines: string[] = [];
  let foundStep = false;

  // Pattern to match step group markers - the step name follows ##[group]
  const groupPattern = /##\[group\]/;
  const endGroupPattern = /##\[endgroup\]/;

  for (const line of lines) {
    if (groupPattern.test(line)) {
      // Check if this is our target step by name (more reliable than number)
      const isTargetStep = line.includes(stepName) || line.includes(`Step ${stepNumber}`);

      if (inTargetStep) {
        // We were in the target step and hit a new step, we're done
        break;
      }

      if (isTargetStep) {
        inTargetStep = true;
        foundStep = true;
        stepLines.push(line);
      }
    } else if (endGroupPattern.test(line) && inTargetStep) {
      // End of the target step's group section, but continue collecting
      // as there may be more output after the group ends
      stepLines.push(line);
    } else if (inTargetStep) {
      stepLines.push(line);
    }
  }

  // If we didn't find the step by name matching, fall back to extracting
  // the last portion of logs which usually contains the error
  if (!foundStep) {
    // Fallback: search for error patterns and extract surrounding context
    const errorPatterns = [/error:/i, /failed:/i, /Error:/i, /FAILED/i, /exception/i, /##\[error\]/];
    const errorLineIndices: number[] = [];

    lines.forEach((line, idx) => {
      if (errorPatterns.some((pattern) => pattern.test(line))) {
        errorLineIndices.push(idx);
      }
    });

    if (errorLineIndices.length > 0) {
      // Get context around the first error (20 lines before, 30 lines after)
      const firstErrorIdx = errorLineIndices[0];
      const startIdx = Math.max(0, firstErrorIdx - 20);
      const endIdx = Math.min(lines.length, firstErrorIdx + 30);
      stepLines = lines.slice(startIdx, endIdx);
      if (startIdx > 0) {
        stepLines.unshift("...(earlier output truncated)");
      }
    }
  }

  if (stepLines.length === 0) {
    return null;
  }

  return stepLines.join("\n");
}

/**
 * Fetch logs for failed steps in a GitHub Actions job.
 *
 * This function:
 * 1. Fetches job details to identify which steps failed
 * 2. Downloads the full job logs
 * 3. Extracts only the logs for failed steps
 */
async function fetchFailedStepLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  jobId: number,
): Promise<{ failedSteps: string[]; logs: string } | null> {
  try {
    // 1. Fetch job details to get step information
    const jobDetails = await fetchJobDetails(octokit, owner, repo, jobId);
    if (!jobDetails) {
      return null;
    }

    // 2. Find failed steps
    const failedSteps = jobDetails.steps.filter(
      (step) => step.conclusion === "failure" || step.conclusion === "timed_out",
    );

    if (failedSteps.length === 0) {
      log.info("No failed steps found in job", { jobId, jobName: jobDetails.name });
      return null;
    }

    // 3. Download full job logs
    const response = await octokit.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobId,
    });

    const fullLogs = response.data as unknown as string;
    if (!fullLogs || typeof fullLogs !== "string") {
      return null;
    }

    // 4. Extract logs for each failed step
    const stepLogSections: string[] = [];
    for (const step of failedSteps) {
      const stepLogs = extractStepLogs(fullLogs, step.number, step.name);
      if (stepLogs) {
        stepLogSections.push(`### Failed Step: ${step.name}\n${stepLogs}`);
      }
    }

    // If we couldn't extract specific step logs, fall back to last N lines
    let combinedLogs: string;
    if (stepLogSections.length === 0) {
      const lines = fullLogs.split("\n");
      combinedLogs = lines.slice(-100).join("\n");
      log.info("Falling back to last 100 lines of logs", { jobId });
    } else {
      combinedLogs = stepLogSections.join("\n\n");
    }

    // Truncate if too long (max 15KB per job to avoid bloating the DB)
    const maxLogSize = 15360;
    if (combinedLogs.length > maxLogSize) {
      combinedLogs = "...(truncated)\n" + combinedLogs.slice(-maxLogSize);
    }

    return {
      failedSteps: failedSteps.map((s) => s.name),
      logs: combinedLogs,
    };
  } catch (error) {
    log.warn("Failed to fetch job logs", { owner, repo, jobId, error: String(error) });
    return null;
  }
}

/**
 * Fetch CI check status for a PR
 */
async function fetchCIStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<{
  status: PullRequestProgress["ciStatus"];
  summary: string;
  failedChecks: string[];
  failedCheckLogs: Record<string, string>;
}> {
  // Fetch both check runs (GitHub Actions) and commit statuses (legacy CI)
  const [checkRuns, combinedStatus] = await Promise.all([
    octokit.checks.listForRef({ owner, repo, ref }).then((r) => r.data),
    octokit.repos.getCombinedStatusForRef({ owner, repo, ref }).then((r) => r.data as GitHubCombinedStatus),
  ]);

  const failedChecks: string[] = [];
  const failedCheckIds: Array<{ name: string; id: number }> = [];
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
      failedCheckIds.push({ name: check.name, id: check.id });
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
      // Legacy statuses don't have downloadable logs
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

  // Limit failedChecks to first 10 to avoid storing too much data
  const limitedFailedChecks = failedChecks.slice(0, 10);
  if (failedChecks.length > 10) {
    limitedFailedChecks.push(`... and ${failedChecks.length - 10} more`);
  }

  // Fetch logs for failed checks (limit to first 3 to avoid rate limits and slow responses)
  const failedCheckLogs: Record<string, string> = {};
  const checksToFetchLogs = failedCheckIds.slice(0, 3);

  await Promise.all(
    checksToFetchLogs.map(async ({ name, id }) => {
      const result = await fetchFailedStepLogs(octokit, owner, repo, id);
      if (result?.logs) {
        // Include failed step names in the log header for context
        const stepInfo = result.failedSteps.length > 0 ? `Failed steps: ${result.failedSteps.join(", ")}\n\n` : "";
        failedCheckLogs[name] = stepInfo + result.logs;
      }
    }),
  );

  return { status, summary, failedChecks: limitedFailedChecks, failedCheckLogs };
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
      failedCheckLogs: Object.keys(ciResult.failedCheckLogs).length > 0 ? ciResult.failedCheckLogs : undefined,
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
      -- Cooldown logic for healthy PRs (only re-check after 1 hour)
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
    return `The pull request #${result.prNumber} in ${result.owner}/${result.repo} has merge conflicts.

Please:
1. Fetch the latest changes from the base branch (${result.problemDetails?.includes("with") ? result.problemDetails.split("with ")[1] : "main"})
2. Resolve any merge conflicts
3. Push the resolved changes

${result.problemDetails || ""}`;
  }

  if (result.state === "ci_failure") {
    let prompt = `The pull request #${result.prNumber} in ${result.owner}/${result.repo} has failing CI checks.

Failed checks: ${result.failedChecks?.join(", ") || "unknown"}

Please:
1. Review the CI failure logs below
2. Fix the issues causing the failures
3. Push the fixes

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
      const isProblematic = result.state === "conflict" || result.state === "ci_failure";

      if (isProblematic) {
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
 * 2. Sends the fix prompt to Stakwork workflow
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
    // 1. Load task to get workspace owner
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        mode: true,
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
