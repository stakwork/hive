/**
 * Resolve the nodes a run touched against the graph it used: their real
 * type, name and namespace, and the edges among them. Server-only.
 *
 * Strut's log names a node by `ref_id` (and sometimes a type); everything
 * else is read from the swarm's graph with two read-only Cypher queries.
 * Hydration is best effort — a graph that cannot answer leaves the nodes as
 * the log named them, it never fails the trace.
 */

import { getSwarmVanityAddress } from "@/lib/constants";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import type { RunGraphEdge, RunGraphNode, RunGraphNodeRef } from "./types";

/**
 * Nodes resolved per trace; a run that touched more is reported `truncated`.
 * A thousand ids is a ~40 KB query — inside stakgraph's `MAX_QUERY_LEN`
 * (`standalone/src/handlers/hive_query.rs`) — and its row cap.
 */
export const RUN_GRAPH_MAX_NODES = 1000;

/** Ref ids are interpolated into Cypher, so only this shape is ever sent. */
const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Upstream answers at most this many rows. */
const ROW_LIMIT = 1000;
const QUERY_TIMEOUT_MS = 20_000;
const MAX_NAME_CHARS = 160;

/** Labels every node carries; the one left over is its type. */
const STRUCTURAL_LABELS: ReadonlySet<string> = new Set(["Data_Bank", "Node"]);
const DOMAIN_LABEL_PREFIX = "Domain_";

export interface CypherResult {
  columns: string[];
  rows: unknown[][];
}

/** Runs one read-only query; null when the graph could not answer. */
export type CypherRunner = (query: string, limit: number) => Promise<CypherResult | null>;

export function swarmCypherRunner(swarm: { name: string; apiKey: string }): CypherRunner {
  const url = `${getStakgraphUrl(getSwarmVanityAddress(swarm.name))}/api/hive/query`;
  return async (query, limit) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": swarm.apiKey },
        body: JSON.stringify({ language: "cypher", query, limit }),
        cache: "no-store",
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<CypherResult>;
      return Array.isArray(body.columns) && Array.isArray(body.rows) ? { columns: body.columns, rows: body.rows } : null;
    } catch {
      return null;
    }
  };
}

/** Rows as records keyed by column — upstream orders columns its own way. */
function records(result: CypherResult | null): Array<Record<string, unknown>> {
  if (!result) return [];
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])));
}

export function typeFromLabels(labels: unknown, fallback?: string): string {
  const own = Array.isArray(labels)
    ? labels.filter(
        (l): l is string => typeof l === "string" && !STRUCTURAL_LABELS.has(l) && !l.startsWith(DOMAIN_LABEL_PREFIX),
      )
    : [];
  return own[0] ?? fallback ?? "Node";
}

function unresolved(ref: RunGraphNodeRef): RunGraphNode {
  return {
    ref_id: ref.ref_id,
    node_type: ref.node_type ?? "Node",
    name: ref.ref_id.slice(0, 8),
    namespace: null,
    found: false,
  };
}

export async function hydrateRunGraph(
  refs: RunGraphNodeRef[],
  run: CypherRunner,
): Promise<{ nodes: RunGraphNode[]; edges: RunGraphEdge[]; truncated: boolean }> {
  const valid = refs.filter((r) => REF_ID_RE.test(r.ref_id));
  const shown = valid.slice(0, RUN_GRAPH_MAX_NODES);
  if (shown.length === 0) return { nodes: [], edges: [], truncated: false };

  // `Data_Bank` is on every node and carries the `ref_id` index.
  const ids = `WITH [${shown.map((r) => `'${r.ref_id}'`).join(",")}] AS ids`;
  const [nodeResult, edgeResult] = await Promise.all([
    run(
      `${ids} MATCH (n:Data_Bank) WHERE n.ref_id IN ids RETURN n.ref_id AS ref_id, labels(n) AS labels, ` +
        `coalesce(n.name, n.title, n.label, n.file_name, n.source_link) AS name, n.namespace AS namespace`,
      ROW_LIMIT,
    ),
    run(
      `${ids} MATCH (n:Data_Bank)-[r]->(m:Data_Bank) WHERE n.ref_id IN ids AND m.ref_id IN ids ` +
        `RETURN DISTINCT n.ref_id AS source, type(r) AS edge_type, m.ref_id AS target`,
      ROW_LIMIT,
    ),
  ]);

  const resolved = new Map<string, Record<string, unknown>>();
  for (const row of records(nodeResult)) {
    if (typeof row.ref_id === "string") resolved.set(row.ref_id, row);
  }
  const nodes = shown.map((ref): RunGraphNode => {
    const row = resolved.get(ref.ref_id);
    if (!row) return unresolved(ref);
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : ref.ref_id.slice(0, 8);
    return {
      ref_id: ref.ref_id,
      node_type: typeFromLabels(row.labels, ref.node_type),
      name: name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}…` : name,
      namespace: typeof row.namespace === "string" ? row.namespace : null,
      found: true,
    };
  });

  const edgeRows = records(edgeResult);
  const edges: RunGraphEdge[] = [];
  for (const row of edgeRows) {
    if (typeof row.source !== "string" || typeof row.target !== "string" || typeof row.edge_type !== "string") continue;
    edges.push({ source: row.source, target: row.target, edge_type: row.edge_type });
  }

  return {
    nodes,
    edges,
    truncated: valid.length > shown.length || edgeRows.length >= ROW_LIMIT,
  };
}
