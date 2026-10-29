/**
 * The System Map namespace as a graph, read through read-only Cypher on
 * stakgraph (`runWorkspaceGraphQuery`) instead of jarvis' node listing plus a
 * `GET /v2/nodes/:ref_id?expand=edges` per node the listing came back short
 * for — which, with packages, meant hundreds of round trips.
 *
 * Two keyset-paged queries (upstream caps rows and rewrites LIMIT/SKIP),
 * run side by side: the nodes, every property but the vectors; and the edges
 * among them folded into one row per source node, so a component with a
 * thousand package edges is still one row.
 */

import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { fromPropertyPairs, propertyPairs, typeFromLabels } from "@/lib/strut-run-graph/hydrate";
import { logger } from "@/lib/logger";
import type { SystemMapDomainEdge, SystemMapDomainNode, SystemMapDomainType } from "@/types/system-map";
import { MAX_DOMAIN_NODES, SYSTEM_MAP_NAMESPACE, type ListSystemMapDomainNodesResult } from "./domain-nodes";
import { SYSTEM_MAP_NODE_TYPES } from "./node-types";

export const DOMAIN_PAGE_ROWS = 1000;
const MAX_NODE_PAGES = MAX_DOMAIN_NODES / DOMAIN_PAGE_ROWS;
const MAX_EDGE_PAGES = MAX_NODE_PAGES;
const QUERY_TIMEOUT_MS = 60_000;
/** Cursors, the namespace and type names are interpolated into Cypher, so only these shapes are ever sent. */
const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const LINK_SEP = "|";
/** Kept out of `properties`: the identity fields, which jarvis does not echo there either. */
const SKIPPED_PROPERTIES = ["ref_id", "namespace"];
const KNOWN_TYPES: ReadonlySet<string> = new Set(SYSTEM_MAP_NODE_TYPES);

function typeFilter(v: string, types: string[] | undefined): string {
  return types?.length ? ` AND any(l IN labels(${v}) WHERE l IN [${types.map((t) => `'${t}'`).join(",")}])` : "";
}

function cursor(v: string, after: string | null): string {
  if (after === null) return "";
  if (!REF_ID_RE.test(after)) throw new Error(`Unsafe cursor: ${JSON.stringify(after)}`);
  return ` AND ${v}.ref_id > '${after}'`;
}

export function domainNodesQuery(namespace: string, types: string[] | undefined, after: string | null): string {
  return `MATCH (n:Data_Bank) WHERE n.namespace = '${namespace}'${typeFilter("n", types)}${cursor("n", after)}
RETURN n.ref_id AS ref_id, labels(n) AS labels, ${propertyPairs("n", SKIPPED_PROPERTIES)} AS props
ORDER BY ref_id`;
}

export function domainEdgesQuery(namespace: string, types: string[] | undefined, after: string | null): string {
  return `MATCH (a:Data_Bank)-[r]->(b:Data_Bank)
WHERE a.namespace = '${namespace}' AND b.namespace = '${namespace}'${typeFilter("a", types)}${typeFilter("b", types)}${cursor("a", after)}
WITH a, collect(b.ref_id + '${LINK_SEP}' + type(r)) AS links
RETURN a.ref_id AS source, links
ORDER BY source`;
}

