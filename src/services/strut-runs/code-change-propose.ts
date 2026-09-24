/**
 * Completion handler for `kind: "code_change_propose"` — the
 * `code-change-propose` strut workflow behind `propose_code_change`
 * (strut `plans/code-change.md` §4–5).
 *
 * The tool returned a PENDING proposal card; this fills it in. On a
 * `success` run the workflow's output is the diff `git/diff` captured:
 *
 *   { diff, diffSha256, filesChanged, files, baseBranch, baseSha, cost }
 *
 * Hive re-runs its OWN hygiene on `output.diff` (parse, caps, secrets —
 * exactly the propose-time guards of the synchronous path), computes
 * `diffSha256` itself, and patches the stored tool output in place to
 * `ready` (`patchStoredProposalPreview`, the same `FOR UPDATE` discipline
 * `patchStoredCodeChangeResult` uses for approval results). `filesChanged:
 * 0` is a SUCCESS run with nothing to propose → `failed`. A secrets hit
 * discards the diff — from the card AND from the row — and patches
 * `failed`. `error` / `cancelled` / LOST → `failed` / `cancelled` with the
 * message. Then the Stop button's active-run entry is cleared.
 *
 * Idempotent by construction: the patch compares JSON and no-ops when the
 * row already carries it, so a webhook replay or a reconcile after a
 * delivered callback changes nothing.
 */

import crypto from "crypto";
import { z } from "zod";
import { Prisma, StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  enforceDiffCaps,
  parseUnifiedDiff,
  scanForSecrets,
  unifiedDiffToActionResults,
} from "@/lib/github/diffHygiene";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { patchStoredProposalPreview } from "@/services/canvas-turn-persistence";
import { clearActiveRun, notifyRunActive } from "@/services/canvas-active-runs-hooks";
import {
  CODE_CHANGE_PROPOSE_KIND,
  CODE_CHANGE_PROPOSE_WORKFLOW,
  type CodeChangeProposalPayload,
} from "@/lib/proposals/types";
import type { StrutRunRow } from "@/services/strut-runs";

export { CODE_CHANGE_PROPOSE_KIND, CODE_CHANGE_PROPOSE_WORKFLOW };

const LOG_TAG = "CODE_CHANGE_PROPOSE";
/** Cap on a failure message shown on the card. */
const MAX_FAILURE_CHARS = 1_000;

/** The workflow's `output` (its `pack` step). Extra keys are tolerated. */
export const codeChangeProposeOutputSchema = z
  .object({
    diff: z.string(),
    diffSha256: z.string().optional(),
    filesChanged: z.number().int().nonnegative(),
    files: z.array(z.string()).optional(),
    baseBranch: z.string().optional(),
    baseSha: z.string().optional(),
    cost: z.unknown().optional(),
  })
  .passthrough();

/** The workflow `input` the tool launched with. */
export const codeChangeProposeInputSchema = z.object({
  repo: z.string(),
  prompt: z.string(),
});

export type CodeChangePreviewPatch = Partial<CodeChangeProposalPayload>;

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function cap(message: string): string {
  return message.length > MAX_FAILURE_CHARS ? `${message.slice(0, MAX_FAILURE_CHARS)}…` : message;
}

function failed(failure: string): CodeChangePreviewPatch {
  return { preview: "failed", failure: cap(failure), pending: undefined };
}

/**
 * The card patch for a settled row — pure, so every branch is testable.
 * `scrubOutput` asks the caller to drop the diff from the row too (a
 * credential was found in it).
 */
