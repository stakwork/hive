/**
 * Resolve the nodes a run touched against the graph it used: their real
 * type, name and namespace, and the edges among them. Server-only.
 *
 * Strut's log names a node by `ref_id` (and sometimes a type); everything
 * else is read from the swarm's graph with three read-only Cypher queries:
 * the nodes, the edges among them, and their lineage — the nodes above them
 * along `PARENT_OF`, up to the root, which the run need not have touched.
 * Hydration is best effort — a graph that cannot answer leaves the nodes as
 * the log named them and says what it did not read (`nodesRead`,
 * `edgesRead`, `lineageRead`) and why (`unreadReason`); it never fails the
 * trace.
 */

import { getSwarmVanityAddress } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import { LINEAGE_EDGE_TYPE } from "./lineage";
import { parseQualifiedRef, qualifyRef } from "./peer-ref";
import type {
  RunGraphEdge,
  RunGraphNode,
  RunGraphNodeBody,
  RunGraphNodeRef,
  RunGraphPeer,
  RunGraphTrace,
} from "./types";

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
/** How far up a lineage is read. A Concept tree is a few levels deep; a cycle would otherwise never end. */
const LINEAGE_DEPTH = 10;
const QUERY_TIMEOUT_MS = 20_000;
const MAX_NAME_CHARS = 160;
const MAX_REASON_CHARS = 120;
const LOG_TAG = "STRUT_RUN_GRAPH";

/** Labels every node carries; the one left over is its type. */
const STRUCTURAL_LABELS: ReadonlySet<string> = new Set(["Data_Bank", "Node"]);
const DOMAIN_LABEL_PREFIX = "Domain_";

/** Cypher for the name of node `v`, whichever property holds it. */
const nameOf = (v: string): string => `coalesce(${v}.name, ${v}.title, ${v}.label, ${v}.file_name, ${v}.source_link)`;

export interface CypherResult {
  columns: string[];
  rows: unknown[][];
}

/** Why the graph could not answer a query: `400 query too long`, `no answer in 20 s`. */
export interface CypherUnread {
  unread: string;
}

/** Runs one read-only query, or says why the graph could not answer it. */
export type CypherRunner = (query: string, limit: number) => Promise<CypherResult | CypherUnread>;

function isUnread(result: CypherResult | CypherUnread): result is CypherUnread {
  return "unread" in result;
}

