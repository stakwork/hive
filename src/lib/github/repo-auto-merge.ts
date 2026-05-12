/**
 * GitHub repository auto-merge check helper
 *
 * Verifies whether a GitHub repository has auto-merge enabled.
 * Used to gate the user-facing auto-merge toggle on tasks.
 */

import { Octokit } from "@octokit/rest";
import { logger } from "@/lib/logger";

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
