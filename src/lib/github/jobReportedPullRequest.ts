/**
 * Security helper: verify that a given PR (repo + number) was actually
 * reported by the job that owns the Strut runs for jobId + swarmId.
 *
 * Why this matters
 * ────────────────
 * The live-status route uses the JOB OWNER's GitHub token to call the
 * GitHub API. Without this check any org member with workspace read could
 * pass an arbitrary repo/number and silently read private PR data through
 * the owner's elevated token.
 *
 * How it works
 * ────────────
 * We load the most-recent StrutRun rows for this jobId + swarmId (capped
 * at MAX_ROWS) and do a structured recursive walk of each `output` value
 * (objects and arrays, depth-capped at MAX_DEPTH). Two forms are recognised:
 *
 *   (a) Any string value that contains `github.com/{repo}/pull/{number}`
 *       followed by end-of-string or a non-digit character (so /pull/7
 *       does NOT match /pull/70). Case-insensitive.
 *
 *   (b) Any plain object whose `repo` key equals the target repo
 *       (case-insensitive) AND whose `number` key equals the target number
 *       (as a number or its decimal string representation).
 *
 * Reusable: no React, no Next.js — safe to call from a server-side watcher.
 */

import { db } from "@/lib/db";

/** Cap on rows scanned per job — keeps the DB read bounded. */
const MAX_ROWS = 50;

/** Maximum recursion depth for the output walk. */
const MAX_DEPTH = 12;

/** `value` as a pattern that matches it literally — a `.` in a repo name is a dot, not any character. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Walk `value` recursively (depth-first, up to MAX_DEPTH) and return true
 * as soon as either match form is found.
 */
function walkOutput(
  value: unknown,
  urlPattern: RegExp,
  repoLower: string,
  number: number,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) return false;

  // (a) String value — check for the GitHub URL.
  if (typeof value === "string") {
    return urlPattern.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => walkOutput(item, urlPattern, repoLower, number, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // (b) Object with matching repo + number fields.
    const objRepo = obj.repo;
    const objNumber = obj.number;
    if (
      typeof objRepo === "string" &&
      objRepo.toLowerCase() === repoLower &&
      (objNumber === number || objNumber === String(number))
    ) {
      return true;
    }

    // Recurse into every value, including string values (catches JSON-encoded
    // content fields that contain a URL).
    return Object.values(obj).some((v) => walkOutput(v, urlPattern, repoLower, number, depth + 1));
  }

  return false;
}

/**
 * Returns `true` iff at least one StrutRun for this job reported the given PR.
 *
 * @param jobId   `StrutRun.jobId`
 * @param swarmId `StrutRun.swarmId` — scopes the lookup to one swarm
 * @param repo    GitHub `owner/name` (case-insensitive)
 * @param number  Positive PR number
 */
export async function jobReportedPullRequest(
  jobId: string,
  swarmId: string,
  repo: string,
  number: number,
): Promise<boolean> {
  if (!Number.isInteger(number) || number <= 0) return false;

  const rows = await db.strutRun.findMany({
    where: { jobId, swarmId },
    select: { output: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  const repoLower = repo.toLowerCase();
  // Match github.com/{repo}/pull/{number} followed by end-of-string or a
  // non-digit — prevents /pull/7 matching /pull/70. `repo` is the caller's
  // input: escaped, so it can neither break the pattern nor widen it.
  const urlPattern = new RegExp(`github\\.com/${escapeRegExp(repoLower)}/pull/${number}(?:[^0-9]|$)`, "i");

  for (const row of rows) {
    if (!row.output) continue;
    if (walkOutput(row.output, urlPattern, repoLower, number, 0)) return true;
  }

  return false;
}
