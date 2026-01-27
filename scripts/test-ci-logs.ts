/**
 * Test script for CI log extraction
 *
 * Usage:
 *   npx tsx scripts/test-ci-logs.ts <owner> <repo> <run_id>
 *
 * Example:
 *   npx tsx scripts/test-ci-logs.ts stakwork hive 21403376378
 *
 * Requires GITHUB_TOKEN environment variable (or uses .env.local)
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN environment variable is required");
  console.error("Set it in .env.local or export it directly");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

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

/**
 * NEW IMPLEMENTATION: Extract logs for a failed step
 *
 * Strategy (in order of reliability):
 *
 * 1. FIND STEP SECTION: Locate the step's log section using ##[group] markers
 *    - GitHub uses ##[group]Run <command> for steps with `run:` in YAML
 *    - The step NAME from YAML is NOT in the logs, only the COMMAND is
 *
 * 2. FIND ERRORS: Look for ##[error] markers within the step section
 *    - GitHub Actions adds ##[error] for any failure
 *    - Always includes "##[error]Process completed with exit code N"
 *
 * 3. EXTRACT CONTEXT: Take N lines before the ##[error] marker
 *    - Error details (stack traces, diffs, etc.) appear BEFORE ##[error]
 *    - This is generic - works for any CI tool output
 */
