/**
 * Central registry for Legal Benchmarks graph styling.
 *
 * Used across both the 2D force-directed view (Graph2DView + GraphVisualization)
 * and the 3D canvas (GraphView via colorMap), and by stakgraphToRawGraph for
 * node-type classification.
 */

// ── Node colors ─────────────────────────────────────────────────────────────

/**
 * Canonical PascalCase → hex color for every legal graph node type.
 *
 * EvalTriggerOutput has three sub-variants (pass / fail / partial) because
 * the Cypher result carries eval_status and score fields that allow us to
 * distinguish them at parse time.
 */
export const LEGAL_NODE_COLORS: Record<string, string> = {
  EvalSet: "#3b82f6",
  BaselineTrigger: "#6b7280",
  EvalTrigger: "#14b8a6",
  EvalTriggerOutput_pass: "#22c55e",
  EvalTriggerOutput_fail: "#ef4444",
  EvalTriggerOutput_partial: "#f59e0b",
  ProposedFix: "#a855f7",
  EvalRequirement: "#6366f1",
};

// ── Node icons ───────────────────────────────────────────────────────────────

/**
 * Emoji / unicode icon rendered inside each node circle for legal node types.
 * Keys mirror LEGAL_NODE_COLORS exactly so a single lookup suffices.
 */
export const LEGAL_NODE_ICONS: Record<string, string> = {
  EvalSet: "📋",
  BaselineTrigger: "🔖",
  EvalTrigger: "▶",
  EvalTriggerOutput_pass: "✓",
  EvalTriggerOutput_fail: "✗",
  EvalTriggerOutput_partial: "~",
  ProposedFix: "🔧",
  EvalRequirement: "📌",
};

// ── Edge styles ──────────────────────────────────────────────────────────────

export interface EdgeStyle {
  stroke: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}

/**
 * Stroke style per relationship type.
 *
 * HAS_OUTPUT is intentionally absent here — its stroke color should match the
 * *source* node's color, so the caller resolves it dynamically via `sourceType`.
 */
export const LEGAL_EDGE_STYLES: Record<string, EdgeStyle> = {
  HAS_TRIGGER: { stroke: "#374151" },
  HAS_BASELINE_TRIGGER: { stroke: "#374151" },
  HAS_PROPOSED_FIX: { stroke: "#a855f7", strokeDasharray: "5,4" },
  DERIVED_FROM: { stroke: "#9ca3af", strokeDasharray: "2,4" },
  HAS_REQUIREMENT: { stroke: "#6366f1", strokeWidth: 1 },
};

/**
 * Resolve the edge style for a given relationship label.
 * For HAS_OUTPUT, the stroke is derived from the source node's color.
 */
export function resolveEdgeStyle(label: string, sourceType?: string): EdgeStyle | undefined {
  if (label === "HAS_OUTPUT") {
    // Stroke matches the source node — fall back to a neutral gray
    const stroke = (sourceType && LEGAL_NODE_COLORS[sourceType]) ?? "#6b7280";
    return { stroke };
  }
  return LEGAL_EDGE_STYLES[label];
}

// ── Output node classification ───────────────────────────────────────────────

/**
 * Classify an EvalTriggerOutput node into pass / fail / partial based on
 * its flat Cypher row-cell properties.
 *
 * Decision order:
 *  1. eval_status === "accepted"  → pass
 *  2. eval_status === "rejected"  → fail
 *  3. n_passed / n_total ratio    → pass (≥ threshold) or partial
 *  4. Default                     → partial
 */
export function classifyOutputNodeType(properties: Record<string, unknown>): string {
  const evalStatus = properties.eval_status;
  if (evalStatus === "accepted") return "EvalTriggerOutput_pass";
  if (evalStatus === "rejected") return "EvalTriggerOutput_fail";

  const nPassed = Number(properties.n_passed);
  const nTotal = Number(properties.n_total);
  if (nTotal > 0) {
    // Threshold mirrors hill-climb-series.ts: all-pass ≥ 1.0
    return nPassed / nTotal >= 1.0
      ? "EvalTriggerOutput_pass"
      : "EvalTriggerOutput_partial";
  }

  return "EvalTriggerOutput_partial";
}

// ── Case normalisation ───────────────────────────────────────────────────────

/**
 * Lowercase → canonical PascalCase mapping for legal node types that may
 * arrive with inconsistent casing from the graph DB (e.g. "Evalset" → "EvalSet").
 *
 * Non-legal types are not listed here so they fall through unchanged.
 */
export const LEGAL_NODE_TYPE_CANONICAL: Record<string, string> = {
  evalset: "EvalSet",
  evaltrigger: "EvalTrigger",
  evaltriggeroutput: "EvalTriggerOutput",
  proposedfix: "ProposedFix",
  evalrequirement: "EvalRequirement",
  baselinetrigger: "BaselineTrigger",
};
