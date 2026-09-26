/**
 * Pure model for the `swarm-systemmap-graph-materialize` output — the
 * concrete system instances the workflow tried to write into the graph:
 *
 *   observedGraph.nodes / .edges   accepted instances (validated, written)
 *   rejectedItems[]                { item, kind: "node" | "edge", reasons[] }
 *   coverage                       accepted / rejected / observed counts
 *   ontologyVersion, note, swarm_url, sessionId
 *
 * A node item is `{ id | proposed_id, type, properties: { name, … },
 * evidence[] }`; an edge item is `{ edge_type, source_id, target_id,
 * evidence[] }`. Accepted and rejected items are merged into one list each
 * with a `status`, so the views show the whole attempt: what landed, what
 * did not, and why. Unrecognised output → null (the generic renderer
 * takes over).
 */

import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";

export type MaterializedStatus = "accepted" | "rejected";
export const MATERIALIZED_STATUSES: readonly MaterializedStatus[] = ["accepted", "rejected"];

export interface MaterializedNode extends GraphNode {
  id: string;
  /** Display name: `properties.name`, else the id. */
  name: string;
  /** The ontology type, e.g. `SysWebApplication`. What the canvas colours by. */
  type: string;
  status: MaterializedStatus;
  reasons: string[];
  evidence: string[];
  properties: Record<string, unknown>;
}

export interface MaterializedEdge extends GraphEdge {
  source: string;
  target: string;
  edgeType: string;
  /** `encodeEdgeLabel(edgeType, status)` — the canvas styles from this. */
  label: string;
  status: MaterializedStatus;
  reasons: string[];
  evidence: string[];
}

export interface StatusCounts {
  accepted: number;
  rejected: number;
}

