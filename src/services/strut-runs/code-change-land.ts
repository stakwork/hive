/**
 * Completion handler for `kind: "code_change_land"` — the `code-change-land`
 * strut workflow approval dispatches (strut `plans/code-change.md` §6).
 *
 * Approval created the claim `Task`, wrote the dispatch receipt
 * (`codeChangeClaim`, `runner: "strut"`, `requestId` = the `StrutRun.id`)
 * and returned "PR pending". Strut checked the repo out, `git apply`ed the
 * approved bytes, pushed the branch hive named and opened the PR as the
 * approver. This delivers the result onto the claim.
 *
 * The contract:
 *
 *   input   { repo, baseBranch, diff, diffSha256, branch, title, body }
 *   output  { url, number, branch, base, headSha, filesChanged, files?, diffSha256 }
 *   error   a message that STARTS with `patch_conflict:` | `push_rejected:` |
 *           `no_push_permission:` | `pr_create_failed:`; anything else
 *           (a checkout failure, …) carries no code.
 *
 * Every outcome goes through `completeClaimFromResult` in the
 * `LandChangeResult` shape the swarm path uses, so a strut-landed PR clears
 * the identical hardening (shape, caps, secret re-scan, `validatePrUrl`,
 * path set vs `approvedPaths`) and every failure gets the identical
 * deletable-vs-kept treatment (`DELETABLE_FAILURE_CODES`). The output does
 * not repeat the diff: hive trusts only its own row's `input.diff`, and only
 * once the run has echoed its sha256 back.
 *
 * Idempotent by construction: `completeClaimFromResult` no-ops on a claim
 * that already carries a PULL_REQUEST artifact, and the transcript patch
 * is a fixed rewrite. A row whose claim belongs to another attempt (the
 * receipt's `requestId` is not this row) delivers nothing.
 */

import crypto from "crypto";
import { z } from "zod";
import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  completeClaimFromResult,
  markClaimRunFailed,
  parseCreatePrClaim,
} from "@/lib/proposals/codeChangeCompletion";
import { CODE_CHANGE_LAND_KIND, CODE_CHANGE_LAND_WORKFLOW } from "@/lib/proposals/types";
import type { StrutRunRow } from "@/services/strut-runs";

export { CODE_CHANGE_LAND_KIND, CODE_CHANGE_LAND_WORKFLOW };

const LOG_TAG = "CODE_CHANGE_LAND";

/**
 * After this long, a settled row with no claim `Task` is one whose claim was
 * deleted (a classified failure, or a refused dispatch) — a replayed callback
 * has nothing to deliver to. Younger, the receipt may still be in flight.
 */
const RECEIPT_GRACE_MS = 60_000;

/** The workflow's `output` (its `pack` step). Extra keys are tolerated. */
export const codeChangeLandOutputSchema = z
  .object({
    url: z.string(),
    number: z.number().int(),
    branch: z.string(),
    base: z.string(),
    headSha: z.string(),
    filesChanged: z.number().int().nonnegative(),
    files: z.array(z.string()).optional(),
    diffSha256: z.string(),
  })
  .passthrough();

