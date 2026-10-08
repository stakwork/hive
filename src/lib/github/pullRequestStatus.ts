/**
 * Shared helper: fetch live pull-request status from GitHub.
 *
 * Generic (no React, no Next.js route code) so a server-side watcher or
 * auto-fix can reuse it alongside the org-canvas live-read.
 *
 * Returns the four lifecycle states the canvas card understands
 * (`PullRequestState`) plus the head SHA, branches, author, title, and the
 * check-run / commit-status summary (`PullRequestCheck[]`).
 *
 * Mapping rules
 * ─────────────
 * - GitHub `state: "open"` + `draft: true`  → `"draft"`
 * - GitHub `state: "open"` + `draft: false` → `"open"`
 * - GitHub `state: "closed"` + `merged: true`  → `"merged"`
 * - GitHub `state: "closed"` + `merged: false` → `"closed"`
 *
 * Checks
 * ──────
 * Pulls from two sources for the head SHA:
 *   1. Check runs (GitHub Actions)  — status mapped via `conclusionToStatus`
 *   2. Commit statuses (legacy CI) — state mapped via `legacyStateToStatus`
 * Only completed runs / terminal statuses are reported; in-flight ones are
 * `"pending"`. Skipped / neutral conclusions become `"skipped"`. Each check
 * carries its own page (`url`: a run's `html_url`, a status's `target_url`)
 * when GitHub gives one, so an event about a failure can point at it.
 *
 * On any GitHub API error the call throws; callers decide whether to fall
 * back to the inline state or surface the error.
 */

import { Octokit } from "@octokit/rest";
import type { PullRequestCheck, PullRequestState } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

export interface PullRequestStatusResult {
  state: PullRequestState;
  title: string;
  headSha: string;
  headBranch: string;
  baseBranch: string;
  author?: string;
  checks: PullRequestCheck[];
}

// ─── State mapping ─────────────────────────────────────────────────────────

function mapState(githubState: "open" | "closed", merged: boolean, draft: boolean): PullRequestState {
  if (githubState === "closed") return merged ? "merged" : "closed";
  return draft ? "draft" : "open";
}

// ─── Check-run conclusion → PullRequestCheck status ───────────────────────

const CONCLUSION_MAP: Record<string, PullRequestCheck["status"] | undefined> = {
  success: "success",
  skipped: "skipped",
  neutral: "skipped",
  failure: "failure",
  timed_out: "failure",
  action_required: "failure",
  cancelled: "failure",
  stale: "failure",
};

function conclusionToStatus(
  ghStatus: string,
  conclusion: string | null,
): PullRequestCheck["status"] {
  if (ghStatus !== "completed") return "pending";
  return CONCLUSION_MAP[conclusion ?? ""] ?? "failure";
}

// ─── Legacy commit-status state → PullRequestCheck status ─────────────────

function legacyStateToStatus(state: string): PullRequestCheck["status"] {
  switch (state) {
    case "success":
      return "success";
    case "pending":
      return "pending";
    case "failure":
    case "error":
    default:
      return "failure";
  }
}

// ─── Main helper ───────────────────────────────────────────────────────────

/**
 * Fetch live PR status from GitHub.
 *
 * @param octokit  Authenticated Octokit client (any auth strategy).
 * @param params   `owner` is the GitHub org/user; `repo` is the short name
 *                 (no `owner/` prefix); `number` is the PR number.
 *
 * Throws on GitHub API errors so callers can fall back to inline state.
 */
export async function getPullRequestStatus(
  octokit: Octokit,
  params: { owner: string; repo: string; number: number },
): Promise<PullRequestStatusResult> {
  const { owner, repo, number } = params;

  // 1. Fetch PR metadata
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: number,
  });

  const state = mapState(
    pr.state as "open" | "closed",
    pr.merged ?? false,
    pr.draft ?? false,
  );

  const headSha = pr.head.sha;
  const headBranch = pr.head.ref;
  const baseBranch = pr.base.ref;
  const author = pr.user?.login ?? undefined;
  const title = pr.title;

  // 2. Fetch checks for the head SHA (check runs + commit statuses)
  const [checkRunsResult, combinedStatusResult] = await Promise.allSettled([
    octokit.checks.listForRef({ owner, repo, ref: headSha, per_page: 100 }),
    octokit.repos.getCombinedStatusForRef({ owner, repo, ref: headSha }),
  ]);

  const checks: PullRequestCheck[] = [];

  if (checkRunsResult.status === "fulfilled") {
    for (const run of checkRunsResult.value.data.check_runs) {
      checks.push({
        name: run.name,
        status: conclusionToStatus(run.status, run.conclusion),
        ...(run.html_url ? { url: run.html_url } : {}),
      });
    }
  }

  if (combinedStatusResult.status === "fulfilled") {
    for (const s of combinedStatusResult.value.data.statuses) {
      checks.push({
        name: s.context,
        status: legacyStateToStatus(s.state),
        ...(s.target_url ? { url: s.target_url } : {}),
      });
    }
  }

  return { state, title, headSha, headBranch, baseBranch, author, checks };
}