/** Stakgraph's `{ columns, rows }` as records keyed by column — upstream orders columns its own way. */
export function rowRecords(data: unknown): Array<Record<string, unknown>> {
  const body = (data ?? {}) as { columns?: unknown; rows?: unknown };
  const columns = Array.isArray(body.columns) ? body.columns.map(String) : [];
  const rows = Array.isArray(body.rows) ? (body.rows as unknown[]) : [];
  return rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

export function parseDomainNodeRecord(row: Record<string, unknown>): SystemMapDomainNode | null {
  const refId = typeof row.ref_id === "string" ? row.ref_id : "";
  if (!refId) return null;
  const properties = fromPropertyPairs(row.props);
  const name = typeof properties.name === "string" && properties.name.trim() ? properties.name.trim() : refId;
  // A System Map type wins over any other label the node carries.
  const known = Array.isArray(row.labels) ? row.labels.find((l) => typeof l === "string" && KNOWN_TYPES.has(l)) : null;
  return { refId, type: known ?? typeFromLabels(row.labels, "Unknown"), name, properties };
}

export function parseDomainEdgeRecord(row: Record<string, unknown>): SystemMapDomainEdge[] {
  const source = typeof row.source === "string" ? row.source : "";
  if (!source || !Array.isArray(row.links)) return [];
  const edges: SystemMapDomainEdge[] = [];
  for (const link of row.links) {
    if (typeof link !== "string") continue;
    const at = link.lastIndexOf(LINK_SEP);
    const target = link.slice(0, at);
    const edgeType = link.slice(at + 1);
    if (at > 0 && edgeType) edges.push({ source, target, edgeType });
  }
  return edges;
}

/** Upstream's own error phrase (`details.error`) beats the service's generic "Query failed". */
function upstreamError(message: string, details: unknown): string {
  const said = (details ?? {}) as { error?: unknown; message?: unknown };
  const detail = typeof said.error === "string" ? said.error : typeof said.message === "string" ? said.message : null;
  return detail ? `${message}: ${detail}` : message;
}

type Paged<T> = { ok: true; items: T[]; truncated: boolean } | { ok: false; error: string };

/** Every page of one keyset query; `cursorOf` names the row the next page starts after. */
async function readPages<T>(
  run: (query: string) => ReturnType<typeof runWorkspaceGraphQuery>,
  query: (after: string | null) => string,
  parse: (row: Record<string, unknown>) => T[],
  cursorOf: (row: Record<string, unknown>) => unknown,
  maxPages: number,
): Promise<Paged<T>> {
  const items: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await run(query(after));
    if (!result.ok) return { ok: false, error: upstreamError(result.message, result.details) };
    const rows = rowRecords(result.data);
    for (const row of rows) items.push(...parse(row));
    const last = rows.length ? cursorOf(rows[rows.length - 1]) : null;
    if (rows.length < DOMAIN_PAGE_ROWS || typeof last !== "string" || !REF_ID_RE.test(last)) {
      return { ok: true, items, truncated: false };
    }
    after = last;
  }
  return { ok: true, items, truncated: true };
}

export async function listSystemMapDomainNodesCypher(args: {
  slug: string;
  userId: string;
  namespace?: string;
  types?: string[];
}): Promise<ListSystemMapDomainNodesResult> {
  const namespace = args.namespace ?? SYSTEM_MAP_NAMESPACE;
  const types = args.types?.length ? args.types : undefined;
  if (!NAME_RE.test(namespace) || types?.some((t) => !NAME_RE.test(t))) {
    return { ok: false, error: "Unsafe namespace or node type" };
  }
  const run = (query: string) =>
    runWorkspaceGraphQuery({
      slug: args.slug,
      userId: args.userId,
      query,
      limit: DOMAIN_PAGE_ROWS,
      timeoutMs: QUERY_TIMEOUT_MS,
    });

  const [nodeRead, edgeRead] = await Promise.all([
    readPages(
      run,
      (after) => domainNodesQuery(namespace, types, after),
      (row) => {
        const node = parseDomainNodeRecord(row);
        return node ? [node] : [];
      },
      (row) => row.ref_id,
      MAX_NODE_PAGES,
    ),
    readPages(
      run,
      (after) => domainEdgesQuery(namespace, types, after),
      parseDomainEdgeRecord,
      (row) => row.source,
      MAX_EDGE_PAGES,
    ),
  ]);
  if (!nodeRead.ok) return { ok: false, error: nodeRead.error };
  if (!edgeRead.ok) return { ok: false, error: edgeRead.error };

  const byRef = new Map<string, SystemMapDomainNode>();
  for (const node of nodeRead.items) if (!byRef.has(node.refId)) byRef.set(node.refId, node);
  const nodes = [...byRef.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const edges = new Map<string, SystemMapDomainEdge>();
  for (const edge of edgeRead.items) {
    if (!byRef.has(edge.source) || !byRef.has(edge.target) || edge.source === edge.target) continue;
    const key = `${edge.source}|${edge.edgeType}|${edge.target}`;
    if (!edges.has(key)) edges.set(key, edge);
  }

  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const typeCounts: SystemMapDomainType[] = [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  logger.info("[SystemMap] domain graph (cypher)", "system-map", {
    slug: args.slug,
    namespace,
    types: types ?? null,
    nodes: nodes.length,
    edges: edges.size,
    edgesTruncated: edgeRead.truncated,
  });

  return {
    ok: true,
    types: typeCounts,
    nodes,
    edges: [...edges.values()],
    // A cut edge read loses links, not nodes; it is reported the same way, so the tab says so.
    truncated: nodeRead.truncated || edgeRead.truncated,
    edgeReadFailures: 0,
    edgeReads: 0,
  };
}
