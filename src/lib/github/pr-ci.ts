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