export function previewPatchForRow(row: StrutRunRow): { patch: CodeChangePreviewPatch; scrubOutput: boolean } {
  switch (row.status) {
    case StrutRunStatus.CANCELLED:
      return { patch: { preview: "cancelled", failure: "The preview was stopped.", pending: undefined }, scrubOutput: false };
    case StrutRunStatus.LOST:
      return {
        patch: failed("Strut lost track of this run (it restarted before recording it). Try again."),
        scrubOutput: false,
      };
    case StrutRunStatus.ERROR:
      return { patch: failed(row.error || "The run failed."), scrubOutput: false };
    case StrutRunStatus.PENDING:
      // Not settled — nothing to say yet. (Never reached through completeStrutRun.)
      return { patch: {}, scrubOutput: false };
    case StrutRunStatus.SUCCESS:
      break;
  }

  const parsed = codeChangeProposeOutputSchema.safeParse(row.output);
  if (!parsed.success) {
    return { patch: failed("The run returned an unexpected result. Try again."), scrubOutput: false };
  }
  const output = parsed.data;
  const rawDiff = output.diff.trimEnd();

  if (output.filesChanged === 0 || rawDiff.length === 0) {
    return {
      patch: failed(
        "The agent finished without changing any files in the repository, so there is nothing to propose. " +
          "Try a more specific prompt.",
      ),
      scrubOutput: false,
    };
  }

  const parseResult = parseUnifiedDiff(rawDiff);
  if (!parseResult.ok) {
    return {
      patch: failed(`The run did not produce a valid unified diff (${parseResult.code}: ${parseResult.message}).`),
      scrubOutput: false,
    };
  }
  const capsResult = enforceDiffCaps(rawDiff);
  if (!capsResult.ok) {
    return {
      patch: failed(
        `The change is too large for a preview (${capsResult.code}). ` +
          "Use `propose_feature` — the feature pipeline handles large changes.",
      ),
      scrubOutput: false,
    };
  }
  const secretsResult = scanForSecrets(rawDiff);
  if (!secretsResult.ok) {
    // Hard rule: a diff containing credentials reaches neither the card
    // nor stays on the row.
    return {
      patch: failed(
        "The change contains patterns matching known credentials. " +
          "Review it manually and ensure no secrets are included before proposing.",
      ),
      scrubOutput: true,
    };
  }

  const input = codeChangeProposeInputSchema.safeParse(row.input);
  let repoName = "";
  if (input.success) {
    try {
      const { owner, repo } = parseGithubOwnerRepo(input.data.repo);
      repoName = `${owner}/${repo}`;
    } catch {
      repoName = input.data.repo;
    }
  }
  const diffs = unifiedDiffToActionResults(rawDiff, repoName);

  return {
    patch: {
      preview: "ready",
      pending: undefined,
      failure: undefined,
      diff: rawDiff,
      diffSha256: sha256Hex(rawDiff),
      filesChanged: diffs.length,
      ...(output.baseBranch ? { baseBranchDisplay: output.baseBranch } : {}),
    },
    scrubOutput: false,
  };
}

/** The `StrutRunHandler` for `code_change_propose`. Throws to be retried. */
export async function handleCodeChangeProposeSettled(row: StrutRunRow): Promise<void> {
  const { patch, scrubOutput } = previewPatchForRow(row);

  if (scrubOutput && row.output && typeof row.output === "object") {
    const { diff: _diff, ...rest } = row.output as Record<string, unknown>;
    await db.strutRun.update({
      where: { id: row.id },
      data: { output: { ...rest, diff: "", discarded: "secrets_detected" } as Prisma.InputJsonValue },
    });
    logger.error("Secret detected in a strut code-change diff — discarded", LOG_TAG, {
      runId: row.id,
      proposalId: row.proposalId,
    });
  }

  if (!row.conversationId || !row.proposalId) {
    logger.warn("Settled code-change run has no card to fill in", LOG_TAG, { runId: row.id, status: row.status });
    return;
  }

  if (Object.keys(patch).length > 0) {
    const changed = await patchStoredProposalPreview({
      conversationId: row.conversationId,
      proposalId: row.proposalId,
      patch: patch as Record<string, unknown>,
    });
    logger.info("Code-change preview delivered", LOG_TAG, {
      runId: row.id,
      proposalId: row.proposalId,
      status: row.status,
      preview: patch.preview,
      changed,
    });
  }

  // The Stop button: this run is no longer something to stop.
  try {
    const { wasLast } = await clearActiveRun(row.conversationId, row.id);
    if (wasLast) await notifyRunActive(row.conversationId, false);
  } catch (err) {
    logger.warn("clearActiveRun failed after a code-change preview (non-fatal)", LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
