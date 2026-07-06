"use client";

import React from "react";
import { impactTier, impactTooltip } from "@/lib/utils/impact-tier";

/**
 * Shared presentational pill badge for impact scores.
 * Used by both the list table (ImpactIndicator) and the detail page Impact card.
 */
export function ImpactBadge({
  score,
  meta,
}: {
  score: number | null;
  meta: Record<string, unknown> | null;
}) {
  const { label, colorClass } = impactTier(score);
  const pct = score === null ? null : Math.round(score * 100);
  const tooltip = impactTooltip(meta);
  const ariaLabel = `Impact: ${label}${pct !== null ? `, ${pct} out of 100` : ""}`;

  if (score === null) {
    return (
      <span
        className="text-muted-foreground text-xs"
        aria-label={ariaLabel}
        data-testid="impact-badge"
      >
        Not scored
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${colorClass}`}
      title={tooltip}
      aria-label={ariaLabel}
      data-testid="impact-badge"
    >
      {label} · {pct}
    </span>
  );
}
