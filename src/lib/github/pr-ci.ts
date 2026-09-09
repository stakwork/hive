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
 * Check if a line contains an error marker.
 * GitHub Actions runner uses ##[error] internally, but workflow commands use ::error::
 * We support both formats for robustness.
 */
function isErrorLine(line: string): boolean {
  return line.includes("##[error]") || /::error\b/.test(line);
}

/**
 * Check if a line contains a group marker.
 * GitHub Actions runner uses ##[group] internally, but workflow commands use ::group::
 * We support both formats for robustness.
 */
function isGroupLine(line: string): boolean {
  return line.includes("##[group]") || line.includes("::group::");
}

/**
 * Strip a leading GitHub Actions timestamp prefix (e.g.
 * "2024-01-15T10:30:00.0000000Z ...") from a log line, if present.
 *
 * All the classifiers below match against the line *after* this strip, since
 * anchoring patterns at column 0 of the raw line would otherwise never match
 * (every real GHA log line starts with a timestamp).
 */
export function stripGhaTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s/, "");
}

/**
 * "Process completed with exit code N" — the generic runner line GitHub Actions
 * always appends when a step's process exits non-zero, with or without a
 * ##[error]/::error:: wrapper. It carries no information about *why* the
 * command failed, so it should never be the primary excerpt anchor when a
 * stronger (stdout) failure line exists in the same section.
 *
 * Note the overlap with `isErrorLine`: a wrapped weak-exit line (e.g.
 * "##[error]Process completed with exit code 1") is still an error for the
 * purposes of "did this step fail", but it is not a *strong* failure line.
 */
export function isWeakRunnerExitLine(line: string): boolean {
  const stripped = stripGhaTimestamp(line);
  return /Process completed with exit code \d+/.test(stripped);
}

/**
 * Generic (tool-agnostic) stdout failure diagnostics — not a per-tool
 * allowlist. Matches the shapes that real linter/test stdout takes across
 * eslint (stylish), flake8 (with --show-source), pytest, and black --check,
 * without hardcoding any single tool's invocation.
 *
 * Deliberately does NOT match: start-anchored "E " (pytest traceback lines),
 * bare "ERROR", black's "Oh no!", "warning"/"warnings", or runner
 * ##[error]/::error:: annotations (those are handled by `isErrorLine`).
 */
export function isStdoutFailureLine(line: string): boolean {
  const stripped = stripGhaTimestamp(line);

  // File diagnostics: "path:line:" or "path:line:col:" followed by whitespace
  // (flake8 --show-source, tsc, etc.)
  if (/\S+:\d+:(?:\d+:)?\s/.test(stripped)) {
    return true;
  }

  // Whitespace-bounded severity token "error" (eslint stylish rows), not
  // "warning"/"warnings". Case-sensitive so bare "ERROR" doesn't match.
  if (/(?:^|\s)error(?:\s|$)/.test(stripped)) {
    return true;
  }

  // pytest failure marker
  if (/\bFAILED\b/.test(stripped)) {
    return true;
  }

  // black --check
  if (/would reformat/.test(stripped)) {
    return true;
  }

  return false;
}

/**
 * A failure line strong enough to anchor excerpt extraction on: either real
 * stdout diagnostics, or a runner error annotation that isn't just the weak
 * "Process completed with exit code N" line.
 */
export function isStrongFailureLine(line: string): boolean {
  return isStdoutFailureLine(line) || (isErrorLine(line) && !isWeakRunnerExitLine(line));
}

/**
 * True when every non-empty shell segment of a `Run <command>` group header
 * contains `--exit-zero`, meaning the command cannot actually fail the step
 * (e.g. `flake8 . --exit-zero`). Segments are split on `&&`, `||`, `;`, and
 * newlines — not on `|` inside a pipeline. A compound command where only some
 * segments are `--exit-zero` (e.g. `flake8 . --exit-zero && pytest`) is NOT
 * non-failing, since a later segment can still fail the step.
 */
export function isNonFailingRunCommand(command: string): boolean {
  const stripped = command.replace(/^Run\s+/, "");
  const segments = stripped
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return false;
  }

  return segments.every((s) => s.includes("--exit-zero"));
}

/**
 * Parse the command from a `##[group]Run <command>` / `::group::Run <command>`
 * header line, if this group is a `run:` step. Returns null for `uses:` step
 * group headers (which are just the step/action name, not a command).
 */