export function swarmCypherRunner(swarm: { name: string; apiKey: string }): CypherRunner {
  const url = `${getStakgraphUrl(getSwarmVanityAddress(swarm.name))}/api/hive/query`;
  return async (query, limit) => {
    const unread = (reason: string, details?: unknown): CypherUnread => {
      logger.warn("The graph did not answer a run graph query", LOG_TAG, {
        swarm: swarm.name,
        queryChars: query.length,
        reason,
        details,
      });
      return { unread: reason.slice(0, MAX_REASON_CHARS) };
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": swarm.apiKey },
        body: JSON.stringify({ language: "cypher", query, limit }),
        cache: "no-store",
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Upstream's `error` is one of its own fixed phrases; `details` is the database's and stays in the log.
        const said = (await res.json().catch(() => null)) as { error?: unknown; details?: unknown } | null;
        const error = typeof said?.error === "string" && said.error ? said.error : res.statusText;
        return unread(`${res.status} ${error}`.trim(), said?.details);
      }
      const body = (await res.json()) as Partial<CypherResult>;
      return Array.isArray(body.columns) && Array.isArray(body.rows)
        ? { columns: body.columns, rows: body.rows }
        : unread("an answer that is not rows");
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return unread(
        timedOut ? `no answer in ${QUERY_TIMEOUT_MS / 1000} s` : "could not be reached",
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}

/** Rows as records keyed by column — upstream orders columns its own way. */
function records(result: CypherResult | CypherUnread): Array<Record<string, unknown>> {
  if (isUnread(result)) return [];
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

/** A node as a row of the graph answers for it. */
function resolved(refId: string, row: Record<string, unknown>, loggedType?: string): RunGraphNode {
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : refId.slice(0, 8);
  return {
    ref_id: refId,
    node_type: typeFromLabels(row.labels, loggedType),
    name: name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}…` : name,
    namespace: typeof row.namespace === "string" ? row.namespace : null,
    found: true,
  };
}

const edgeKey = (edge: RunGraphEdge): string => `${edge.source}|${edge.edge_type}|${edge.target}`;

export async function hydrateRunGraph(
  refs: RunGraphNodeRef[],
  run: CypherRunner,
): Promise<Omit<RunGraphTrace, "calls">> {
  const valid = refs.filter((r) => REF_ID_RE.test(r.ref_id));
  const shown = valid.slice(0, RUN_GRAPH_MAX_NODES);
  if (shown.length === 0) {
    return { nodes: [], edges: [], nodesRead: true, edgesRead: true, lineageRead: true, truncated: false };
  }

  // `Data_Bank` is on every node and carries the `ref_id` index.
  const ids = `WITH [${shown.map((r) => `'${r.ref_id}'`).join(",")}] AS ids`;
  const [nodeResult, edgeResult, lineageResult] = await Promise.all([
    run(
      `${ids} MATCH (n:Data_Bank) WHERE n.ref_id IN ids RETURN n.ref_id AS ref_id, labels(n) AS labels, ` +
        `${nameOf("n")} AS name, n.namespace AS namespace`,
      ROW_LIMIT,
    ),
    run(
      `${ids} MATCH (n:Data_Bank)-[r]->(m:Data_Bank) WHERE n.ref_id IN ids AND m.ref_id IN ids ` +
        `RETURN DISTINCT n.ref_id AS source, type(r) AS edge_type, m.ref_id AS target`,
      ROW_LIMIT,
    ),
    // Every edge on every path from a touched node up to the root of its tree, with the parent it comes from.
    run(
      `${ids} MATCH (n:Data_Bank) WHERE n.ref_id IN ids ` +
        `MATCH p = (a:Data_Bank)-[:${LINEAGE_EDGE_TYPE}*1..${LINEAGE_DEPTH}]->(n) ` +
        `UNWIND relationships(p) AS r WITH DISTINCT startNode(r) AS s, endNode(r) AS t ` +
        `RETURN s.ref_id AS source, t.ref_id AS target, labels(s) AS labels, ${nameOf("s")} AS name, s.namespace AS namespace`,
      ROW_LIMIT,
    ),
  ]);

  const rows = new Map<string, Record<string, unknown>>();
  for (const row of records(nodeResult)) {
    if (typeof row.ref_id === "string") rows.set(row.ref_id, row);
  }
  const nodes = shown.map((ref): RunGraphNode => {
    const row = rows.get(ref.ref_id);
    return row ? resolved(ref.ref_id, row, ref.node_type) : unresolved(ref);
  });

  const edges: RunGraphEdge[] = [];
  const known = new Set<string>();
  for (const row of records(edgeResult)) {
    if (typeof row.source !== "string" || typeof row.target !== "string" || typeof row.edge_type !== "string") continue;
    const edge = { source: row.source, target: row.target, edge_type: row.edge_type };
    if (!known.has(edgeKey(edge))) {
      known.add(edgeKey(edge));
      edges.push(edge);
    }
  }
  const edgesAmongTouched = edges.length;

  // An ancestor is a parent on some path up; it is named by every edge it is the parent of.
  const touched = new Set(shown.map((r) => r.ref_id));
  const ancestors = new Map<string, RunGraphNode>();
  const lineageRows = records(lineageResult);
  for (const row of lineageRows) {
    if (typeof row.source !== "string" || typeof row.target !== "string") continue;
    if (!REF_ID_RE.test(row.source) || !REF_ID_RE.test(row.target)) continue;
    const edge = { source: row.source, target: row.target, edge_type: LINEAGE_EDGE_TYPE };
    if (!known.has(edgeKey(edge))) {
      known.add(edgeKey(edge));
      edges.push(edge);
    }
    if (!touched.has(row.source) && !ancestors.has(row.source)) {
      ancestors.set(row.source, { ...resolved(row.source, row), ancestor: true });
    }
  }

  const unread = [nodeResult, edgeResult, lineageResult].find(isUnread);
  return {
    nodes: [...nodes, ...ancestors.values()],
    edges,
    nodesRead: !isUnread(nodeResult),
    edgesRead: !isUnread(edgeResult),
    lineageRead: !isUnread(lineageResult),
    ...(unread ? { unreadReason: unread.unread } : {}),
    truncated: valid.length > shown.length || edgesAmongTouched >= ROW_LIMIT || lineageRows.length >= ROW_LIMIT,
  };
}

/** Where a peer workspace's graph is read from — or why it is not, for this viewer. */
export type PeerGraph = { run: CypherRunner } | { reason: string };

/**
 * `hydrateRunGraph` over every graph the run reached: this workspace's own,
 * and each peer workspace's whose nodes a `strut/run-workflow` step folded
 * in (refs carrying `peer`). A peer's nodes are read from ITS graph with the
 * same three queries, then named by their qualified id (`peer-ref.ts`) —
 * their edges and lineage too, and a graph never links into another. A peer
 * `peerGraph` will not read for (the viewer is not a member of it, …) keeps
 * its nodes as the log named them. The flags are the run's own graph's;
 * `peers` says, per peer, whether it was read and why not.
 */
export async function hydrateRunGraphAcross(
  refs: RunGraphNodeRef[],
  local: CypherRunner,
  peerGraph: (slug: string) => Promise<PeerGraph>,
): Promise<Omit<RunGraphTrace, "calls">> {
  const own: RunGraphNodeRef[] = [];
  const byPeer = new Map<string, RunGraphNodeRef[]>();
  for (const ref of refs) {
    if (!ref.peer) {
      own.push(ref);
      continue;
    }
    const raw = { ...ref, ref_id: parseQualifiedRef(ref.ref_id).refId };
    byPeer.set(ref.peer, [...(byPeer.get(ref.peer) ?? []), raw]);
  }

  const [home, ...remote] = await Promise.all([
    hydrateRunGraph(own, local),
    ...[...byPeer].map(async ([slug, peerRefs]) => {
      const graph = await peerGraph(slug);
      if ("reason" in graph) {
        return {
          slug,
          peer: { slug, read: false, reason: graph.reason } as RunGraphPeer,
          nodes: peerRefs.map((ref) => ({ ...unresolved(ref), ref_id: qualifyRef(ref.ref_id, slug), peer: slug })),
          edges: [] as RunGraphEdge[],
          truncated: false,
        };
      }
      const read = await hydrateRunGraph(peerRefs, graph.run);
      return {
        slug,
        peer: (read.nodesRead
          ? { slug, read: true }
          : { slug, read: false, reason: read.unreadReason ?? "its graph did not answer" }) as RunGraphPeer,
        nodes: read.nodes.map((n) => ({ ...n, ref_id: qualifyRef(n.ref_id, slug), peer: slug })),
        edges: read.edges.map((e) => ({
          ...e,
          source: qualifyRef(e.source, slug),
          target: qualifyRef(e.target, slug),
        })),
        truncated: read.truncated,
      };
    }),
  ]);

  if (remote.length === 0) return home;
  return {
    ...home,
    nodes: [...home.nodes, ...remote.flatMap((r) => r.nodes)],
    edges: [...home.edges, ...remote.flatMap((r) => r.edges)],
    truncated: home.truncated || remote.some((r) => r.truncated),
    peers: remote.map((r) => r.peer),
  };
}

/** Is this a ref id the graph will ever be asked about? */
export function isRunGraphRefId(refId: string): boolean {
  return REF_ID_RE.test(refId);
}

/** Properties never read back: the vectors are large and mean nothing to a reader. */
const VECTOR_PROPERTIES: readonly string[] = ["embeddings", "text_embeddings"];

/**
 * Cypher for node `v`'s properties as `[key, value]` pairs, less the vectors
 * and any `skip` — projected in the query, so they never leave the swarm.
 */
export function propertyPairs(v: string, skip: readonly string[] = []): string {
  const skipped = [...VECTOR_PROPERTIES, ...skip].map((key) => `'${key}'`).join(",");
  return `[k IN keys(${v}) WHERE NOT k IN [${skipped}] | [k, ${v}[k]]]`;
}

/** What `propertyPairs` returns, as an object. */
export function fromPropertyPairs(pairs: unknown): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (Array.isArray(pairs)) {
    for (const pair of pairs) {
      if (Array.isArray(pair) && typeof pair[0] === "string") properties[pair[0]] = pair[1];
    }
  }
  return properties;
}

export type RunGraphNodeRead =
  /** The node, whole. */
  | { found: true; node: RunGraphNodeBody }
  /** The graph no longer holds the node — or, with `unread`, could not answer for it; with `denied`, may not be read by this viewer. */
  | { found: false; unread?: string; denied?: string };

/**
 * One node, whole: its labels and every property but the vectors, for reading
 * what the run read. The projection is written here, so the vectors never
 * leave the swarm; a ref id that is not id-shaped is never sent.
 */
export async function readRunGraphNode(refId: string, run: CypherRunner): Promise<RunGraphNodeRead> {
  if (!REF_ID_RE.test(refId)) return { found: false };
  const result = await run(
    `MATCH (n:Data_Bank {ref_id: '${refId}'}) RETURN labels(n) AS labels, ${propertyPairs("n")} AS props`,
    1,
  );
  if (isUnread(result)) return { found: false, unread: result.unread };
  const row = records(result)[0];
  if (!row) return { found: false };

  const properties = fromPropertyPairs(row.props);
  const labels = Array.isArray(row.labels) ? row.labels.filter((l): l is string => typeof l === "string") : [];
  return { found: true, node: { ref_id: refId, node_type: typeFromLabels(labels), labels, properties } };
}
