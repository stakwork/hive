/**
 * Best-effort PR labeling for Jamie-originated pull requests.
 *
 * Adds the `jamie` label to a PR after creation. Label creation is
 * idempotent (create-if-missing first). All errors are swallowed and
 * logged — a missing label must never roll back a landed PR.
 *
 * Identity: uses `getOctokitForWorkspace` (which wraps `getUserAppTokens`)
 * with the **approving user's id explicitly**. We NEVER fall back to
 * `workspace.ownerId` — if the approving user has no per-org token,
 * we skip labeling entirely. The `[Jamie]` PR-title prefix is the
 * durable discriminator; the label and branch name are supplementary.
 *
 * `owner`/`repo` are derived from the validated `repositoryUrl`
 * (already verified to belong to the workspace at approval time),
 * never from `pr.url` to avoid a redirect attack.
 */

import { Octokit } from "@octokit/rest";
import { getOctokitForWorkspace } from "@/lib/github/pr-monitor";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { logger } from "@/lib/logger";

/** The label applied to all Jamie-originated PRs. */
const JAMIE_LABEL = "jamie";
const JAMIE_LABEL_COLOR = "0075ca"; // GitHub blue — no leading `#`
const JAMIE_LABEL_DESCRIPTION = "Automated PR opened by Jamie";

const LOG_TAG = "[labels.addPrLabels]";

/**
 * Create the `jamie` label in the repo if it doesn't already exist.
 * Best-effort: any error is swallowed.
 */
async function ensureLabelExists(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await octokit.issues.createLabel({
      owner,
      repo,
      name: JAMIE_LABEL,
      color: JAMIE_LABEL_COLOR,
      description: JAMIE_LABEL_DESCRIPTION,
    });
  } catch (err: unknown) {
    // 422 = label already exists — expected, not an error.
    const status = (err as { status?: number })?.status;
    if (status !== 422) {
      logger.warn(`${LOG_TAG} createLabel failed (non-fatal)`, "labels", {
        owner,
        repo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Add the `jamie` label to a newly-created PR.
 *
 * @param approvingUserId - The NextAuth userId of the approver (credentials
 *   source — NEVER substitute `workspace.ownerId`).
 * @param repositoryUrl   - The validated repository URL (e.g. https://github.com/org/repo).
 *   Used to derive `owner`/`repo`. NOT derived from `prUrl`.
 * @param prNumber        - The PR number to label.
 */
export async function addPrLabels(
  approvingUserId: string,
  repositoryUrl: string,
  prNumber: number,
): Promise<void> {
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGithubOwnerRepo(repositoryUrl));
  } catch (err) {
    logger.warn(`${LOG_TAG} Could not parse repositoryUrl — skipping label`, "labels", {
      repositoryUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Resolve per-org token for the approving user.
  // If they have no token, skip labeling — do NOT fall back to ownerId.
  const octokit = await getOctokitForWorkspace(approvingUserId, owner);
  if (!octokit) {
    logger.info(
      `${LOG_TAG} Approving user has no per-org token — skipping label`,
      "labels",
      { approvingUserId, owner, repo, prNumber },
    );
    return;
  }

  // Ensure the label exists (idempotent create).
  await ensureLabelExists(octokit, owner, repo);

  // Apply the label to the PR.
  try {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [JAMIE_LABEL],
    });
    logger.info(`${LOG_TAG} Label added`, "labels", {
      owner,
      repo,
      prNumber,
      label: JAMIE_LABEL,
    });
  } catch (err) {
    logger.warn(`${LOG_TAG} addLabels failed (non-fatal)`, "labels", {
      owner,
      repo,
      prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
