/**
 * RubricBreakdownStrip — shared presentational strip for Pass/Contested/Disputed/Total.
 *
 * HOOK-FREE CONSTRAINT: This component must never use React hooks, "use client",
 * or Radix UI primitives. It is imported by `render-offline.tsx` which calls
 * `renderToStaticMarkup` in a server/Node environment without a browser context,
 * and the offline archive's CSP only permits `viewer.js`. Any hook or Radix
 * tooltip would break the offline export path. Use plain `title` attributes for
 * explanatory copy — exactly like the existing `run-report-contested-annotation`.
 */

import React from "react";
import type { RubricBreakdown } from "@/lib/harvey-lab/rubric-scoring";

export interface RubricBreakdownStripProps {
  breakdown: RubricBreakdown | null;
  /**
   * "full"    — renders Pass + Contested + Total chips, plus the Disputed overlay tag.
   * "compact" — renders the Contested chip (only when contested > 0) and the Disputed tag;
   *             Pass/Total are carried in the chip title string. Used by Runs tab /
   *             workflow-benchmarks to avoid duplicating or contradicting the existing
   *             fraction display.
   */
  variant?: "full" | "compact";
}

/** Render the Disputed overlay tag. `null | undefined` both produce "—". */
function DisputedTag({ value }: { value: number | null | undefined }) {
  const display = value == null ? "—" : String(value);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-violet-500"
      data-testid="rubric-breakdown-disputed"
      title={
        value == null
          ? "Disputed count is unknown — this run did not go through the judge-dispute stage, or per-criterion dispute fields are absent"
          : `${value} criterion${value !== 1 ? "a" : ""} flagged for judge review (Disputed overlaps the other buckets; it is not a summand)`
      }
    >
      {display} disputed
    </span>
  );
}

export function RubricBreakdownStrip({ breakdown, variant = "full" }: RubricBreakdownStripProps) {
  if (!breakdown) return null;

  const { pass, contested, total, disputed, totalSource } = breakdown;

  const totalTitle =
    totalSource === "run"
      ? `${total} total criteria (run-reported — no graph roster was available to verify this count)`
      : `${total} total criteria in the rubric roster (graph-sourced)`;

  if (variant === "compact") {
    // Compact: Contested chip (when present) + Disputed tag. Pass/Total in title.
    const compactTitle = `${pass} passed · ${contested} contested · ${total} total${totalSource === "run" ? " (run-reported)" : ""}`;
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {contested > 0 && (
          <span
            className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-violet-500"
            data-testid="rubric-breakdown-contested"
            title={compactTitle}
          >
            +{contested} contested
          </span>
        )}
        <DisputedTag value={disputed} />
      </span>
    );
  }

  // Full variant: Pass + Contested + Total chips + Disputed tag.
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <span
        className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-emerald-600"
        data-testid="rubric-breakdown-pass"
        title={`${pass} criteria passed (non-contested)`}
      >
        {pass} pass
      </span>
      <span
        className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-violet-500"
        data-testid="rubric-breakdown-contested"
        title={`${contested} contested criteria excluded from scoring entirely. ${total} total criteria.`}
      >
        {contested} contested
      </span>
      <span
        className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70"
        data-testid="rubric-breakdown-total"
        title={totalTitle}
      >
        {total} total
      </span>
      <DisputedTag value={disputed} />
    </div>
  );
}
