/**
 * GitHub repository auto-merge check helper
 *
 * Verifies whether a GitHub repository has auto-merge enabled.
 * Used to gate the user-facing auto-merge toggle on tasks.
 */

import { Octokit } from "@octokit/rest";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { parsePRUrl, getOctokitForWorkspace } from "@/lib/github/pr-monitor";

const LOG_PREFIX = "[RepoAutoMerge]";

export type AutoMergeCheckError = "permission_denied" | "not_found" | "unknown";

export interface AutoMergeCheckResult {
  allowed: boolean;
  error?: AutoMergeCheckError;
}

/**
 * Check whether a GitHub repository allows auto-merge.
 *
 * Returns `{ allowed: true }` when `allow_auto_merge` is true on the repo.
 * Returns `{ allowed: false }` when the repo explicitly disables it.
 * Returns `{ allowed: false, error }` on API errors.
 */
export async function checkRepoAllowsAutoMerge(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<AutoMergeCheckResult> {
  logger.info(`${LOG_PREFIX} Checking allow_auto_merge`, `${owner}/${repo}`);

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });

    if (data.allow_auto_merge) {
      logger.info(`${LOG_PREFIX} allow_auto_merge: true — caching result`, `${owner}/${repo}`);
      return { allowed: true };
    }

    logger.warn(`${LOG_PREFIX} allow_auto_merge: false on repo`, `${owner}/${repo}`);
    return { allowed: false };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;

    if (status === 403) {
      logger.error(`${LOG_PREFIX} Permission denied fetching repo`, `${owner}/${repo}`);
      return { allowed: false, error: "permission_denied" };
    }

    if (status === 404) {
      logger.error(`${LOG_PREFIX} Repository not found`, `${owner}/${repo}`);
      return { allowed: false, error: "not_found" };
    }

    logger.error(`${LOG_PREFIX} Unknown error fetching repo`, `${owner}/${repo}`, { err });
    return { allowed: false, error: "unknown" };
  }
}

const RESOLVE_PREFIX = "[resolveAutoMergeDefault]";

/**
 * Determines whether a newly-created task should default to autoMerge: true.
 *
 * Returns true only when:
 *  - The user has canvasAutonomousTurns enabled
 *  - A repositoryId is provided
 *  - The linked GitHub repository permits auto-merge
 *
 * Always fails safe — any error returns false so task creation is never blocked.
 */
export async function resolveAutoMergeDefault(
  userId: string,
  repositoryId: string | null
): Promise<boolean> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { canvasAutonomousTurns: true },
    });

    if (!user?.canvasAutonomousTurns) {
      return false;
    }

    if (!repositoryId) {
      return false;
    }

    const repo = await db.repository.findUnique({
      where: { id: repositoryId },
      select: { repositoryUrl: true, allowAutoMerge: true },
    });

    if (!repo) {
      return false;
    }

    // Cache hit — skip GitHub API call
    if (repo.allowAutoMerge === true) {
      return true;
    }

    const parsed = parsePRUrl(`${repo.repositoryUrl}/pull/1`);
    if (!parsed) {
      logger.warn(`${RESOLVE_PREFIX} Could not parse repositoryUrl`, undefined, {
        repositoryUrl: repo.repositoryUrl,
      });
      return false;
    }

    const { owner, repo: repoName } = parsed;
    const octokit = await getOctokitForWorkspace(userId, owner);
    if (!octokit) {
      return false;
    }

    const result = await checkRepoAllowsAutoMerge(octokit, owner, repoName);

    if (result.allowed) {
      await db.repository.update({
        where: { id: repositoryId },
        data: { allowAutoMerge: true },
      });
      return true;
    }

    return false;
  } catch (err) {
    logger.error(`${RESOLVE_PREFIX} Unexpected error — failing safe`, undefined, { err });
    return false;
  }
}
