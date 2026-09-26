/**
 * Pure graph model for the System Map report's Graph tab, feeding the
 * shared force-directed 2D view (`components/graph/GraphVisualization`,
 * the Graph Explorer's Neo4j-style canvas).
 *
 * - One node per ontology type. The view colours nodes by `type` and
 *   prints it under the circle, so `type` is the human verdict label
 *   ("Match", "Missing", …) and `colorMap` maps those to the status hexes.
 * - CHILD_OF edges are the structure, parent → child; the view draws them
 *   thin and grey, dashed when the link is not MATCH in the graph.
 * - Relation edges (CALLS, USES_TECHNOLOGY, …) carry their verdict colour.
 *   The view styles an edge from its `label` alone, and never renders the
 *   label, so the label carries both the relation and the verdict
 *   (`encodeEdgeLabel`). MISSING relations are dropped unless asked for —
 *   23 grey lines between seven roots is a hairball that says nothing.
 * - The report filter REMOVES what it misses (plus keeps the ancestors of a
 *   match, like the list view) — the force layout re-settles on the
 *   smaller set, which reads better than dimming in a hairball.
 */

import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";
import type { EdgeStyle } from "@/components/graph/graphUtils";
import {
  buildTypeTree,
  filterTypeTree,
  VERDICTS,
  type ReportEdge,
  type ReportFilter,
  type ReportNodeType,
  type SystemMapReport,
  type TypeTreeNode,
  type Verdict,
} from "./model";

export const HIERARCHY_EDGE_TYPE = "CHILD_OF";

/** Human verdict labels — what the view prints under each node and colours by. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  MATCH: "Match",
  PARTIAL: "Partial",
  MISSING: "Missing",
  UNKNOWN: "Unknown",
  CONFLICT: "Conflict",
};

/** SVG strokes need literal colours; these are the Tailwind 500 steps the badges use. */
export const VERDICT_HEX: Record<Verdict, string> = {
  MATCH: "#10b981",
  PARTIAL: "#f59e0b",
  MISSING: "#94a3b8",
  UNKNOWN: "#0ea5e9",
  CONFLICT: "#f43f5e",
};

/** `colorMap` for the view: verdict label → hex. */
export const VERDICT_COLOR_MAP: Record<string, string> = Object.fromEntries(
  VERDICTS.map((v) => [VERDICT_LABEL[v], VERDICT_HEX[v]]),
);

export interface ReportGraphNode extends GraphNode {
  /** The verdict label, what the view colours by. */
  type: string;
  verdict: Verdict;
  item: ReportNodeType;
}

export interface ReportGraphEdge extends GraphEdge {
  /** `encodeEdgeLabel(edgeType, verdict)` — the view styles from this. */
  label: string;
  edgeType: string;
  verdict: Verdict;
}

export interface GraphBuildOptions {
  filter: ReportFilter;
  /** Include MISSING relation edges (hierarchy edges are always included). */
  showMissingRelations: boolean;
}

export interface GraphElements {
  nodes: ReportGraphNode[];
  edges: ReportGraphEdge[];
  /** Relation edges hidden because they are MISSING and not requested. */
  hiddenMissingRelations: number;
}

const LABEL_SEP = "|";

export function encodeEdgeLabel(edgeType: string, verdict: Verdict): string {
  return `${edgeType}${LABEL_SEP}${verdict}`;
}

export function decodeEdgeLabel(label: string): { edgeType: string; verdict: Verdict } {
  const at = label.lastIndexOf(LABEL_SEP);
  const verdict = at >= 0 ? label.slice(at + 1) : "";
  return {
    edgeType: at >= 0 ? label.slice(0, at) : label,
    verdict: (VERDICTS as readonly string[]).includes(verdict) ? (verdict as Verdict) : "MISSING",
  };
}

/** The view's `edgeStyleFn`: hierarchy grey and thin, relations in their verdict colour. */
export function edgeStyleForLabel(label: string): EdgeStyle {
  const { edgeType, verdict } = decodeEdgeLabel(label);
  if (edgeType === HIERARCHY_EDGE_TYPE) {
    return { stroke: VERDICT_HEX.MISSING, strokeWidth: 1, strokeDasharray: verdict === "MATCH" ? undefined : "4 3" };
  }
  const missing = verdict === "MISSING";
  return { stroke: VERDICT_HEX[verdict], strokeWidth: missing ? 1.5 : 2.5, strokeDasharray: missing ? "4 3" : undefined };
}

function keptTypeIds(tree: TypeTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (node: TypeTreeNode) => {
    ids.add(node.item.type);
    node.children.forEach(walk);
  };
  tree.forEach(walk);
  return ids;
}

function relationMatches(edge: ReportEdge, filter: ReportFilter): boolean {
  if (filter.verdicts.size > 0 && !filter.verdicts.has(edge.verdict)) return false;
  if (!filter.query) return true;
  const q = filter.query.toLowerCase();
  return [edge.edge_type, edge.source_type, edge.target_type, edge.reason ?? "", ...edge.evidence].some((t) =>
    t.toLowerCase().includes(q),
  );
}

/** Nodes and edges for the view, already reduced to what the filter keeps. */
export function buildGraphElements(report: SystemMapReport, opts: GraphBuildOptions): GraphElements {
  const kept = keptTypeIds(filterTypeTree(buildTypeTree(report.nodeTypes), opts.filter));

  const nodes: ReportGraphNode[] = report.nodeTypes
    .filter((item) => kept.has(item.type))
    .map((item) => ({
      id: item.type,
      name: item.type.replace(/^Sys/, ""),
      type: VERDICT_LABEL[item.verdict],
      verdict: item.verdict,
      item,
    }));

  const edges: ReportGraphEdge[] = [];
  let hiddenMissingRelations = 0;
  for (const edge of report.edges) {
    if (!kept.has(edge.source_type) || !kept.has(edge.target_type)) continue;
    const label = encodeEdgeLabel(edge.edge_type, edge.verdict);
    if (edge.edge_type === HIERARCHY_EDGE_TYPE) {
      // The report's CHILD_OF points child → parent; draw parent → child.
      edges.push({ source: edge.target_type, target: edge.source_type, label, edgeType: edge.edge_type, verdict: edge.verdict });
      continue;
    }
    if (edge.verdict === "MISSING" && !opts.showMissingRelations) {
      hiddenMissingRelations++;
      continue;
    }
    // A relation the filter misses is dropped like a node would be; its
    // endpoints stay if they were kept on their own.
    if (!relationMatches(edge, opts.filter)) continue;
    edges.push({ source: edge.source_type, target: edge.target_type, label, edgeType: edge.edge_type, verdict: edge.verdict });
  }

  return { nodes, edges, hiddenMissingRelations };
}
