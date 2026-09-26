/**
 * Pure model for the `swarm-systemmap-graph-materialize` output: the real
 * system nodes and edges the workflow wrote into the workspace graph.
 *
 * The output shape is the workflow's to decide, so the parser is lenient:
 * it looks for the first object (up to three levels deep — `output`,
 * `output.result`, `output.result.graph`, …) carrying a `nodes` and/or
 * `edges` array, and reads each item through a few common spellings
 * (`id` / `ref_id` / `node_key`, `name` / `label` / `title`, `type` /
 * `node_type` / `labels[0]`, `source` / `from` / `source_ref_id`, …).
 * Anything numeric at the top level of that object (`created`, `counts`,
 * `stats`, …) is surfaced as stat tiles. Unrecognised output → null, and
 * the generic renderer takes over.
 */

import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";

export interface MaterializedNode extends GraphNode {
  id: string;
  name: string;
  type: string;
  /** Everything else the workflow said about the node, for the detail card. */
  properties: Record<string, unknown>;
}

export interface MaterializedEdge extends GraphEdge {
  source: string;
  target: string;
  /** The relation, e.g. `RUNS_ON`; what the view labels and styles by. */
  label: string;
  properties: Record<string, unknown>;
}

export interface MaterializedGraph {
  nodes: MaterializedNode[];
  edges: MaterializedEdge[];
  /** Node count per type, first-seen order. */
  nodeTypes: Array<{ type: string; count: number }>;
  /** Edge count per relation, first-seen order. */
  edgeTypes: Array<{ type: string; count: number }>;
  /** Top-level numbers next to the arrays (`created`, `skipped`, …). */
  stats: Array<{ label: string; value: number }>;
  /** A top-level string the workflow used for prose (`summary`, `note`, `markdown`). */
  note: string | null;
  /** Edges dropped because an endpoint was not among the nodes. */
  danglingEdges: number;
}

const NODE_ID_KEYS = ["id", "ref_id", "refId", "node_key", "nodeKey", "key"];
const NODE_NAME_KEYS = ["name", "label", "title", "node_key", "nodeKey", "id"];
const NODE_TYPE_KEYS = ["type", "node_type", "nodeType", "label", "kind"];
const EDGE_SOURCE_KEYS = ["source", "from", "source_ref_id", "sourceRefId", "source_id", "sourceId", "start"];
const EDGE_TARGET_KEYS = ["target", "to", "target_ref_id", "targetRefId", "target_id", "targetId", "end"];
const EDGE_TYPE_KEYS = ["edge_type", "edgeType", "type", "label", "relationship", "relation", "kind"];
const NOTE_KEYS = ["summary", "note", "markdown", "message", "text"];
const GRAPH_CONTAINER_KEYS = ["nodes", "edges", "relationships", "links"];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function firstString(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** `labels: ["Function"]` (Neo4j style) → the first label. */
function firstLabel(o: Obj): string | null {
  const labels = o.labels;
  return Array.isArray(labels) && typeof labels[0] === "string" ? labels[0] : null;
}

function endpointId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isObj(v)) return firstString(v, NODE_ID_KEYS);
  return null;
}

function without(o: Obj, keys: string[]): Obj {
  const rest: Obj = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) rest[k] = v;
  return rest;
}

/** Depth-first search for the object that holds the arrays. */
function findGraphContainer(value: unknown, depth = 0): Obj | null {
  if (!isObj(value) || depth > 3) return null;
  if (GRAPH_CONTAINER_KEYS.some((k) => Array.isArray(value[k]))) return value;
  for (const v of Object.values(value)) {
    const found = findGraphContainer(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseNode(raw: unknown, index: number): MaterializedNode | null {
  if (!isObj(raw)) return null;
  const props = isObj(raw.properties) ? raw.properties : {};
  const merged: Obj = { ...props, ...raw };
  const id = firstString(merged, NODE_ID_KEYS) ?? firstString(props, NODE_ID_KEYS);
  const name = firstString(merged, NODE_NAME_KEYS) ?? id ?? `node-${index}`;
  const type = firstLabel(raw) ?? firstString(raw, NODE_TYPE_KEYS) ?? firstString(props, NODE_TYPE_KEYS) ?? "Node";
  if (!id) return null;
  return {
    id,
    name,
    type,
    properties: without(merged, [...NODE_ID_KEYS, ...NODE_NAME_KEYS, ...NODE_TYPE_KEYS, "labels", "properties"]),
  };
}

function parseEdge(raw: unknown): MaterializedEdge | null {
  if (!isObj(raw)) return null;
  const props = isObj(raw.properties) ? raw.properties : {};
  const merged: Obj = { ...props, ...raw };
  let source: string | null = null;
  let target: string | null = null;
  for (const k of EDGE_SOURCE_KEYS) if (source === null) source = endpointId(merged[k]);
  for (const k of EDGE_TARGET_KEYS) if (target === null) target = endpointId(merged[k]);
  if (!source || !target) return null;
  return {
    source,
    target,
    label: firstString(raw, EDGE_TYPE_KEYS) ?? firstString(props, EDGE_TYPE_KEYS) ?? "RELATED_TO",
    properties: without(merged, [...EDGE_SOURCE_KEYS, ...EDGE_TARGET_KEYS, ...EDGE_TYPE_KEYS, "properties"]),
  };
}

function countBy(items: Array<{ key: string }>): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { key } of items) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

/** Recognise a materialize output. Null for anything else. */
export function parseMaterializedGraph(output: unknown): MaterializedGraph | null {
  const container = findGraphContainer(output);
  if (!container) return null;

  const rawNodes = Array.isArray(container.nodes) ? container.nodes : [];
  const rawEdges = (["edges", "relationships", "links"] as const).flatMap((k) =>
    Array.isArray(container[k]) ? (container[k] as unknown[]) : [],
  );

  const nodes = rawNodes.map(parseNode).filter((n): n is MaterializedNode => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  let danglingEdges = 0;
  const edges = rawEdges
    .map(parseEdge)
    .filter((e): e is MaterializedEdge => e !== null)
    .filter((e) => {
      const ok = ids.has(e.source) && ids.has(e.target);
      if (!ok) danglingEdges++;
      return ok;
    });
  if (nodes.length === 0 && edges.length === 0 && rawNodes.length === 0 && rawEdges.length === 0) return null;

  const stats: Array<{ label: string; value: number }> = [];
  const scanStats = (o: Obj, prefix = "") => {
    for (const [k, v] of Object.entries(o)) {
      if (GRAPH_CONTAINER_KEYS.includes(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) stats.push({ label: `${prefix}${k}`, value: v });
      else if (isObj(v) && !prefix) scanStats(v, `${k} `);
    }
  };
  scanStats(container);
  if (isObj(output) && output !== container) scanStats(output);

  const note = isObj(output) ? firstString(output, NOTE_KEYS) : null;

  return {
    nodes,
    edges,
    nodeTypes: countBy(nodes.map((n) => ({ key: n.type }))),
    edgeTypes: countBy(edges.map((e) => ({ key: e.label }))),
    stats,
    note,
    danglingEdges,
  };
}

/**
 * Categorical colours for node types, assigned in first-seen order and never
 * cycled: after eight, every further type shares a neutral grey.
 */
const CATEGORICAL = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"];
const OVERFLOW = "#94a3b8";

export function nodeTypeColorMap(nodeTypes: Array<{ type: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  nodeTypes.forEach(({ type }, i) => {
    map[type] = i < CATEGORICAL.length ? CATEGORICAL[i] : OVERFLOW;
  });
  return map;
}
