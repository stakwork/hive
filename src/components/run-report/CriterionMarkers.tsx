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
 * DISPUTED (amber) — judge's scoring may be wrong (`flagged`/`llm_flag_reason`
 *   from the judge-dispute stage).
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

interface CriterionMarkersProps {
  /** Whether to show the DISPUTED (amber) chip. */
  disputed?: boolean;
  /** Whether to show the CONTESTED (violet) chip. */
  contested?: boolean;
  /** Additional class names for the wrapper span. */
  className?: string;
}

export function CriterionMarkers({
  disputed,
  contested,
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
          <TooltipContent side="top" className="max-w-xs text-xs">
            The judge&apos;s scoring was flagged as potentially wrong. Reflects
            what this run recorded — editing the criterion today does not
            rewrite historical runs.
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
