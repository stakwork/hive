/**
 * Resolve an authenticated Octokit client for the owner of a Strut job.
 *
 * The job owner is the user who launched the StrutRun (`StrutRun.userId`).
 * Their GitHub token is preferred over the viewing user's because it is the
 * identity under which the PR was opened and will have the necessary repo
 * permissions.
 *
 * Resolution order
 * ────────────────
 * 1. Job owner's token   — StrutRun → userId → getUserAppTokens(userId, owner)
 * 2. Viewer's token      — supplied by the route as a fallback userId
 * 3. No token available  — returns `{ ok: false, reason: "no_token" }`
 *
 * Generic (no React, no route code) so a server-side watcher can reuse it.
 */

import { Octokit } from "@octokit/rest";
import { db } from "@/lib/db";
import { getOctokitForWorkspace } from "@/lib/github/pr-monitor";

export type ResolveOctokitResult =
  | { ok: true; octokit: Octokit; source: "job_owner" | "viewer" }
  | { ok: false; reason: "no_token" | "run_not_found" };

/**
 * Resolve an Octokit client for the given job's owner, with a fallback to the
 * viewing user's token.
 *
 * @param jobId       The job ID from `StrutRun.jobId`.
 * @param swarmId     The swarm ID from `StrutRun.swarmId` (scopes the lookup).
 * @param owner       GitHub org/user name — used to pick the right token.
 * @param viewerUserId  Fallback: the currently authenticated user's ID.
 */
export async function resolveJobOwnerOctokit(
  jobId: string,
  swarmId: string,
  owner: string,
  viewerUserId: string,
): Promise<ResolveOctokitResult> {
  // 1. Find the job's StrutRun to get the owner's userId.
  const run = await db.strutRun.findFirst({
    where: { jobId, swarmId },
    select: { userId: true },
  });

  if (!run) {
    return { ok: false, reason: "run_not_found" };
  }

  // 2. Try the job owner's GitHub token.
  const ownerOctokit = await getOctokitForWorkspace(run.userId, owner);
  if (ownerOctokit) {
    return { ok: true, octokit: ownerOctokit, source: "job_owner" };
  }

  // 3. Fall back to the viewing user's token.
  if (viewerUserId !== run.userId) {
    const viewerOctokit = await getOctokitForWorkspace(viewerUserId, owner);
    if (viewerOctokit) {
      return { ok: true, octokit: viewerOctokit, source: "viewer" };
    }
  }

  return { ok: false, reason: "no_token" };
}
