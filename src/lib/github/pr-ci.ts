import { Octokit } from "@octokit/rest";
import type { PullRequestProgress } from "@/lib/chat";

const LOG_PREFIX = "[PRMonitorCI]";

// Simple console logging helpers
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`${LOG_PREFIX} ${msg}`, data ? JSON.stringify(data) : ""),
};

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
 * GitHub Actions log format:
 * - Lines start with timestamps: "2024-01-15T10:30:00.0000000Z ..."
 * - Step sections marked by: "##[group]Run <command>" (note: contains COMMAND, not step NAME)
 * - Errors marked by: "##[error]<message>"
 *
 * Strategy:
 * 1. Find step section using ##[group] markers (step name won't match, use command patterns)
 * 2. Find ##[error] markers within section (GitHub adds these for any failure)
 * 3. Extract N lines before ##[error] (error details appear before the marker)
 */
function extractStepLogs(fullLogs: string, stepNumber: number, stepName: string): string | null {
  const lines = fullLogs.split("\n");
  const MAX_LINES = 150;

  // Step 1: Find all ##[group] markers
  const groupMarkers: { lineNum: number; content: string }[] = [];
  lines.forEach((line, idx) => {
    if (line.includes("##[group]")) {
      groupMarkers.push({ lineNum: idx, content: line });
    }
  });

  // Step 2: Find the target step's section
  let stepStartLine = -1;
  let stepEndLine = lines.length;

  // Try direct name match first (rarely works - step name != command in logs)
  let targetIdx = groupMarkers.findIndex(
    (m) => m.content.includes(stepName) || m.content.includes(`Step ${stepNumber}`),
  );

  if (targetIdx >= 0) {
    stepStartLine = groupMarkers[targetIdx].lineNum;
    stepEndLine = groupMarkers[targetIdx + 1]?.lineNum ?? lines.length;
  }

  // Fallback: Find "Run" markers and use the last one before "Post" steps
  // (Failed step is usually the last actual step before cleanup)
  if (targetIdx < 0 && stepName.startsWith("Run ")) {
    const postIdx = groupMarkers.findIndex((m) => m.content.includes("Post "));
    const searchMarkers = postIdx >= 0 ? groupMarkers.slice(0, postIdx) : groupMarkers;
    const runMarkers = searchMarkers.filter((m) => /##\[group\]Run\s/.test(m.content));

    if (runMarkers.length > 0) {
      const lastRunMarker = runMarkers[runMarkers.length - 1];
      targetIdx = groupMarkers.findIndex((m) => m.lineNum === lastRunMarker.lineNum);
      stepStartLine = lastRunMarker.lineNum;
      stepEndLine = groupMarkers[targetIdx + 1]?.lineNum ?? lines.length;
    }
  }

  // Step 3: Find ##[error] markers (within step section or globally)
  const errorMarkers: { lineNum: number }[] = [];
  const searchStart = stepStartLine >= 0 ? stepStartLine : 0;
  const searchEnd = stepStartLine >= 0 ? stepEndLine : lines.length;

  for (let i = searchStart; i < searchEnd; i++) {
    if (lines[i].includes("##[error]")) {
      errorMarkers.push({ lineNum: i });
    }
  }

  // Step 4: Extract logs
  if (errorMarkers.length > 0) {
    // Take MAX_LINES before first ##[error], through last ##[error] + 5
    const firstErrorLine = errorMarkers[0].lineNum;
    const lastErrorLine = errorMarkers[errorMarkers.length - 1].lineNum;

    const extractStart = Math.max(stepStartLine >= 0 ? stepStartLine : 0, firstErrorLine - MAX_LINES);
    const extractEnd = Math.min(lines.length, lastErrorLine + 5);

    return lines.slice(extractStart, extractEnd).join("\n");
  }

  // No ##[error] found - take last MAX_LINES of step (or entire log as last resort)
  if (stepStartLine >= 0) {
    const stepLines = lines.slice(stepStartLine, stepEndLine);
    if (stepLines.length > MAX_LINES) {
      return "...(truncated)\n" + stepLines.slice(-MAX_LINES).join("\n");
    }
    return stepLines.join("\n");
  }

  // Last resort: end of entire log
  log.warn("Could not find step section, using end of log", { stepName, stepNumber });
  return "...(truncated)\n" + lines.slice(-MAX_LINES).join("\n");
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
export async function fetchCIStatus(
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
  let skippedChecks = 0;
  let failedChecksCount = 0;
  let pendingChecks = 0;

  // Process check runs (GitHub Actions)
  for (const check of checkRuns.check_runs as GitHubCheckRun[]) {
    totalChecks++;
    if (check.status !== "completed") {
      pendingChecks++;
    } else if (check.conclusion === "success") {
      passedChecks++;
    } else if (check.conclusion === "skipped") {
      skippedChecks++;
    } else if (check.conclusion === "failure" || check.conclusion === "timed_out") {
      failedChecksCount++;
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
      failedChecksCount++;
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

  // Build summary with passed/total and additional details
  // Note: Failed checks are displayed separately, so we only show skipped and pending here
  let summary = "";
  if (totalChecks === 0) {
    summary = "No checks configured";
  } else {
    summary = `${passedChecks}/${totalChecks} passed`;
    const details: string[] = [];
    if (skippedChecks > 0) details.push(`${skippedChecks} skipped`);
    if (pendingChecks > 0) details.push(`${pendingChecks} pending`);
    if (details.length > 0) {
      summary += ` (${details.join(", ")})`;
    }
  }

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
