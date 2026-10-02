/**
 * Read model for the graph workbench (the org page's `?view=graph`).
 *
 * Every read goes through `runWorkspaceGraphQuery`, so it inherits that
 * service's membership gate, read-only guard, timeout and swarm resolution.
 * The upstream query endpoint takes no parameters, so every value
 * interpolated into Cypher is checked against a strict pattern first.
 */

import { mockConnectionPage, mockHierarchy, mockNodeConnections } from "@/app/api/mock/graph/workbench-fixture";
import { fromPropertyPairs, isRunGraphRefId, propertyPairs, typeFromLabels } from "@/lib/strut-run-graph/hydrate";
import { runWorkspaceGraphQuery, type WorkspaceGraphQueryFailure } from "./query";

/** A label or relationship type, placed inside backticks. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A readable name for a node of any type. */
const nameOf = (v: string) => `coalesce(${v}.name, ${v}.title, ${v}.tool_name, ${v}.file, ${v}.path, ${v}.ref_id)`;

/** Upstream returns at most this many rows whatever limit is asked for. */
export const GRAPH_ROW_CAP = 1000;

/** Neighbours returned per edge group when a node is expanded. */
const CONNECTION_SAMPLE = 8;

/** Neighbours per page of one edge group, when the caller doesn't say. */
export const CONNECTION_PAGE = 25;

/** Checked at call time, like `runWorkspaceGraphQuery`'s own mock branch: tests flip it per test. */
const useMocks = () => process.env.USE_MOCKS === "true";

type WorkbenchResult<T> = { ok: true; data: T } | WorkspaceGraphQueryFailure;

interface Caller {
  slug: string;
  userId: string;
}

const invalid = (message: string): WorkspaceGraphQueryFailure => ({ ok: false, status: 400, message });