function extractStepLogs(
  fullLogs: string,
  stepNumber: number,
  stepName: string,
): { logs: string | null; method: string; debug: string[] } {
  const lines = fullLogs.split("\n");
  const debug: string[] = [];

  // ============================================================
  // STEP 1: Find all ##[group] markers to understand log structure
  // ============================================================
  const groupMarkers: { lineNum: number; content: string }[] = [];
  lines.forEach((line, idx) => {
    if (line.includes("##[group]")) {
      groupMarkers.push({ lineNum: idx, content: line });
    }
  });

  debug.push(`STEP 1: Found ${groupMarkers.length} ##[group] markers`);

  // ============================================================
  // STEP 2: Try to find the target step's section
  // ============================================================

  let stepStartLine = -1;
  let stepEndLine = lines.length;
  let matchMethod = "";

  // Method A: Direct name match (rarely works - step name != command)
  let targetIdx = groupMarkers.findIndex(
    (m) => m.content.includes(stepName) || m.content.includes(`Step ${stepNumber}`),
  );

  if (targetIdx >= 0) {
    matchMethod = "A: Direct step name match";
    stepStartLine = groupMarkers[targetIdx].lineNum;
    stepEndLine = groupMarkers[targetIdx + 1]?.lineNum ?? lines.length;
    debug.push(`STEP 2 (Method A): Found step by name at line ${stepStartLine}`);
  }

  // Method B: Find "Run" markers and use the last one before "Post" steps
  // (Failed step is usually the last actual step before cleanup)
  if (targetIdx < 0 && stepName.startsWith("Run ")) {
    const postIdx = groupMarkers.findIndex((m) => m.content.includes("Post "));
    const searchMarkers = postIdx >= 0 ? groupMarkers.slice(0, postIdx) : groupMarkers;
    const runMarkers = searchMarkers.filter((m) => /##\[group\]Run\s/.test(m.content));

    debug.push(`STEP 2 (Method B): Found ${runMarkers.length} "Run" markers before "Post" steps`);

    if (runMarkers.length > 0) {
      const lastRunMarker = runMarkers[runMarkers.length - 1];
      targetIdx = groupMarkers.findIndex((m) => m.lineNum === lastRunMarker.lineNum);
      matchMethod = "B: Last 'Run' marker before 'Post' steps";
      stepStartLine = lastRunMarker.lineNum;
      stepEndLine = groupMarkers[targetIdx + 1]?.lineNum ?? lines.length;
      debug.push(`  -> Using marker at line ${stepStartLine}: ${lastRunMarker.content.slice(30, 100)}`);
    }
  }

  // ============================================================
  // STEP 3: Find ##[error] markers (either within step or globally)
  // ============================================================

  let errorMarkers: { lineNum: number; content: string }[] = [];

  if (stepStartLine >= 0) {
    // Search within the step's section
    for (let i = stepStartLine; i < stepEndLine; i++) {
      if (lines[i].includes("##[error]")) {
        errorMarkers.push({ lineNum: i, content: lines[i] });
      }
    }
    debug.push(
      `STEP 3: Found ${errorMarkers.length} ##[error] markers within step section (lines ${stepStartLine}-${stepEndLine})`,
    );
  } else {
    // Fallback: search entire log
    lines.forEach((line, idx) => {
      if (line.includes("##[error]")) {
        errorMarkers.push({ lineNum: idx, content: line });
      }
    });
    matchMethod = "C: Global ##[error] search (no step section found)";
    debug.push(`STEP 3 (Fallback): Found ${errorMarkers.length} ##[error] markers in entire log`);
  }

  errorMarkers.forEach((e) => {
    debug.push(`  -> Line ${e.lineNum}: ${e.content.slice(0, 80)}...`);
  });

  // ============================================================
  // STEP 4: Extract logs - take N lines before ##[error]
  // ============================================================

  const MAX_LINES = 150;
  let extractedLogs: string | null = null;

  if (errorMarkers.length > 0) {
    // Take lines from (firstError - MAX_LINES) through (lastError + 5)
    const firstErrorLine = errorMarkers[0].lineNum;
    const lastErrorLine = errorMarkers[errorMarkers.length - 1].lineNum;

    const extractStart = Math.max(stepStartLine >= 0 ? stepStartLine : 0, firstErrorLine - MAX_LINES);
    const extractEnd = Math.min(lines.length, lastErrorLine + 5);

    debug.push(`STEP 4: Extracting lines ${extractStart} to ${extractEnd} (${extractEnd - extractStart} lines)`);
    debug.push(`  -> ${MAX_LINES} lines before first ##[error], through last ##[error] + 5`);

    extractedLogs = lines.slice(extractStart, extractEnd).join("\n");
  } else if (stepStartLine >= 0) {
    // No ##[error] found - take last N lines of the step
    matchMethod += " + fallback to last N lines (no ##[error])";
    const stepLines = lines.slice(stepStartLine, stepEndLine);
    debug.push(`STEP 4 (Fallback): No ##[error], taking last ${MAX_LINES} lines of step`);

    if (stepLines.length > MAX_LINES) {
      extractedLogs = "...(truncated)\n" + stepLines.slice(-MAX_LINES).join("\n");
    } else {
      extractedLogs = stepLines.join("\n");
    }
  } else {
    // Last resort: take last N lines of entire log
    matchMethod = "D: Last resort - end of entire log";
    debug.push(`STEP 4 (Last resort): Taking last ${MAX_LINES} lines of entire log`);
    extractedLogs = "...(truncated)\n" + lines.slice(-MAX_LINES).join("\n");
  }

  return { logs: extractedLogs, method: matchMethod, debug };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log("Usage: npx tsx scripts/test-ci-logs.ts <owner> <repo> <run_id>");
    console.log("");
    console.log("Example:");
    console.log("  npx tsx scripts/test-ci-logs.ts stakwork hive 21403376378");
    process.exit(1);
  }

  const [owner, repo, runIdStr] = args;
  const runId = parseInt(runIdStr, 10);

  console.log(`\nFetching workflow run ${runId} from ${owner}/${repo}...\n`);

  const { data: jobsData } = await octokit.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  console.log(`Found ${jobsData.jobs.length} jobs:\n`);

  for (const job of jobsData.jobs as GitHubJobDetails[]) {
    console.log(`${"=".repeat(70)}`);
    console.log(`Job: ${job.name} (id: ${job.id})`);
    console.log(`Status: ${job.status}, Conclusion: ${job.conclusion}`);
    console.log(`${"=".repeat(70)}`);
    console.log(`\nSteps:`);

    const failedSteps: GitHubJobStep[] = [];

    for (const step of job.steps || []) {
      const marker =
        step.conclusion === "failure"
          ? " ❌ FAILED"
          : step.conclusion === "success"
            ? " ✓"
            : step.conclusion === "skipped"
              ? " ⊘"
              : "";
      console.log(`  ${step.number}. ${step.name}${marker}`);

      if (step.conclusion === "failure") {
        failedSteps.push(step);
      }
    }

    if (failedSteps.length === 0) {
      console.log(`\n  (No failed steps)\n`);
      continue;
    }

    console.log(`\nFetching logs for job ${job.id}...`);

    try {
      const response = await octokit.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      const fullLogs = response.data as unknown as string;
      const totalLines = fullLogs.split("\n").length;
      console.log(`Full log: ${fullLogs.length} chars, ${totalLines} lines`);

      // Save for manual inspection
      const fs = await import("fs");
      const logFile = `/tmp/gh-logs-${job.id}.txt`;
      fs.writeFileSync(logFile, fullLogs);
      console.log(`Saved to: ${logFile}`);

      for (const failedStep of failedSteps) {
        console.log(`\n${"─".repeat(70)}`);
        console.log(`Failed Step: "${failedStep.name}" (step #${failedStep.number})`);
        console.log(`${"─".repeat(70)}\n`);

        const { logs, method, debug } = extractStepLogs(fullLogs, failedStep.number, failedStep.name);

        console.log(`METHOD USED: ${method}\n`);
        console.log(`DEBUG LOG:`);
        debug.forEach((d) => console.log(`  ${d}`));

        console.log(`\n${"─".repeat(40)}`);
        console.log(`EXTRACTED LOGS (${logs?.split("\n").length || 0} lines):`);
        console.log(`${"─".repeat(40)}\n`);

        if (logs) {
          // Show the actual logs
          console.log(logs);
        } else {
          console.log("(null - no logs extracted)");
        }
      }
    } catch (error) {
      console.error(`Error fetching logs: ${error}`);
    }

    console.log("");
  }
}

main().catch(console.error);