export interface MaterializedGraph {
  note: string | null;
  swarmUrl: string | null;
  sessionId: string | null;
  ontologyVersion: { hash: string | null; match: boolean | null; typeCount: number | null; edgeCount: number | null } | null;
  coverage: {
    nodes: StatusCounts;
    edges: StatusCounts;
    observedNodeTypes: number | null;
    observedEdgeTypes: number | null;
    allowedNodeTypes: number | null;
    allowedEdgeTypes: number | null;
  };
  nodes: MaterializedNode[];
  edges: MaterializedEdge[];
  /** Rejection reasons across nodes and edges, most frequent first. */
  reasons: Array<{ reason: string; count: number }>;
  /**
   * Reasons rolled up by category — the text before the first `:`
   * (`missing_required_properties:id` → `missing_required_properties`), most
   * frequent first. One run can carry dozens of distinct reasons that differ
   * only in their detail; the category is what the chips show.
   */
  reasonCategories: Array<{ category: string; count: number; variants: number }>;
  /** Edges whose endpoints are not among the nodes (accepted or proposed); kept in `edges`, not drawn. */
  danglingEdges: number;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

const LABEL_SEP = "|";

export function encodeEdgeLabel(edgeType: string, status: MaterializedStatus): string {
  return `${edgeType}${LABEL_SEP}${status}`;
}

export function decodeEdgeLabel(label: string): { edgeType: string; status: MaterializedStatus } {
  const at = label.lastIndexOf(LABEL_SEP);
  const status = at >= 0 ? label.slice(at + 1) : "";
  return { edgeType: at >= 0 ? label.slice(0, at) : label, status: status === "accepted" ? "accepted" : "rejected" };
}

function parseNode(raw: unknown, status: MaterializedStatus, reasons: string[]): MaterializedNode | null {
  if (!isObj(raw)) return null;
  const properties = isObj(raw.properties) ? raw.properties : {};
  const id = str(raw.id) ?? str(raw.proposed_id) ?? str(raw.ref_id) ?? str(raw.node_key);
  const type = str(raw.type) ?? str(raw.node_type);
  if (!id || !type) return null;
  return {
    id,
    name: str(properties.name) ?? str(raw.name) ?? id,
    type,
    status,
    reasons,
    evidence: strings(raw.evidence),
    properties,
  };
}

function parseEdge(raw: unknown, status: MaterializedStatus, reasons: string[]): MaterializedEdge | null {
  if (!isObj(raw)) return null;
  const source = str(raw.source_id) ?? str(raw.source);
  const target = str(raw.target_id) ?? str(raw.target);
  const edgeType = str(raw.edge_type) ?? str(raw.type);
  if (!source || !target || !edgeType) return null;
  return { source, target, edgeType, label: encodeEdgeLabel(edgeType, status), status, reasons, evidence: strings(raw.evidence) };
}

/** Recognise a materialize output. Null for anything else. */
export function parseMaterializedGraph(output: unknown): MaterializedGraph | null {
  if (!isObj(output)) return null;
  const observed = isObj(output.observedGraph) ? output.observedGraph : null;
  const rejected = Array.isArray(output.rejectedItems) ? output.rejectedItems : null;
  const coverage = isObj(output.coverage) ? output.coverage : null;
  if (!observed && !rejected && !coverage) return null;

  const nodes: MaterializedNode[] = [];
  const edges: MaterializedEdge[] = [];

  for (const raw of Array.isArray(observed?.nodes) ? observed.nodes : []) {
    const node = parseNode(raw, "accepted", []);
    if (node) nodes.push(node);
  }
  for (const raw of Array.isArray(observed?.edges) ? observed.edges : []) {
    const edge = parseEdge(raw, "accepted", []);
    if (edge) edges.push(edge);
  }
  for (const raw of rejected ?? []) {
    if (!isObj(raw)) continue;
    const reasons = strings(raw.reasons);
    if (raw.kind === "node") {
      const node = parseNode(raw.item, "rejected", reasons);
      if (node) nodes.push(node);
    } else if (raw.kind === "edge") {
      const edge = parseEdge(raw.item, "rejected", reasons);
      if (edge) edges.push(edge);
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  const danglingEdges = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target)).length;

  const reasonCounts = new Map<string, number>();
  for (const item of [...nodes, ...edges]) for (const r of item.reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  const reasons = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const categoryCounts = new Map<string, { count: number; variants: Set<string> }>();
  for (const { reason, count: n } of reasons) {
    const category = reasonCategory(reason);
    const entry = categoryCounts.get(category) ?? { count: 0, variants: new Set<string>() };
    entry.count += n;
    entry.variants.add(reason);
    categoryCounts.set(category, entry);
  }
  const reasonCategories = [...categoryCounts.entries()]
    .map(([category, { count: n, variants }]) => ({ category, count: n, variants: variants.size }))
    .sort((a, b) => b.count - a.count);

  const count = (status: MaterializedStatus, items: Array<{ status: MaterializedStatus }>) =>
    items.filter((i) => i.status === status).length;
  const version = isObj(output.ontologyVersion) ? output.ontologyVersion : null;

  return {
    note: str(output.note),
    swarmUrl: str(output.swarm_url),
    sessionId: str(output.sessionId),
    ontologyVersion: version
      ? {
          hash: str(version.hash),
          match: typeof version.match === "boolean" ? version.match : null,
          typeCount: num(version.typeCount),
          edgeCount: num(version.edgeCount),
        }
      : null,
    coverage: {
      nodes: { accepted: num(coverage?.nodesAccepted) ?? count("accepted", nodes), rejected: num(coverage?.nodesRejected) ?? count("rejected", nodes) },
      edges: { accepted: num(coverage?.edgesAccepted) ?? count("accepted", edges), rejected: num(coverage?.edgesRejected) ?? count("rejected", edges) },
      observedNodeTypes: num(coverage?.observedNodeTypes),
      observedEdgeTypes: num(coverage?.observedEdgeTypes),
      allowedNodeTypes: num(coverage?.allowedNodeTypes),
      allowedEdgeTypes: num(coverage?.allowedEdgeTypes),
    },
    nodes,
    edges,
    reasons,
    reasonCategories,
    danglingEdges,
  };
}

/** `missing_endpoint:source` → `missing_endpoint`; a reason without `:` is its own category. */
export function reasonCategory(reason: string): string {
  const at = reason.indexOf(":");
  return at > 0 ? reason.slice(0, at) : reason;
}

// ─── Grouping and filtering ───────────────────────────────────────────────

export interface MaterializedFilter {
  /** Empty = both statuses. */
  statuses: ReadonlySet<MaterializedStatus>;
  /** Case-insensitive substring over ids, names, types, evidence and reasons. */
  query: string;
}

function matchesText(text: string[], query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return text.some((t) => t.toLowerCase().includes(q));
}

export function nodeMatches(node: MaterializedNode, filter: MaterializedFilter): boolean {
  if (filter.statuses.size > 0 && !filter.statuses.has(node.status)) return false;
  return matchesText([node.id, node.name, node.type, ...node.evidence, ...node.reasons], filter.query);
}

export function edgeMatches(edge: MaterializedEdge, filter: MaterializedFilter): boolean {
  if (filter.statuses.size > 0 && !filter.statuses.has(edge.status)) return false;
  return matchesText([edge.source, edge.target, edge.edgeType, ...edge.evidence, ...edge.reasons], filter.query);
}

export interface NodeTypeGroup {
  type: string;
  nodes: MaterializedNode[];
  counts: StatusCounts;
}

export interface EdgeTypeGroup {
  edgeType: string;
  edges: MaterializedEdge[];
  counts: StatusCounts;
}

function statusCounts(items: Array<{ status: MaterializedStatus }>): StatusCounts {
  return {
    accepted: items.filter((i) => i.status === "accepted").length,
    rejected: items.filter((i) => i.status === "rejected").length,
  };
}

/** Nodes by ontology type, first-seen order, empty groups dropped. */
export function groupNodesByType(nodes: MaterializedNode[], filter?: MaterializedFilter): NodeTypeGroup[] {
  const groups = new Map<string, MaterializedNode[]>();
  for (const node of nodes) {
    if (filter && !nodeMatches(node, filter)) continue;
    const list = groups.get(node.type) ?? [];
    list.push(node);
    groups.set(node.type, list);
  }
  return [...groups.entries()].map(([type, list]) => ({ type, nodes: list, counts: statusCounts(list) }));
}

/** Edges by relation, first-seen order, empty groups dropped. */
export function groupEdgesByType(edges: MaterializedEdge[], filter?: MaterializedFilter): EdgeTypeGroup[] {
  const groups = new Map<string, MaterializedEdge[]>();
  for (const edge of edges) {
    if (filter && !edgeMatches(edge, filter)) continue;
    const list = groups.get(edge.edgeType) ?? [];
    list.push(edge);
    groups.set(edge.edgeType, list);
  }
  return [...groups.entries()].map(([edgeType, list]) => ({ edgeType, edges: list, counts: statusCounts(list) }));
}

// ─── Canvas ───────────────────────────────────────────────────────────────

/** Status colours for the canvas and tiles: accepted = good, rejected = critical. */
export const STATUS_HEX: Record<MaterializedStatus, string> = { accepted: "#10b981", rejected: "#f43f5e" };

/**
 * Categorical colours for node types, assigned in first-seen order and never
 * cycled: after eight, every further type shares a neutral grey.
 */
const CATEGORICAL = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"];
const OVERFLOW = "#94a3b8";

export function nodeTypeColorMap(types: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  types.forEach((type, i) => {
    map[type] = i < CATEGORICAL.length ? CATEGORICAL[i] : OVERFLOW;
  });
  return map;
}

export type CanvasColorMode = "family" | "type" | "status";

/**
 * The ontology's top-level families, in the fixed order the categorical
 * colours are assigned. The materialize output carries no parent links, so
 * a type's family is read off its name: `SysRESTEndpoint` → Interface,
 * `SysCacheInstance` → Resource, … Anything unmatched is Other.
 */
export const TYPE_FAMILIES = ["Component", "Interface", "Technology", "Resource", "Artifact", "Capability", "Protocol", "Other"] as const;
export type TypeFamily = (typeof TYPE_FAMILIES)[number];

const FAMILY_RULES: Array<[TypeFamily, RegExp]> = [
  ["Interface", /(Endpoint|Interface|Socket)$/],
  ["Capability", /Capability$/],
  ["Protocol", /Protocol$/],
  ["Technology", /(Technology|Language|CloudService|Framework|Library|Runtime)$/],
  ["Component", /(Application|Component|Service)$/],
  ["Artifact", /(Artifact|File|Image|Package|Binary|Manifest|Repository|Document|Record|Log|Metric|Trace|Definition)$/],
  ["Resource", /(Instance|Resource|Machine|Variable|Value|Secret|Token|Certificate|Credential|Key|Account|Network|Subnet|Port|IPAddress|DNSName|Group|Stream|Store|Bucket)$/],
];

export function typeFamily(type: string): TypeFamily {
  for (const [family, re] of FAMILY_RULES) if (re.test(type)) return family;
  return "Other";
}

export const FAMILY_COLOR_MAP: Record<string, string> = Object.fromEntries(
  TYPE_FAMILIES.map((family, i) => [family, i < 7 ? CATEGORICAL[i] : OVERFLOW]),
);

/** What the shared canvas draws: nodes typed by the chosen mode, edges among kept nodes. */
export function buildCanvasElements(
  graph: MaterializedGraph,
  filter: MaterializedFilter,
  mode: CanvasColorMode,
): { nodes: GraphNode[]; edges: GraphEdge[]; colorMap: Record<string, string> } {
  const kept = graph.nodes.filter((n) => nodeMatches(n, filter));
  const ids = new Set(kept.map((n) => n.id));
  const nodes: GraphNode[] = kept.map((n) => ({
    ...n,
    // The canvas prints `type` under the circle and colours by it.
    type:
      mode === "status"
        ? n.status === "accepted"
          ? "Accepted"
          : "Rejected"
        : mode === "family"
          ? typeFamily(n.type)
          : n.type.replace(/^Sys/, ""),
    name: n.name,
  }));
  const edges: GraphEdge[] = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && edgeMatches(e, filter))
    .map((e) => ({ source: e.source, target: e.target, label: e.label }));
  const colorMap =
    mode === "status"
      ? { Accepted: STATUS_HEX.accepted, Rejected: STATUS_HEX.rejected }
      : mode === "family"
        ? Object.fromEntries(TYPE_FAMILIES.filter((f) => kept.some((n) => typeFamily(n.type) === f)).map((f) => [f, FAMILY_COLOR_MAP[f]]))
        : nodeTypeColorMap([...new Set(kept.map((n) => n.type.replace(/^Sys/, "")))]);
  return { nodes, edges, colorMap };
}

/** The canvas's `edgeStyleFn`: accepted solid in the status colour, rejected dashed grey. */
export function edgeStyleForLabel(label: string): { stroke: string; strokeWidth?: number; strokeDasharray?: string } {
  const { status } = decodeEdgeLabel(label);
  return status === "accepted"
    ? { stroke: STATUS_HEX.accepted, strokeWidth: 2 }
    : { stroke: "#94a3b8", strokeWidth: 1.5, strokeDasharray: "4 3" };
}