async function rows(caller: Caller, query: string, limit: number): Promise<WorkbenchResult<Record<string, unknown>[]>> {
  const result = await runWorkspaceGraphQuery({ ...caller, query, limit });
  if (!result.ok) return result;
  const { columns, rows: raw } = (result.data ?? {}) as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(columns) || !Array.isArray(raw)) {
    return { ok: false, status: 502, message: "Unexpected response from the graph" };
  }
  // Columns arrive in upstream's order, not the RETURN order — read by name.
  return {
    ok: true,
    data: raw.map((row) =>
      Object.fromEntries(columns.map((c, i) => [String(c), Array.isArray(row) ? row[i] : undefined])),
    ),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A neighbour out of `{id, name}`, or nothing without an id. */
function toItem(rec: Record<string, unknown>, type: string): ConnectionItem[] {
  const id = str(rec.id);
  return id ? [{ id, name: str(rec.name) ?? id, type }] : [];
}

// ── Hierarchy ───────────────────────────────────────────────────────────────

export interface HierarchyNode {
  id: string;
  /** The node's own `id` property (a concept's gitree id), which proposals address it by. */
  key: string | null;
  name: string;
  description: string | null;
  docs: string | null;
  repo: string | null;
  /** Times a run or session read this node (ACCESSED + READ_CONCEPT edges). */
  reads: number;
  /** Names of the members who approved it (APPROVED edges). */
  approvers: string[];
}

export interface HierarchyEdge {
  type: string;
  source: string;
  target: string;
}

export interface Hierarchy {
  nodes: HierarchyNode[];
  /** Every edge between two nodes of the label — the client picks which type is structure. */
  edges: HierarchyEdge[];
  /** True when upstream's row cap may have cut the node or edge list short. */
  truncated: boolean;
}

/** Every node of one label with the edges among them: enough to draw its trees. */
export async function getHierarchy(caller: Caller, label: string): Promise<WorkbenchResult<Hierarchy>> {
  if (!IDENT.test(label)) return invalid("Invalid label");
  if (useMocks()) return { ok: true, data: mockHierarchy(label) };
  const L = `\`${label}\``;
  const [nodes, edges] = await Promise.all([
    rows(
      caller,
      `MATCH (n:${L}) RETURN n.ref_id AS id, n.id AS key, n.name AS name, ` +
        `n.description AS description, n.docs AS docs, n.repo AS repo, ` +
        `size([(n)<-[:ACCESSED|READ_CONCEPT]-() | 1]) AS reads, [(n)<-[:APPROVED]-(m) | m.name] AS approvers`,
      GRAPH_ROW_CAP,
    ),
    rows(
      caller,
      `MATCH (a:${L})-[r]->(b:${L}) ` + `RETURN type(r) AS type, a.ref_id AS source, b.ref_id AS target`,
      GRAPH_ROW_CAP,
    ),
  ]);
  if (!nodes.ok) return nodes;
  if (!edges.ok) return edges;
  return {
    ok: true,
    data: {
      nodes: nodes.data.flatMap((r) => {
        const id = str(r.id);
        if (!id) return [];
        return [
          {
            id,
            key: str(r.key),
            name: str(r.name) ?? id,
            description: str(r.description),
            docs: str(r.docs),
            repo: str(r.repo),
            reads: num(r.reads),
            approvers: Array.isArray(r.approvers) ? r.approvers.filter((a): a is string => typeof a === "string") : [],
          },
        ];
      }),
      edges: edges.data.flatMap((r) => {
        const type = str(r.type);
        const source = str(r.source);
        const target = str(r.target);
        return type && source && target ? [{ type, source, target }] : [];
      }),
      truncated: nodes.data.length >= GRAPH_ROW_CAP || edges.data.length >= GRAPH_ROW_CAP,
    },
  };
}

// ── One node and its connections ───────────────────────────────────────────

export interface ConnectionItem {
  id: string;
  name: string;
  type: string;
}

/** One bucket of a node's edges: type × direction × the other end's type. */
export interface ConnectionGroup {
  edge: string;
  outgoing: boolean;
  other: string;
  count: number;
  /** The first few neighbours in the group, at most `CONNECTION_SAMPLE`. */
  items: ConnectionItem[];
}

export interface NodeConnections {
  node: { id: string; type: string; name: string; properties: Record<string, unknown> };
  groups: ConnectionGroup[];
}

/** Machine data, never shown to a reader (the vectors are always left out). */
const HIDDEN_PROPERTIES = ["_search_fields_used", "Data_Bank"];

/**
 * A node of any type: its properties, and every edge group around it with a
 * count and a sample. Counts come first because a group can be huge — one
 * concept carries thousands of MODIFIES edges.
 */
export async function getNodeConnections(caller: Caller, refId: string): Promise<WorkbenchResult<NodeConnections>> {
  if (!isRunGraphRefId(refId)) return invalid("Invalid ref_id");
  if (useMocks()) return { ok: true, data: mockNodeConnections(refId) };
  const [node, groups] = await Promise.all([
    rows(
      caller,
      // `Data_Bank` is on every node and carries the `ref_id` index.
      `MATCH (o:Data_Bank {ref_id: '${refId}'}) ` +
        `RETURN ${propertyPairs("o", HIDDEN_PROPERTIES)} AS props, labels(o) AS labels, ${nameOf("o")} AS name`,
      1,
    ),
    rows(
      caller,
      `MATCH (c:Data_Bank {ref_id: '${refId}'})-[r]-(o) ` +
        `WITH type(r) AS edge, startNode(r) = c AS outgoing, labels(o) AS labels, o ` +
        `WITH edge, outgoing, labels, count(o) AS count, ` +
        `collect({id: o.ref_id, name: ${nameOf("o")}})[0..${CONNECTION_SAMPLE}] AS items ` +
        `RETURN edge, outgoing, labels, count, items`,
      500,
    ),
  ]);
  if (!node.ok) return node;
  if (!groups.ok) return groups;
  const n = node.data[0];
  if (!n) return { ok: false, status: 404, message: "Node not found" };
  // Grouped by label set upstream; several label sets can share a type, so merge here.
  const merged = new Map<string, ConnectionGroup>();
  for (const g of groups.data) {
    const edge = str(g.edge);
    if (!edge) continue;
    const outgoing = g.outgoing === true;
    const other = typeFromLabels(g.labels);
    const items = (Array.isArray(g.items) ? g.items : []).flatMap((it) =>
      toItem((it ?? {}) as Record<string, unknown>, other),
    );
    const key = `${edge}|${outgoing}|${other}`;
    const prev = merged.get(key);
    if (prev) {
      prev.count += num(g.count);
      prev.items = [...prev.items, ...items].slice(0, CONNECTION_SAMPLE);
    } else merged.set(key, { edge, outgoing, other, count: num(g.count), items });
  }
  return {
    ok: true,
    data: {
      node: {
        id: refId,
        type: typeFromLabels(n.labels),
        name: str(n.name) ?? refId,
        properties: fromPropertyPairs(n.props),
      },
      groups: [...merged.values()].sort((a, b) => b.count - a.count),
    },
  };
}

export interface ConnectionPageArgs {
  refId: string;
  edge: string;
  outgoing: boolean;
  /** The other end's type. */
  other: string;
  limit: number;
}

/** The first `limit` neighbours in one edge group — "show more" re-asks with a bigger limit. */
export async function getConnectionPage(
  caller: Caller,
  { refId, edge, outgoing, other, limit }: ConnectionPageArgs,
): Promise<WorkbenchResult<ConnectionItem[]>> {
  if (!isRunGraphRefId(refId)) return invalid("Invalid ref_id");
  if (!IDENT.test(edge) || !IDENT.test(other)) return invalid("Invalid edge or type");
  if (useMocks()) return { ok: true, data: mockConnectionPage({ refId, edge, outgoing, other, limit }) };
  const target = `(o:\`${other}\`)`;
  const pattern = outgoing
    ? `(c:Data_Bank {ref_id: '${refId}'})-[:\`${edge}\`]->${target}`
    : `(c:Data_Bank {ref_id: '${refId}'})<-[:\`${edge}\`]-${target}`;
  const result = await rows(
    caller,
    `MATCH ${pattern} RETURN o.ref_id AS id, ${nameOf("o")} AS name, labels(o) AS labels`,
    Math.min(Math.max(1, Math.floor(limit)), GRAPH_ROW_CAP),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.flatMap((r) => toItem(r, typeFromLabels(r.labels))),
  };
}
