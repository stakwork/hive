/**
 * Terminal-outcome processing for async code-change claims.
 *
 * A code-change approval now dispatches to the swarm and returns
 * immediately; the terminal `create_pr` result arrives later — on the
 * webhook (`/api/code-change/webhook`) or via the reconcile cron
 * (`/api/cron/code-change-reconcile`). BOTH paths complete the claim
 * through this module so every PR URL that gets persisted has cleared the
 * identical hardening (`_processCompletedResult` → `hardenPrResult`:
 * shape, caps, secret re-scan, `validatePrUrl`) the old synchronous poll
 * path enforced. Do not fork this logic.
 *
 * Responsibilities on a terminal result:
 *   - success → Task.branch, PULL_REQUEST artifact (idempotent), PR
 *     labels, and an in-place patch of the stored `approvalResult` row so
 *     the proposal card flips from "PR in progress" to the PR link.
 *   - classified no-PR failure → delete the claim Task (the proposal
 *     becomes re-approvable), patch the stored row with the honest
 *     failure.
 *   - ambiguous failure (`create_pr_not_called`, `unknown`, …) → KEEP the
 *     claim for the reconcile cron, patch the stored row.
 */

import { db } from "@/lib/db";
import { ArtifactType, ChatRole } from "@prisma/client";
import {
  _processCompletedResult,
  reconcilePr,
  type CreatePrClaim,
  type CreatePrSuccess,
} from "@/services/swarm/createPr";
import { addPrLabels } from "@/lib/github/labels";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { patchStoredCodeChangeResult } from "@/services/canvas-turn-persistence";
import { logger } from "@/lib/logger";
import type { PullRequestContent } from "@/lib/chat";

/**
 * Failure codes that PROVE no PR was created — the claim Task can be
 * deleted so the user may re-approve the same proposal. Anything not in
 * this set (`create_pr_not_called`, `push_rejected`, `pr_create_failed`,
 * `aborted`, `unknown`, …) may have left a branch or PR behind and keeps
 * its claim for reconciliation.
 */
export const DELETABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "no_changes",
  "patch_conflict",
  "secrets_detected",
  "change_too_large",
  "identity_mismatch",
  "no_push_permission",
  "no_access",
  "rate_limited",
  "swarm_unauth",
  "swarm_bad_request",
]);

/**
 * Narrow the `Task.codeChangeClaim` JSON column back to a `CreatePrClaim`.
 * Returns null for anything that isn't a complete claim — an old row, a
 * half-written value, hand-edited JSON. A partial claim is worse than none:
 * `reconcilePr` would query the wrong branch and could mis-attribute a PR.
 */
export function parseCreatePrClaim(value: unknown): CreatePrClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const required = [
    "requestId",
    "repositoryUrl",
    "userId",
    "workspaceSlug",
  ] as const;
  for (const k of required) {
    if (typeof c[k] !== "string" || (c[k] as string).length === 0) return null;
  }
  return {
    requestId: c.requestId as string,
    repositoryUrl: c.repositoryUrl as string,
    userId: c.userId as string,
    workspaceSlug: c.workspaceSlug as string,
    ...(typeof c.prBranch === "string" && c.prBranch
      ? { prBranch: c.prBranch }
      : {}),
    ...(typeof c.runIdPrefix === "string" && c.runIdPrefix
      ? { runIdPrefix: c.runIdPrefix }
      : {}),
    ...(Array.isArray(c.approvedPaths) &&
    c.approvedPaths.every((x) => typeof x === "string")
      ? { approvedPaths: c.approvedPaths as string[] }
      : {}),
    ...(typeof c.conversationId === "string" && c.conversationId
      ? { conversationId: c.conversationId }
      : {}),
    ...(typeof c.proposalId === "string" && c.proposalId
      ? { proposalId: c.proposalId }
      : {}),
  };
}

/**
 * Attach a PULL_REQUEST artifact to a claim Task's seed message so the PR
 * becomes visible to the UI and to `findOpenPRArtifacts` (pr-monitor).
 *
 * Best-effort and idempotent: a failure here must never turn a landed PR
 * into a reported failure, and a concurrent webhook/reconcile must not
 * produce two artifacts for the same PR.
 *
 * Scoped to the ASSISTANT message — the one carrying the DIFF. A claim Task
 * also seeds a USER message holding the originating prompt, and both rows are
 * written in the same transaction, so `createdAt` alone can tie and resolve
 * either way. The role filter keeps the PR landing beside its diff.
 */