function parseGroupRunCommand(headerLine: string): string | null {
  const stripped = stripGhaTimestamp(headerLine);
  const match = stripped.match(/(?:##\[group\]|::group::)Run (.+)$/);
  return match ? match[1].trim() : null;
}

/**
 * Extract logs for a specific step from the full job logs.
 *
 * GitHub Actions log format:
 * - Lines start with timestamps: "2024-01-15T10:30:00.0000000Z ..."
 *   (stripped by `stripGhaTimestamp` before any classifier runs)
 * - Step sections marked by: "##[group]Run <command>" (note: contains COMMAND, not step NAME)
 *   (or "::group::" in some cases)
 * - Errors marked by: "##[error]<message>" (or "::error::" in some cases)
 *
 * Strategy:
 * 1. Find step section using group markers (step name won't match, use command patterns)
 * 2. Among candidate sections, prefer the one containing a *strong* failure line
 *    (real stdout diagnostics, not just the weak "Process completed with exit
 *    code N" line) — and skip sections whose `run:` command is a non-failing
 *    `--exit-zero` invocation, since those commonly dump warnings before the
 *    actual failing step runs.
 * 3. Extract N lines around the first strong failure line (error details
 *    appear before it); fall back to the weak exit line only if nothing
 *    stronger exists in the section.
 */
export function extractStepLogs(fullLogs: string, stepNumber: number, stepName: string): string | null {
  const lines = fullLogs.split("\n");
  const MAX_LINES = 150;

  // Step 1: Find all group markers (##[group] or ::group::)
  const groupMarkers: { lineNum: number; content: string }[] = [];
  lines.forEach((line, idx) => {
    if (isGroupLine(line)) {
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

  // Fallback: walk groups looking for the failing `run:` section.
  // This is more reliable than "last Run before Post" which can pick cleanup
  // steps that run after the failure (e.g., "Stop Containers" with `if: always()`).
  if (targetIdx < 0) {
    let lastStrongIdx = -1;
    let firstWeakIdx = -1;

    for (let i = 0; i < groupMarkers.length; i++) {
      const sectionStart = groupMarkers[i].lineNum;
      const sectionEnd = groupMarkers[i + 1]?.lineNum ?? lines.length;

      // Skip "Post" and "Complete" cleanup sections
      if (groupMarkers[i].content.includes("Post ") || groupMarkers[i].content.includes("Complete ")) {
        continue;
      }

      // Skip non-failing `--exit-zero` groups — they commonly dump warnings
      // before (or instead of) the actual failing `run:` step.
      const runCommand = parseGroupRunCommand(groupMarkers[i].content);
      if (runCommand && isNonFailingRunCommand(runCommand)) {
        continue;
      }

      let hasStrong = false;
      let hasError = false;
      for (let j = sectionStart; j < sectionEnd; j++) {
        if (isStrongFailureLine(lines[j])) hasStrong = true;
        if (isErrorLine(lines[j])) hasError = true;
      }

      if (hasStrong) {
        // Take the LAST strong section before Post — warning dumps typically
        // precede the actual failing `run:` step.
        lastStrongIdx = i;
      }
      if (hasError && firstWeakIdx < 0) {
        // Preserve today's "first section with any error marker" behavior as
        // a fallback for when no section has a strong failure line.
        firstWeakIdx = i;
      }
    }

    const chosenIdx = lastStrongIdx >= 0 ? lastStrongIdx : firstWeakIdx;
    if (chosenIdx >= 0) {
      targetIdx = chosenIdx;
      stepStartLine = groupMarkers[chosenIdx].lineNum;
      stepEndLine = groupMarkers[chosenIdx + 1]?.lineNum ?? lines.length;
    }
  }

  // Step 3: Find failure markers within the chosen section (or globally)
  const searchStart = stepStartLine >= 0 ? stepStartLine : 0;
  const searchEnd = stepStartLine >= 0 ? stepEndLine : lines.length;

  const strongMarkers: number[] = [];
  const errorMarkers: number[] = [];
  for (let i = searchStart; i < searchEnd; i++) {
    if (isStrongFailureLine(lines[i])) strongMarkers.push(i);
    if (isErrorLine(lines[i])) errorMarkers.push(i);
  }

  // Anchor on the first strong failure line; only fall back to a weak exit
  // line ("Process completed with exit code N") when nothing stronger exists.
  const anchorMarkers = strongMarkers.length > 0 ? strongMarkers : errorMarkers;

  // Step 4: Extract logs
  if (anchorMarkers.length > 0) {
    const firstAnchorLine = anchorMarkers[0];
    const lastAnchorLine = anchorMarkers[anchorMarkers.length - 1];

    const extractStart = Math.max(stepStartLine >= 0 ? stepStartLine : 0, firstAnchorLine - MAX_LINES);
    const extractEnd = Math.min(lines.length, lastAnchorLine + 5);

    let extracted = lines.slice(extractStart, extractEnd);

    // If the window trimmed off the group header line, prepend it so
    // `Run <command>` survives for `inferFailedCommand`.
    if (stepStartLine >= 0 && extractStart > stepStartLine) {
      extracted = [lines[stepStartLine], ...extracted];
    }

    return extracted.join("\n");
  }

  // No error markers found - take last MAX_LINES of step (or entire log as last resort)
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

const COMMAND_LIKE_PREFIXES = [
  "npm",
  "yarn",
  "pnpm",
  "npx",
  "pytest",
  "flake8",
  "eslint",
  "black",
  "ruff",
  "cargo",
  "go",
  "python",
  "make",
];

function looksLikeShellCommand(name: string): boolean {
  const trimmed = name.trim();
  if (COMMAND_LIKE_PREFIXES.some((p) => trimmed === p || trimmed.startsWith(`${p} `))) {
    return true;
  }
  return / run /.test(trimmed);
}

/**
 * Infer the shell command that actually failed for a check, from that check's
 * `failedCheckLogs` blob (as produced by `fetchFailedStepLogs`/`fetchCIStatus`).
 *
 * Priority:
 * 1. Every `##[group]Run ...` / `::group::Run ...` header found in the logs
 *    (deduped) — these are the only source that is safe to hand back to an
 *    agent to literally re-execute.
 * 2. Else, if the check name itself looks like a shell invocation (e.g.
 *    "npm run lint", "flake8"), use that.
 * 3. Else null — the caller should fall back to "identify the command from
 *    the logs" instructions instead of guessing.
 *
 * Does NOT treat `### Failed Step: ...` markers or `uses:` step group titles
 * (e.g. "##[group]Build Docker image") as commands.
 */
export function inferFailedCommand(checkName: string, logs: string): string[] | null {
  const commands: string[] = [];
  const seen = new Set<string>();

  for (const line of logs.split("\n")) {
    const stripped = stripGhaTimestamp(line);
    const match = stripped.match(/(?:##\[group\]|::group::)Run (.+)$/);
    if (match) {
      const cmd = match[1].trim();
      if (cmd && !seen.has(cmd)) {
        seen.add(cmd);
        commands.push(cmd);
      }
    }
  }

  if (commands.length > 0) {
    return commands;
  }

  if (looksLikeShellCommand(checkName)) {
    return [checkName.trim()];
  }

  return null;
}

/**
 * Truncate combined failed-step log sections to `maxLogSize` while preserving
 * every `### Failed Step:` header and any `Run `/`::group::` header that
 * follows it, so `inferFailedCommand` (and the fix-prompt fallback) can still
 * identify the failing command/step after truncation. A pure tail slice can
 * otherwise drop those headers entirely, leaving only a trailing
 * "Process completed with exit code 1" line.
 *
 * Layout: [all headers] + "...(truncated)" + [tail of section bodies], capped
 * to `maxLogSize`.
 */
export function truncateFailedStepLogs(stepLogSections: string[], maxLogSize: number): string {
  const TRUNCATED_MARKER = "...(truncated)";

  const sectionParts = stepLogSections.map((section) => {
    const lines = section.split("\n");
    const headerLines: string[] = [];
    const bodyLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("### Failed Step:") || isGroupLine(stripGhaTimestamp(line))) {
        headerLines.push(line);
      } else {
        bodyLines.push(line);
      }
    }
    return { headerLines, body: bodyLines.join("\n") };
  });

  const headerBlock = sectionParts
    .map((s) => s.headerLines.join("\n"))
    .filter((h) => h.length > 0)
    .join("\n\n");
  const prefix = headerBlock ? `${headerBlock}\n${TRUNCATED_MARKER}\n` : `${TRUNCATED_MARKER}\n`;

  const remainingBudget = Math.max(0, maxLogSize - prefix.length);
  const combinedBody = sectionParts.map((s) => s.body).join("\n\n");
  const bodyTail = combinedBody.length > remainingBudget ? combinedBody.slice(-remainingBudget) : combinedBody;

  return (prefix + bodyTail).slice(0, maxLogSize);
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

    // Truncate if too long (max 15KB per job to avoid bloating the DB).
    // Header-preserving when we have step sections to preserve headers from —
    // a pure tail slice can drop the `### Failed Step:`/`Run` headers that
    // `inferFailedCommand` needs.
    const maxLogSize = 15360;
    if (combinedLogs.length > maxLogSize) {
      combinedLogs =
        stepLogSections.length > 0
          ? truncateFailedStepLogs(stepLogSections, maxLogSize)
          : "...(truncated)\n" + combinedLogs.slice(-maxLogSize);
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
