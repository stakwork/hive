"use client";

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContestedOriginToken } from "@/lib/harvey-lab/rubric-scoring";
import { contestedNotice } from "@/lib/harvey-lab/contested-copy";

/**
 * Compact read-only marker chips for criterion-level quality signals.
 *
 * DISPUTED (amber) — judge's verdict was flagged as wrong (`flagged` from the
 *   judge-dispute stage). The judge's reason prose renders independently of
 *   this chip — a conceded failure with prose shows no badge.
 * CONTESTED (violet) — the criterion *definition* is considered broken
 *   (set by the contest agent; independent of verdict).
 * PRIOR CONTEST (muted violet, dashed) — contested only in the rubric roster
 *   from a previous run; this run's judge never contested it.
 *
 * Both chips include a tooltip explaining they reflect what *that run* recorded
 * — editing a criterion definition today does not rewrite historical runs.
 *
 * Used at every render site (RubricLedger list rows + detail panel,
 * LegalBenchmarkResults criterion rows) so the two treatments can never
 * drift apart visually.
 *
 * ### Origin-aware chip (additive, non-breaking)
 * Pass `contestedOrigin` to get label/tooltip driven by `contestedNotice()`.
 * When omitted the component renders exactly as before ("CONTESTED", existing
 * tooltip) — all existing call sites and `contested={true}` test assertions
 * stay green without modification.
 */

/**
 * Maps a normalised `flagBasis` token to human-readable tooltip copy.
 * Unknown tokens are humanised (underscores → spaces, sentence case) rather
 * than dropped — per the gap note the resolver preserves unknown tokens, and
 * the UI must not leak raw snake_case strings.
 */
function flagBasisCopy(basis: string): string {
  switch (basis) {
    case "criterion_validity":
      return "the criterion definition itself is disputed";
    case "judge_error":
      return "the judge is believed to have made an error";
    case "legitimate_failure":
      return "the failure was judged legitimate by the dispute reviewer";
    case "indeterminate":
      return "the dispute outcome is indeterminate";
    default: {
      // Humanise unknown tokens: underscores → spaces, sentence case.
      const spaced = basis.replace(/_/g, " ");
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
  }
}

/** Legacy tooltip used when no `contestedOrigin` is supplied. */
const LEGACY_CONTESTED_TOOLTIP =
  "This criterion's definition is flagged as broken (contested in the rubric graph or recorded by this run). Contested criteria are excluded from the score.";

export interface CriterionMarkersProps {
  /** Whether to show the DISPUTED (amber) chip. Gated on `flagged` alone. */
  disputed?: boolean;
  /** Whether to show the CONTESTED (violet) chip. */
  contested?: boolean;
  /**
   * Normalised `flag_basis` from the resolver (trimmed + lowercased, or null).
   * When non-empty, appended to the DISPUTED tooltip as basis-specific copy.
   * Never a suppression input — `disputed` prop controls chip visibility.
   */
  flagBasis?: string | null;
  /**
   * Origin token from `contestedOriginToken()`. When provided, drives the
   * chip label and tooltip via `contestedNotice()`. When absent the component
   * behaves byte-identically to the pre-origin version.
   */
  contestedOrigin?: ContestedOriginToken | null;
  /**
   * Contest reason from `resolveContestReason()`. Currently always null (no
   * producer emits a contest-reason field yet). Passed through to
   * `contestedNotice()` so the slot is wired for when a producer starts
   * emitting one.
   */
  contestedReason?: string | null;
  /**
   * The criterion's verdict string — forwarded to `contestedNotice()` so the
   * roster-only tooltip variant can pick the right second sentence.
   */
  contestedVerdict?: string;
  /**
   * Whether the roster match was by "id" or "title". Forwarded to
   * `contestedNotice()` for hedged provenance copy on title matches.
   */
  contestedMatchedBy?: "id" | "title" | null;
  /** Additional class names for the wrapper span. */
  className?: string;
}

export function CriterionMarkers({
  disputed,
  contested,
  flagBasis,
  contestedOrigin,
  contestedReason,
  contestedVerdict,
  contestedMatchedBy,
  className,
}: CriterionMarkersProps) {
  if (!disputed && !contested) return null;

  // ── Contested chip ─────────────────────────────────────────────────────────
  // When `contestedOrigin` is provided, drive label/tooltip from contestedNotice.
  // When absent, fall back to the legacy hardcoded strings so existing call
  // sites and tests are byte-identical.
  let contestedLabel = "CONTESTED";
  let contestedTooltip = LEGACY_CONTESTED_TOOLTIP;

  if (contested && contestedOrigin) {
    const notice = contestedNotice({
      origin: contestedOrigin,
      verdict: contestedVerdict,
      reason: contestedReason,
      matchedBy: contestedMatchedBy,
    });
    contestedLabel = notice.label;
    contestedTooltip = notice.tooltip;
  }

  // ── Styling per origin ─────────────────────────────────────────────────────
  // `roster`  → muted/dashed violet (lighter background, dashed border) to
  //             reinforce "not this run's judge".
  // `both`    → full-strength violet with CONTESTED label plus a trailing dot
  //             and a distinct double-border treatment so it is NOT pixel-
  //             identical to plain `in-run` on the rail (must be visible without
  //             hovering).
  // `in-run` / `unknown` / absent → today's solid violet, no extras.
  function contestedBadgeClasses(): string {
    const base =
      "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] font-semibold cursor-help";
    if (contestedOrigin === "roster") {
      return `${base} bg-violet-500/8 text-violet-600 dark:text-violet-500/80 border border-dashed border-violet-400/40`;
    }
    if (contestedOrigin === "both") {
      return `${base} bg-violet-500/15 text-violet-700 dark:text-violet-400 border-2 border-violet-500/50 ring-1 ring-violet-400/20`;
    }
    // in-run, unknown, or no origin supplied
    return `${base} bg-violet-500/15 text-violet-700 dark:text-violet-400 border border-violet-500/30`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
    >
      {disputed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="criterion-disputed-badge"
              className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 cursor-help"
            >
              DISPUTED
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-xs text-xs"
            data-testid="criterion-disputed-tooltip"
          >
            The judge&apos;s scoring was flagged as potentially wrong. Reflects
            what this run recorded — editing the criterion today does not
            rewrite historical runs.
            {flagBasis && flagBasis.length > 0 && (
              <span
                className="block mt-1 text-amber-300/80"
                data-testid="criterion-dispute-basis"
              >
                Basis: {flagBasisCopy(flagBasis)}.
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      )}
      {contested && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="criterion-contested-badge"
              data-contested-origin={contestedOrigin ?? undefined}
              className={contestedBadgeClasses()}
            >
              {contestedLabel}
              {/* Persistent visual marker for `both` — a trailing dot visible
                  without hovering, satisfying the rail-distinguishability
                  requirement. */}
              {contestedOrigin === "both" && (
                <span
                  aria-hidden="true"
                  data-testid="criterion-contested-both-marker"
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-violet-400/70 shrink-0"
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs whitespace-pre-line">
            {contestedTooltip}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
