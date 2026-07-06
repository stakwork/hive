/**
 * Shared helpers for rendering error impact scores as tiered labels.
 */

export type ImpactTierLabel = "High" | "Medium" | "Low" | "Not scored";

export interface ImpactTierResult {
  label: ImpactTierLabel;
  colorClass: string;
}

/**
 * Maps a [0,1] impact score (or null) to a named tier with Tailwind color classes.
 */
export function impactTier(score: number | null): ImpactTierResult {
  if (score === null) {
    return { label: "Not scored", colorClass: "text-muted-foreground" };
  }
  const pct = Math.round(score * 100);
  if (pct >= 66) {
    return { label: "High", colorClass: "bg-destructive/80 text-destructive-foreground" };
  }
  if (pct >= 33) {
    return { label: "Medium", colorClass: "bg-orange-500/80 text-white" };
  }
  return { label: "Low", colorClass: "bg-muted text-muted-foreground" };
}

/**
 * Builds a structured hover tooltip string from impactMeta.
 * Returns undefined when meta is null or topNodeName is absent.
 * Never throws — each field is narrowed at runtime before use.
 */
export function impactTooltip(meta: Record<string, unknown> | null): string | undefined {
  if (!meta) return undefined;

  const topNodeName = typeof meta.topNodeName === "string" ? meta.topNodeName : undefined;
  if (!topNodeName) return undefined;

  const topNodeType = typeof meta.topNodeType === "string" ? meta.topNodeType : undefined;
  const topPagerank =
    typeof meta.topPagerank === "number" && isFinite(meta.topPagerank)
      ? meta.topPagerank
      : undefined;
  const nodeCount = typeof meta.nodeCount === "number" ? meta.nodeCount : undefined;

  const nameSegment = topNodeType ? `${topNodeName} (${topNodeType})` : topNodeName;
  const centralitySegment =
    topPagerank !== undefined ? `centrality ${topPagerank.toFixed(2)}` : undefined;
  const locationSegment =
    nodeCount !== undefined ? `${nodeCount} code locations referenced` : undefined;

  const parts = [nameSegment, centralitySegment, locationSegment].filter(Boolean);
  return `Most-connected code touched: ${parts.join(" · ")}`;
}

/**
 * One-sentence explanation of what Impact means — shared across list and detail pages.
 */
export const IMPACT_EXPLANATION =
  "Impact estimates an error's blast radius — how central the affected code is in your codebase, based on PageRank. Errors in heavily-used code rank higher, so you can fix what matters most first.";
