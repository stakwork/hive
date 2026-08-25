/**
 * Pure copy-helper for contested-criterion chips.
 *
 * Converts a `ContestedOriginToken` plus optional verdict/reason/matchedBy
 * into a `{ label, tooltip }` pair that every surface (RubricLedger,
 * LegalBenchmarkResults, ConsolidatedReportView, render-offline) renders
 * identically — no surface reimplements its own strings.
 *
 * Invariants enforced (and pinned by unit tests):
 *   • Every tooltip contains the word "contested" (case-insensitive) so the
 *     chip stays semantically tied to the "+N contested" score annotation.
 *   • No branch emits a string asserting a rationale does not exist; when
 *     `reason` is null/empty it is simply omitted, never replaced with
 *     "no reason available" or similar.
 *   • The `reason` slot is a forward-compatible extension point: when a
 *     producer starts emitting a contest-reason field it slots in here without
 *     any redesign.
 *
 * Pure module — no IO, no imports from React or browser globals.
 */

import type { ContestedOriginToken } from "./rubric-scoring";

/**
 * Existing tooltip text used for the undifferentiated CONTESTED chip. Kept
 * verbatim so `"unknown"` and `"in-run"` origins preserve today's copy.
 */
const BASE_CONTESTED_TOOLTIP =
  "This criterion's definition is contested — flagged as broken or disputed at the rubric level. " +
  "It is excluded from the score on both sides: neither counted as a pass nor as a failure.";

/** True when `verdict` represents a real judged outcome (not empty / "?"). */
function isRealVerdict(verdict: string | undefined): boolean {
  if (!verdict) return false;
  const v = verdict.trim();
  return v.length > 0 && v !== "?";
}

/**
 * Produce the label and tooltip for a contested-criterion chip.
 *
 * @param origin     - The resolved `ContestedOriginToken` for this criterion.
 * @param verdict    - The criterion's run verdict string (optional; used to
 *                     pick between roster-only tooltip variants).
 * @param reason     - A contest-reason string from the producer (optional;
 *                     appended to in-run/both tooltips when non-empty). Callers
 *                     pass `resolveContestReason(criterion)` here, which returns
 *                     null today — the slot is wired for the future.
 * @param matchedBy  - Whether the roster match was by "id" or "title"
 *                     (optional; triggers hedged copy for title matches).
 */
export function contestedNotice(input: {
  origin: ContestedOriginToken;
  verdict?: string;
  reason?: string | null;
  matchedBy?: "id" | "title" | null;
}): { label: string; tooltip: string } {
  const { origin, verdict, reason, matchedBy } = input;
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  const hasReason = trimmedReason.length > 0;

  switch (origin) {
    case "in-run": {
      const tooltip = hasReason
        ? `${BASE_CONTESTED_TOOLTIP}\n\n${trimmedReason}`
        : BASE_CONTESTED_TOOLTIP;
      return { label: "CONTESTED", tooltip };
    }

    case "both": {
      const rosterLine =
        "The rubric roster from the graph independently flags this criterion as contested.";
      const base = hasReason
        ? `${BASE_CONTESTED_TOOLTIP}\n\n${trimmedReason}`
        : BASE_CONTESTED_TOOLTIP;
      return { label: "CONTESTED", tooltip: `${base}\n\n${rosterLine}` };
    }

    case "roster": {
      // Core sentence: flagged from a previous run.
      const provenanceClause =
        matchedBy === "title"
          ? "Flagged contested in the rubric roster from a previous run (matches a contested rubric definition by title)."
          : "Flagged contested in the rubric roster from a previous run.";

      // Second sentence depends on whether this run judged the criterion.
      const judgementClause = isRealVerdict(verdict)
        ? "This run's judge did not contest it."
        : "Not judged in this run. Excluded from the score.";

      // Append the contest rationale when one is available, so roster-only
      // rows (which are non-interactive and have no expandable card) surface
      // the rationale via the badge tooltip — their only affordance.
      const reasonClause = hasReason ? `\n\n${trimmedReason}` : "";

      return {
        label: "PRIOR CONTEST",
        tooltip: `${provenanceClause} ${judgementClause}${reasonClause}`,
      };
    }

    case "unknown":
    default: {
      // Roster was unavailable — render exactly today's undifferentiated chip
      // without claiming any origin provenance.
      return { label: "CONTESTED", tooltip: BASE_CONTESTED_TOOLTIP };
    }
  }
}