/** The workflow `input` approval launched with. */
export const codeChangeLandInputSchema = z
  .object({
    repo: z.string(),
    baseBranch: z.string(),
    diff: z.string(),
    diffSha256: z.string(),
    branch: z.string(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough();

/**
 * The failure codes a strut step reports, by the token its message starts
 * with. A contract, not prose matching: the token is the code.
 */
export const LAND_FAILURE_TOKENS = ["patch_conflict", "push_rejected", "no_push_permission", "pr_create_failed"] as const;
export type LandFailureToken = (typeof LAND_FAILURE_TOKENS)[number];

/** The leading failure token of a strut error message, or null. */
export function landFailureToken(error: string | null | undefined): LandFailureToken | null {
  if (!error) return null;
  for (const token of LAND_FAILURE_TOKENS) {
    if (error === token || error.startsWith(`${token}:`) || error.startsWith(`${token} `)) return token;
  }
  return null;
}

/** What a settled row means for its claim. */
export type LandDisposition =
  /** A `LandChangeResult`-shaped result for `completeClaimFromResult`. */
  | { kind: "result"; rawResult: { pr: Record<string, unknown> } }
  /** No result to harden: `markClaimRunFailed` (claim kept). */
  | { kind: "run_failed"; retryable: boolean }
  /** Not settled — nothing to deliver. */
  | { kind: "pending" };

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function failure(code: string, error: string): LandDisposition {
  return { kind: "result", rawResult: { pr: { ok: false, failure: code, diff: "", error } } };
}

/** The disposition of a settled row — pure, so every branch is testable. */
export function landDispositionForRow(row: StrutRunRow): LandDisposition {
  switch (row.status) {
    case StrutRunStatus.PENDING:
      return { kind: "pending" };
    case StrutRunStatus.LOST:
      return { kind: "run_failed", retryable: true };
    case StrutRunStatus.CANCELLED:
      return failure("aborted", "The run was stopped.");
    case StrutRunStatus.ERROR: {
      const token = landFailureToken(row.error);
      return token ? failure(token, row.error ?? token) : { kind: "run_failed", retryable: false };
    }
    case StrutRunStatus.SUCCESS:
      break;
  }

  const output = codeChangeLandOutputSchema.safeParse(row.output);
  const input = codeChangeLandInputSchema.safeParse(row.input);
  if (!output.success || !input.success) {
    // A PR may exist; the claim is kept and reconcile's GitHub channel can
    // still adopt it.
    logger.warn("Settled code-change-land run has an unexpected shape", LOG_TAG, {
      runId: row.id,
      outputOk: output.success,
      inputOk: input.success,
    });
    return { kind: "run_failed", retryable: false };
  }

  // Hive trusts only bytes whose sha256 the run echoed back.
  const approvedDiff = input.data.diff;
  if (output.data.diffSha256 !== sha256Hex(approvedDiff)) {
    return failure("diff_mismatch", "diffSha256 of the landed change differs from the approved diff");
  }

  const { url, number, branch, base, headSha, filesChanged } = output.data;
  return {
    kind: "result",
    rawResult: { pr: { ok: true, url, number, branch, base, headSha, diff: approvedDiff, filesChanged } },
  };
}

/** The `StrutRunHandler` for `code_change_land`. Throws to be retried. */
export async function handleCodeChangeLandSettled(row: StrutRunRow): Promise<void> {
  const disposition = landDispositionForRow(row);
  if (disposition.kind === "pending") return;

  if (!row.proposalId) {
    logger.warn("Settled code-change-land run has no proposal", LOG_TAG, { runId: row.id, status: row.status });
    return;
  }

  const task = await db.task.findFirst({
    where: { workspaceId: row.workspaceId, proposalId: row.proposalId, deleted: false },
    select: { id: true, codeChangeClaim: true },
  });
  if (!task) {
    const settledAgoMs = Date.now() - (row.settledAt ?? row.createdAt).getTime();
    if (settledAgoMs > RECEIPT_GRACE_MS) {
      logger.info("Code-change-land claim is gone — nothing to deliver to", LOG_TAG, {
        runId: row.id,
        proposalId: row.proposalId,
        status: row.status,
      });
      return;
    }
    // The callback beat the claim insert (the approval request is still
    // between the dispatch and its return) — 5xx, strut re-posts.
    throw new Error("code_change_land: claim task not found yet");
  }
  const claim = parseCreatePrClaim(task.codeChangeClaim);
  if (!claim) {
    // The receipt write is milliseconds behind the dispatch — same as above.
    throw new Error("code_change_land: claim receipt not written yet");
  }
  if (claim.requestId !== row.id) {
    logger.warn("Code-change-land row is not the claim's attempt — ignoring", LOG_TAG, {
      runId: row.id,
      claimRequestId: claim.requestId,
      taskId: task.id,
    });
    return;
  }

  if (disposition.kind === "result") {
    const outcome = await completeClaimFromResult({ taskId: task.id, claim, rawResult: disposition.rawResult });
    logger.info("Code-change-land delivered", LOG_TAG, {
      runId: row.id,
      taskId: task.id,
      status: row.status,
      ...outcome,
    });
    return;
  }

  await markClaimRunFailed({ taskId: task.id, claim, retryable: disposition.retryable });
  logger.info("Code-change-land run failed without a result", LOG_TAG, {
    runId: row.id,
    taskId: task.id,
    status: row.status,
    retryable: disposition.retryable,
  });
}