export async function attachPrArtifact(
  taskId: string,
  prUrl: string,
  repositoryUrl: string,
): Promise<void> {
  try {
    const msg = await db.chatMessage.findFirst({
      where: { taskId, role: ChatRole.ASSISTANT },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        artifacts: {
          where: { type: ArtifactType.PULL_REQUEST },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!msg || msg.artifacts.length > 0) return;

    let repoName: string;
    try {
      const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);
      repoName = `${owner}/${repo}`;
    } catch {
      repoName = repositoryUrl;
    }

    const content: PullRequestContent = {
      repo: repoName,
      url: prUrl,
      status: "IN_PROGRESS",
    };
    await db.artifact.create({
      data: {
        messageId: msg.id,
        type: ArtifactType.PULL_REQUEST,
        content:
          content as unknown as import("@prisma/client").Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.error(
      "[codeChangeCompletion] Failed to attach PR artifact",
      "codeChangeCompletion",
      { taskId, prUrl, error: String(err) },
    );
  }
}

export type ClaimCompletionOutcome =
  | { outcome: "landed"; prUrl: string; prNumber: number }
  | { outcome: "failed"; failureCode: string; claimDeleted: boolean }
  | { outcome: "already-complete" };

/**
 * Whether the claim Task already carries a PULL_REQUEST artifact — the
 * idempotency anchor for webhook retries and webhook/cron races.
 */
export async function claimHasPrArtifact(taskId: string): Promise<boolean> {
  const artifact = await db.artifact.findFirst({
    where: {
      type: ArtifactType.PULL_REQUEST,
      message: { taskId },
    },
    select: { id: true },
  });
  return artifact !== null;
}

/**
 * Complete a claim from a raw terminal swarm result (`result` from the
 * webhook payload, or the `/progress` cache during reconcile). Runs the
 * result through the SAME `_processCompletedResult` hardening as the old
 * synchronous path, then persists the outcome and patches the stored
 * conversation row.
 */
export async function completeClaimFromResult(args: {
  taskId: string;
  claim: CreatePrClaim;
  rawResult: unknown;
}): Promise<ClaimCompletionOutcome> {
  const { taskId, claim, rawResult } = args;

  if (await claimHasPrArtifact(taskId)) {
    return { outcome: "already-complete" };
  }

  const approvedPaths = Array.isArray(claim.approvedPaths)
    ? new Set(claim.approvedPaths)
    : null;

  const prResult = _processCompletedResult(
    rawResult,
    approvedPaths,
    claim.repositoryUrl,
    { requestId: claim.requestId },
  );

  if (!prResult.ok) {
    const claimDeleted = DELETABLE_FAILURE_CODES.has(prResult.failureCode);
    if (claimDeleted) {
      // Provably no PR — delete the claim so the user can re-approve.
      await db.task
        .delete({ where: { id: taskId } })
        .catch((deleteErr) =>
          logger.warn(
            "[codeChangeCompletion] Failed to delete claim on classified failure",
            "codeChangeCompletion",
            { taskId, error: String(deleteErr) },
          ),
        );
    }
    logger.warn(
      "[codeChangeCompletion] Terminal failure",
      "codeChangeCompletion",
      {
        taskId,
        requestId: claim.requestId,
        failureCode: prResult.failureCode,
        claimDeleted,
      },
    );

    await patchClaimTranscript(claim, {
      failureCode: prResult.failureCode,
      failureMessage: prResult.message,
      repositoryUrl: claim.repositoryUrl,
    });

    return { outcome: "failed", failureCode: prResult.failureCode, claimDeleted };
  }

  await persistLandedPr(taskId, claim, prResult);
  return { outcome: "landed", prUrl: prResult.prUrl, prNumber: prResult.prNumber };
}

/**
 * Persist a hardened landed PR onto the claim Task and the stored
 * conversation row. Shared by the fresh-result path above and the
 * reconcile cron's GitHub-channel recovery (which only knows url/number —
 * pass a partial success there via `reconciledPr`).
 */
export async function persistLandedPr(
  taskId: string,
  claim: CreatePrClaim,
  pr: CreatePrSuccess,
): Promise<void> {
  // Task.branch — links the claim Task to the swarm branch for pr-monitor.
  await db.task
    .update({ where: { id: taskId }, data: { branch: pr.branch } })
    .catch((err) =>
      logger.warn(
        "[codeChangeCompletion] Task.branch update failed (non-fatal)",
        "codeChangeCompletion",
        { taskId, error: String(err) },
      ),
    );

  // PULL_REQUEST artifact — idempotent.
  await attachPrArtifact(taskId, pr.prUrl, pr.repositoryUrl);

  // Best-effort PR labeling — never blocks.
  addPrLabels(claim.userId, pr.repositoryUrl, pr.prNumber).catch((labelErr) =>
    logger.warn(
      "[codeChangeCompletion] addPrLabels failed (non-fatal)",
      "codeChangeCompletion",
      { prNumber: pr.prNumber, error: String(labelErr) },
    ),
  );

  await patchClaimTranscript(claim, {
    prUrl: pr.prUrl,
    prNumber: pr.prNumber,
    branch: pr.branch,
    baseBranch: pr.baseBranch,
    headSha: pr.headSha,
    filesChanged: pr.filesChanged,
    repositoryUrl: pr.repositoryUrl,
    pathSetVerified: pr.pathSetVerified,
    ...(pr.pathSetVerified === false && pr.unapprovedPaths.length
      ? { unapprovedPaths: pr.unapprovedPaths }
      : {}),
  });

  logger.info(
    "[codeChangeCompletion] PR landed and persisted",
    "codeChangeCompletion",
    {
      taskId,
      requestId: claim.requestId,
      prUrl: pr.prUrl,
      prNumber: pr.prNumber,
      branch: pr.branch,
      pathSetVerified: pr.pathSetVerified,
    },
  );
}

/**
 * Mark a claim whose run the swarm reported as FAILED (webhook
 * `status: "failed"`). No result envelope exists, so nothing is hardened
 * or persisted — the stored row is patched with an honest message and the
 * claim is KEPT: `retryable: true` means a swarm restart orphaned the run
 * (re-dispatch would be safe, but is deliberately not automated here),
 * and either way the reconcile cron keeps checking whether a PR landed
 * before the failure.
 */
export async function markClaimRunFailed(args: {
  taskId: string;
  claim: CreatePrClaim;
  retryable: boolean;
}): Promise<void> {
  const { taskId, claim, retryable } = args;
  logger.warn(
    "[codeChangeCompletion] Swarm reported run failed — keeping claim",
    "codeChangeCompletion",
    { taskId, requestId: claim.requestId, retryable },
  );
  await patchClaimTranscript(claim, {
    failureCode: "swarm_run_failed",
    failureMessage: retryable
      ? "The swarm run was interrupted before completing (likely a restart). " +
        "The system will keep checking whether a PR was opened; if none appears, " +
        "re-generate the proposal to try again."
      : "The swarm run failed before a PR could be verified. " +
        "Check the repository for a new pull request; if there is none, " +
        "re-generate the proposal.",
    repositoryUrl: claim.repositoryUrl,
  });
}

/**
 * Backstop resolution for a claim whose webhook never arrived (cron sweep).
 *
 * Delegates to `reconcilePr` — swarm `/progress` cache first (full result,
 * hardened via the shared path inside `reconcilePr`), then a GitHub query
 * on the exact `prBranch` from the dispatch receipt. Never re-dispatches.
 * On a landed PR, persists the same artifacts/patches as a webhook
 * delivery would (branch from the receipt; head SHA / file counts are
 * unavailable on the GitHub channel and stay absent from the patch).
 */
export async function reconcileClaim(args: {
  taskId: string;
  claim: CreatePrClaim;
}): Promise<"landed" | "unknown" | "already-complete"> {
  const { taskId, claim } = args;

  if (await claimHasPrArtifact(taskId)) {
    return "already-complete";
  }

  const outcome = await reconcilePr(claim);
  if (outcome.outcome !== "landed") return "unknown";

  if (claim.prBranch) {
    await db.task
      .update({ where: { id: taskId }, data: { branch: claim.prBranch } })
      .catch((err) =>
        logger.warn(
          "[codeChangeCompletion] Task.branch update failed during reconcile",
          "codeChangeCompletion",
          { taskId, error: String(err) },
        ),
      );
  }

  await attachPrArtifact(taskId, outcome.prUrl, claim.repositoryUrl);

  addPrLabels(claim.userId, claim.repositoryUrl, outcome.prNumber).catch(
    (labelErr) =>
      logger.warn(
        "[codeChangeCompletion] addPrLabels failed during reconcile (non-fatal)",
        "codeChangeCompletion",
        { prNumber: outcome.prNumber, error: String(labelErr) },
      ),
  );

  await patchClaimTranscript(claim, {
    prUrl: outcome.prUrl,
    prNumber: outcome.prNumber,
    repositoryUrl: claim.repositoryUrl,
    ...(claim.prBranch ? { branch: claim.prBranch } : {}),
  });

  logger.info(
    "[codeChangeCompletion] Reconciled claim to a landed PR",
    "codeChangeCompletion",
    { taskId, requestId: claim.requestId, prUrl: outcome.prUrl },
  );
  return "landed";
}

/**
 * Patch the stored conversation row's `approvalResult.codeChange` (and the
 * row's visible text) so the proposal card leaves "PR in progress".
 * Silently a no-op for legacy claims without `conversationId`/`proposalId`.
 */
async function patchClaimTranscript(
  claim: CreatePrClaim,
  codeChange: Record<string, unknown>,
): Promise<void> {
  if (!claim.conversationId || !claim.proposalId) return;
  const content =
    typeof codeChange.prUrl === "string"
      ? `Opened pull request: ${codeChange.prUrl}` +
        (codeChange.pathSetVerified === false
          ? " (⚠ some files were not in the approved diff)"
          : "")
      : `Code change failed: ${String(codeChange.failureMessage ?? codeChange.failureCode ?? "unknown error")}`;
  try {
    await patchStoredCodeChangeResult({
      conversationId: claim.conversationId,
      proposalId: claim.proposalId,
      codeChange,
      content,
    });
  } catch (err) {
    logger.error(
      "[codeChangeCompletion] Failed to patch stored approvalResult",
      "codeChangeCompletion",
      {
        conversationId: claim.conversationId,
        proposalId: claim.proposalId,
        error: String(err),
      },
    );
  }
}
