"use client";

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact read-only marker chips for criterion-level quality signals.
 *
 * DISPUTED (amber) — judge's verdict was flagged as wrong (`flagged` from the
 *   judge-dispute stage). The judge's reason prose renders independently of
 *   this chip — a conceded failure with prose shows no badge.
 * CONTESTED (violet) — the criterion *definition* is considered broken
 *   (set by the contest agent; independent of verdict).
 *
 * Both chips include a tooltip explaining they reflect what *that run* recorded
 * — editing a criterion definition today does not rewrite historical runs.
 *
 * Used at every render site (RubricLedger list rows + detail panel,
 * LegalBenchmarkResults criterion rows) so the two treatments can never
 * drift apart visually.
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

interface CriterionMarkersProps {
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
  /** Additional class names for the wrapper span. */
  className?: string;
}

export function CriterionMarkers({
  disputed,
  contested,
  flagBasis,
  className,
}: CriterionMarkersProps) {
  if (!disputed && !contested) return null;

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
              className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-400 border border-violet-500/30 cursor-help"
            >
              CONTESTED
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            This criterion&apos;s definition is flagged as broken (contested in
            the rubric graph or recorded by this run). Contested criteria are
            excluded from the score.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
