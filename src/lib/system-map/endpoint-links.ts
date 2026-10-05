import { runWorkspaceGraphQuery } from "@/services/graph/query";
import type { SystemMapEndpoint, SystemMapEndpointLink } from "@/types/system-map";
import { SYSTEM_MAP_NAMESPACE } from "./domain-nodes";

/** Stakgraph's `/api/hive/query` answers at most this many rows (see `strut-run-graph/hydrate.ts`). */
export const ENDPOINT_PAGE_ROWS = 1000;
export const MAX_ENDPOINT_PAGES = 20;
const QUERY_TIMEOUT_MS = 60_000;
/** The cursor is interpolated into Cypher, so only this shape is ever sent. */
const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const LINK_SEP = "|";

/**
 * One row per Endpoint linked to a System Map node, its links folded into
 * `node|EDGE_TYPE|out|in` strings — a component can hold hundreds of links,
 * and upstream caps rows, not list sizes. Anchored on the `Endpoint` label
 * and filtered on the neighbour's `namespace`, which the graph stores as a
 * plain property even though jarvis' `/v2/nodes` does not return it. Paged
 * by `ref_id` (keyset): upstream rewrites any LIMIT/SKIP in the query.
 */
export function endpointLinksQuery(after: string | null): string {
  if (after !== null && !REF_ID_RE.test(after)) throw new Error(`Unsafe cursor: ${JSON.stringify(after)}`);
  const cursor = after === null ? "" : ` AND e.ref_id > '${after}'`;
  return `MATCH (e:Endpoint)-[r]-(n)
WHERE n.namespace = '${SYSTEM_MAP_NAMESPACE}'${cursor}
WITH e, collect(n.ref_id + '${LINK_SEP}' + type(r) + '${LINK_SEP}' + CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END) AS links
RETURN e.ref_id AS endpoint, e.name AS name, e.verb AS verb, e.file AS file, links
ORDER BY endpoint`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Stakgraph stores some verbs as `"GET"`, quotes included. */
function asVerb(value: unknown): string {
  return asString(value).replace(/^["']+|["']+$/g, "").toUpperCase();
}

export interface ParsedEndpointLinks {
  links: SystemMapEndpointLink[];
  endpoints: SystemMapEndpoint[];
  rowCount: number;
  /** The last row's endpoint ref_id — the next page's cursor. */
  lastEndpoint: string | null;
}

/** Stakgraph's `{ columns, rows }` → links and endpoints, matched by column name. */
export function parseEndpointLinkRows(data: unknown): ParsedEndpointLinks {
  const body = (data ?? {}) as { columns?: unknown; rows?: unknown };
  const columns = Array.isArray(body.columns) ? body.columns.map(String) : [];
  const at = (name: string) => columns.indexOf(name);
  const [iEndpoint, iName, iVerb, iFile, iLinks] = ["endpoint", "name", "verb", "file", "links"].map(at);
  const rows = Array.isArray(body.rows) ? (body.rows as unknown[]) : [];

  const links: SystemMapEndpointLink[] = [];
  const endpoints: SystemMapEndpoint[] = [];
  let lastEndpoint: string | null = null;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const endpoint = asString(row[iEndpoint]);
    if (!endpoint) continue;
    lastEndpoint = endpoint;
    endpoints.push({
      refId: endpoint,
      name: asString(row[iName]) || endpoint,
      verb: asVerb(row[iVerb]),
      file: asString(row[iFile]),
    });
    const seen = new Set<string>();
    for (const raw of Array.isArray(row[iLinks]) ? (row[iLinks] as unknown[]) : []) {
      const [node, edgeType, direction] = asString(raw).split(LINK_SEP);
      if (!node || !edgeType || seen.has(asString(raw))) continue;
      seen.add(asString(raw));
      links.push({ node, endpoint, edgeType, direction: direction === "in" ? "in" : "out" });
    }
  }
  return { links, endpoints, rowCount: rows.length, lastEndpoint };
}

export type ListEndpointLinksResult =
  | { ok: true; links: SystemMapEndpointLink[]; endpoints: SystemMapEndpoint[]; truncated: boolean }
  | { ok: false; error: string };

/** Upstream's own error phrase (`details.error`) beats the service's generic "Query failed". */
function upstreamError(message: string, details: unknown): string {
  const said = (details ?? {}) as { error?: unknown; message?: unknown };
  const detail = typeof said.error === "string" ? said.error : typeof said.message === "string" ? said.message : null;
  return detail ? `${message}: ${detail}` : message;
}

/**
 * The System Map ↔ Endpoint links through read-only Cypher on stakgraph
 * (`runWorkspaceGraphQuery`), a page of endpoints at a time.
 */
export async function listSystemMapEndpointLinks(args: {
  slug: string;
  userId: string;
}): Promise<ListEndpointLinksResult> {
  const links: SystemMapEndpointLink[] = [];
  const endpoints: SystemMapEndpoint[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ENDPOINT_PAGES; page++) {
    const result = await runWorkspaceGraphQuery({
      slug: args.slug,
      userId: args.userId,
      query: endpointLinksQuery(after),
      limit: ENDPOINT_PAGE_ROWS,
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    if (!result.ok) return { ok: false, error: upstreamError(result.message, result.details) };

    const parsed = parseEndpointLinkRows(result.data);
    links.push(...parsed.links);
    endpoints.push(...parsed.endpoints);
    if (parsed.rowCount < ENDPOINT_PAGE_ROWS || !parsed.lastEndpoint || !REF_ID_RE.test(parsed.lastEndpoint)) {
      return { ok: true, links, endpoints, truncated: false };
    }
    after = parsed.lastEndpoint;
  }
  return { ok: true, links, endpoints, truncated: true };
}
