/**
 * Read model for the graph workbench (the org page's `?view=graph`).
 *
 * Every read goes through `runWorkspaceGraphQuery`, so it inherits that
 * service's membership gate, read-only guard, timeout and swarm resolution.
 * The upstream query endpoint takes no parameters, so every value
 * interpolated into Cypher is checked against a strict pattern first.
 */

import { mockConnectionPage, mockHierarchy, mockNodeConnections } from "@/app/api/mock/graph/workbench-fixture";
import { mockBrainstormListWithWrites, mockChoiceTreeWithWrites } from "@/app/api/mock/graph/brainstorm-store";
import { mockLatency } from "@/app/api/mock/graph/latency";
import {
  mockInitiativeList,
  mockInitiativesBuilding,
  mockInitiativeTree,
} from "@/app/api/mock/graph/initiative-fixture";
import { graphEpochToMs } from "@/app/org/[githubLogin]/_components/brainstorm-board/desk-layout";
import { fromPropertyPairs, isRunGraphRefId, propertyPairs, typeFromLabels } from "@/lib/strut-run-graph/hydrate";
import {
  INITIATIVE_TREE_READ_LABELS,
  initiativeStage,
  type InitiativeStage,
  type InitiativeTreeType,
} from "@/lib/initiative-plan";
import { runWorkspaceGraphQuery, type WorkspaceGraphQueryFailure } from "./query";

export {
  INITIATIVE_TREE_LABELS,
  initiativeStage,
  stageLine,
  type InitiativeNodeType,
  type InitiativeStage,
  type InitiativeTreeType,
} from "@/lib/initiative-plan";

/** A label or relationship type, placed inside backticks. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A readable name for a node of any type. */
const nameOf = (v: string) => `coalesce(${v}.name, ${v}.title, ${v}.tool_name, ${v}.file, ${v}.path, ${v}.ref_id)`;

/** An edge still in force. Jarvis deletes edges outright now; `is_muted` / `is_deleted` (legacy) mark edges muted before that. */
const edgeLive = (r: string) => `coalesce(${r}.is_muted, false) = false AND coalesce(${r}.is_deleted, false) = false`;

/** A node not soft-deleted: Jarvis stamps `deleted_at`; `is_deleted` is the legacy flag, written until the contract step. */
const nodeLive = (v: string) => `${v}.deleted_at IS NULL AND coalesce(${v}.is_deleted, false) = false`;

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
      `MATCH (n:${L}) WHERE ${nodeLive("n")} RETURN n.ref_id AS id, n.id AS key, n.name AS name, ` +
        `n.description AS description, n.docs AS docs, n.repo AS repo, ` +
        `size([(n)<-[:ACCESSED|READ_CONCEPT]-() | 1]) AS reads, [(n)<-[:APPROVED]-(m) | m.name] AS approvers`,
      GRAPH_ROW_CAP,
    ),
    rows(
      caller,
      `MATCH (a:${L})-[r]->(b:${L}) WHERE ${edgeLive("r")} AND ${nodeLive("a")} AND ${nodeLive("b")} ` +
        `RETURN type(r) AS type, a.ref_id AS source, b.ref_id AS target`,
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
      `MATCH (o:Data_Bank {ref_id: '${refId}'}) WHERE ${nodeLive("o")} ` +
        `RETURN ${propertyPairs("o", HIDDEN_PROPERTIES)} AS props, labels(o) AS labels, ${nameOf("o")} AS name`,
      1,
    ),
    rows(
      caller,
      `MATCH (c:Data_Bank {ref_id: '${refId}'})-[r]-(o) WHERE ${edgeLive("r")} AND ${nodeLive("c")} AND ${nodeLive("o")} ` +
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
    ? `(c:Data_Bank {ref_id: '${refId}'})-[r:\`${edge}\`]->${target}`
    : `(c:Data_Bank {ref_id: '${refId}'})<-[r:\`${edge}\`]-${target}`;
  const result = await rows(
    caller,
    `MATCH ${pattern} WHERE ${edgeLive("r")} AND ${nodeLive("c")} AND ${nodeLive("o")} RETURN o.ref_id AS id, ${nameOf("o")} AS name, labels(o) AS labels`,
    Math.min(Math.max(1, Math.floor(limit)), GRAPH_ROW_CAP),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.flatMap((r) => toItem(r, typeFromLabels(r.labels))),
  };
}

// ── Brainstorm tree ─────────────────────────────────────────────────────────

export interface ChoiceTreeNode {
  ref_id: string;
  /** `Question` when the node's labels include it, else `Option` when they include that, else `Choice`. */
  type: "Question" | "Option" | "Choice";
  properties: Record<string, unknown>;
  /** Options only: live `HAS_EFFECT` effects, highest impact first. Absent when there are none. */
  effects?: ChoiceEffect[];
  /** Options only: `RATED_ON` scores (-1..1) on the Fast / Good / Cheap corners it was rated on. Absent when unrated. */
  ratings?: Partial<Record<FgcCorner, number>>;
}

export const FGC_CORNERS = ["fast", "good", "cheap"] as const;
export type FgcCorner = (typeof FGC_CORNERS)[number];

/** A pro or con of an option, from `(Option)-[:HAS_EFFECT]->(Effect)`. Read-only. */
export interface ChoiceEffect {
  ref_id: string;
  name: string;
  description: string;
  direction: "pro" | "con";
  /** 0–1, or null when missing/not numeric. */
  impact: number | null;
  /** The requirements it is weighed `AGAINST` (ref_ids). Absent when none. */
  against?: string[];
}

/** `{corner, score}` rows into scores by corner; a score outside -1..1 or not a number is left out. */
function toRatings(raw: unknown): Partial<Record<FgcCorner, number>> {
  const out: Partial<Record<FgcCorner, number>> = {};
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    const { corner, score } = (r ?? {}) as Record<string, unknown>;
    const c = typeof corner === "string" ? (corner.toLowerCase() as FgcCorner) : null;
    if (c && FGC_CORNERS.includes(c) && typeof score === "number" && score >= -1 && score <= 1) out[c] = score;
  }
  return out;
}

function toEffects(raw: unknown): ChoiceEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: ChoiceEffect[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || (r.direction !== "pro" && r.direction !== "con")) continue;
    const n =
      typeof r.impact === "number"
        ? r.impact
        : typeof r.impact === "string" && r.impact.trim()
          ? Number(r.impact)
          : NaN;
    const against = Array.isArray(r.against) ? r.against.filter((a): a is string => typeof a === "string") : [];
    out.push({
      ref_id: str(r.ref_id) ?? "",
      name,
      description: str(r.description) ?? "",
      direction: r.direction,
      impact: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null,
      ...(against.length ? { against } : {}),
    });
  }
  return out.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1));
}

export interface ChoiceTreeData {
  nodes: ChoiceTreeNode[];
  /** Every edge is `PARENT_OF`, parent to child (a question's sub-questions and options, an option's follow-up questions). */
  edges: Array<{ source: string; target: string }>;
  /** True when upstream's row cap may have cut the node or edge list short. */
  truncated: boolean;
}

// ── Trees ───────────────────────────────────────────────────────────────────

export interface TreeSpec {
  /** A node is in the tree when it carries any of these labels. */
  labels: readonly string[];
  /** The edge types followed downward from the focus. */
  edges: readonly string[];
  /** How many edges deep from the focus. */
  depth: number;
  /** Extra RETURN columns per node, given the node's variable. */
  extra?: (n: string) => string;
}

export interface TreeRow {
  ref_id: string;
  labels: string[];
  properties: Record<string, unknown>;
  /** The node's whole row, for `extra` columns. */
  row: Record<string, unknown>;
}

export interface TreeRows {
  nodes: TreeRow[];
  edges: Array<{ source: string; target: string; type: string }>;
  truncated: boolean;
}

/**
 * The `focus` node and every node below it along `spec.edges` carrying any of
 * `spec.labels`, with the edges among them, read by Cypher and selected by
 * label (never `node_type`). A deleted node or edge hides everything under it.
 */
export async function readTree(caller: Caller, focusRefId: string, spec: TreeSpec): Promise<WorkbenchResult<TreeRows>> {
  if (spec.labels.length === 0 || !spec.labels.every((l) => IDENT.test(l))) return invalid("Invalid label");
  if (spec.edges.length === 0 || !spec.edges.every((e) => IDENT.test(e))) return invalid("Invalid edge type");
  if (!isRunGraphRefId(focusRefId)) return invalid("Invalid ref_id");
  const any = (v: string) => `(${spec.labels.map((l) => `${v}:\`${l}\``).join(" OR ")})`;
  const rels = spec.edges.map((e) => `\`${e}\``).join("|");
  const pathLive = `all(x IN nodes(p) WHERE ${nodeLive("x")}) AND all(e IN relationships(p) WHERE ${edgeLive("e")})`;
  const root = `MATCH (r:Data_Bank {ref_id: '${focusRefId}'})`;
  const [nodes, edges] = await Promise.all([
    rows(
      caller,
      `${root} MATCH p = (r)-[:${rels}*0..${spec.depth}]->(n) WHERE ${any("n")} AND ${pathLive} ` +
        `RETURN DISTINCT n.ref_id AS id, labels(n) AS labels, ${propertyPairs("n")} AS props` +
        (spec.extra ? `, ${spec.extra("n")}` : ""),
      GRAPH_ROW_CAP,
    ),
    rows(
      caller,
      `${root} MATCH p = (r)-[:${rels}*0..${spec.depth - 1}]->(a)-[t:${rels}]->(b) ` +
        `WHERE ${any("a")} AND ${any("b")} AND ${pathLive} AND ${edgeLive("t")} AND ${nodeLive("b")} ` +
        `RETURN DISTINCT a.ref_id AS source, b.ref_id AS target, type(t) AS type`,
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
        const labels = Array.isArray(r.labels) ? r.labels.filter((l): l is string => typeof l === "string") : [];
        return id ? [{ ref_id: id, labels, properties: fromPropertyPairs(r.props), row: r }] : [];
      }),
      edges: edges.data.flatMap((r) => {
        const source = str(r.source);
        const target = str(r.target);
        const type = str(r.type);
        return source && target && type ? [{ source, target, type }] : [];
      }),
      truncated: nodes.data.length >= GRAPH_ROW_CAP || edges.data.length >= GRAPH_ROW_CAP,
    },
  };
}

export const CHOICE_TREE_LABELS = ["Question", "Option", "Choice"];

/**
 * The `focus` node and its `PARENT_OF` descendants carrying any of `labels`
 * (default `Question`, `Option` and `Choice`), read by Cypher (the REST node listing
 * only knows a fixed set of labels and reports `node_type` from the wrong
 * label). Selection is by label, never `node_type`.
 */
export async function getChoiceTree(
  caller: Caller,
  focusRefId: string,
  labels: string[] = CHOICE_TREE_LABELS,
): Promise<WorkbenchResult<ChoiceTreeData>> {
  if (useMocks() && isRunGraphRefId(focusRefId) && labels.every((l) => IDENT.test(l))) {
    await mockLatency();
    return { ok: true, data: mockChoiceTreeWithWrites(focusRefId, labels) };
  }
  const tree = await readTree(caller, focusRefId, {
    labels,
    edges: ["PARENT_OF"],
    depth: 20,
    extra: (n) =>
      `[(${n})-[he:HAS_EFFECT]->(x:Effect) WHERE ${edgeLive("he")} AND ${nodeLive("x")} | ` +
      `{ref_id: x.ref_id, name: x.name, description: x.description, direction: x.direction, impact: x.impact, ` +
      `against: [(x)-[ag:AGAINST]->(rq:Requirement) WHERE ${edgeLive("ag")} AND ${nodeLive("rq")} | rq.ref_id]}] AS effects, ` +
      `[(${n})-[ro:RATED_ON]->(c) WHERE (c:Fast OR c:Good OR c:Cheap) AND ${edgeLive("ro")} | ` +
      `{corner: head([l IN labels(c) WHERE l IN ['Fast', 'Good', 'Cheap']]), score: ro.score}] AS ratings`,
  });
  if (!tree.ok) return tree;
  return {
    ok: true,
    data: {
      nodes: tree.data.nodes.map((r) => {
        const type: ChoiceTreeNode["type"] = r.labels.includes("Question")
          ? "Question"
          : r.labels.includes("Option")
            ? "Option"
            : "Choice";
        const option = type === "Option";
        const effects = option ? toEffects(r.row.effects) : [];
        const ratings = option ? toRatings(r.row.ratings) : {};
        return {
          ref_id: r.ref_id,
          type,
          properties: r.properties,
          ...(effects.length ? { effects } : {}),
          ...(Object.keys(ratings).length ? { ratings } : {}),
        };
      }),
      edges: tree.data.edges.map(({ source, target }) => ({ source, target })),
      truncated: tree.data.truncated,
    },
  };
}

// ── Brainstorm roots ────────────────────────────────────────────────────────

export interface BrainstormRoot {
  ref_id: string;
  /** The root question's `text`, else its `name`, else its ref_id. */
  text: string;
  /** The strut job that wrote it, when it says. */
  job: string | null;
  made_by: string | null;
}

/** Brainstorms listed at most (newest first). */
export const BRAINSTORM_LIST_CAP = 50;

/**
 * The brainstorms of a workspace: `Question` nodes (and legacy `Choice` nodes
 * with `kind: "question"`) that no live `PARENT_OF` edge from a question,
 * option or choice points at — the roots. Newest first by `date_added_to_graph`
 * (when the node has it), then by ref_id; at most `BRAINSTORM_LIST_CAP`.
 */
export async function listBrainstormRoots(caller: Caller): Promise<WorkbenchResult<BrainstormRoot[]>> {
  if (useMocks()) return { ok: true, data: mockBrainstormListWithWrites() };
  const isParent = CHOICE_TREE_LABELS.map((l) => `p:\`${l}\``).join(" OR ");
  const result = await rows(
    caller,
    `MATCH (n) WHERE (n:\`Question\` OR (n:\`Choice\` AND n.kind = 'question')) AND ${nodeLive("n")} ` +
      `OPTIONAL MATCH (p)-[e:PARENT_OF]->(n) WHERE (${isParent}) AND ${edgeLive("e")} AND ${nodeLive("p")} ` +
      `WITH n, count(p) AS parents WHERE parents = 0 ` +
      `RETURN n.ref_id AS id, n.text AS text, n.name AS name, n.job AS job, n.made_by AS made_by ` +
      `ORDER BY coalesce(n.date_added_to_graph, 0) DESC, n.ref_id DESC LIMIT ${BRAINSTORM_LIST_CAP}`,
    BRAINSTORM_LIST_CAP,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.slice(0, BRAINSTORM_LIST_CAP).flatMap((r) => {
      const id = str(r.id);
      return id && isRunGraphRefId(id)
        ? [{ ref_id: id, text: str(r.text) ?? str(r.name) ?? id, job: str(r.job), made_by: str(r.made_by) }]
        : [];
    }),
  };
}

// ── Initiative tree ─────────────────────────────────────────────────────────

/**
 * The edges that hang the plan together (Jarvis 133–135): an initiative's
 * brief, user stories (with their requirements) and milestones; a milestone's
 * features; a feature's architecture.
 */
const INITIATIVE_TREE_EDGES = [
  "HAS_BRIEF",
  "HAS_STORY",
  "HAS_REQUIREMENT",
  "HAS_MILESTONE",
  "HAS_FEATURE",
  "HAS_ARCHITECTURE",
];

/**
 * Initiative → milestone → feature → architecture is the deepest chain, and
 * reaches the requirements of plans written before 135, whose stories hang
 * off features (feature → story → requirement).
 */
const INITIATIVE_TREE_DEPTH = 4;

export interface InitiativeTreeNode {
  ref_id: string;
  type: InitiativeTreeType;
  properties: Record<string, unknown>;
  /** The brainstorms about this node (root `Question` ref_ids, by `ABOUT`). */
  brainstorms?: string[];
  /** The brainstorm options whose choice made this node (`Option -RESULTED_IN->`). */
  madeBy?: string[];
}

export interface InitiativeTreeData {
  nodes: InitiativeTreeNode[];
  edges: Array<{ source: string; target: string; type: string }>;
  stage: InitiativeStage;
  truncated: boolean;
  /** A build job is writing to this initiative right now (mock mode only, for now). */
  building?: boolean;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * An initiative and everything planned under it — brief, user stories and
 * requirements, milestones, features with their architecture — linked by
 * the planning
 * edges, with the edges among them and the counts a card shows. Every node
 * carries the brainstorms about it and the options whose choice made it. Read
 * by label, like `getChoiceTree`.
 */
export async function getInitiativeTree(caller: Caller, refId: string): Promise<WorkbenchResult<InitiativeTreeData>> {
  if (useMocks() && isRunGraphRefId(refId)) {
    await mockLatency();
    const data = mockInitiativeTree(refId);
    return { ok: true, data: { ...data, stage: initiativeStage(data.nodes), truncated: false } };
  }
  const tree = await readTree(caller, refId, {
    labels: INITIATIVE_TREE_READ_LABELS,
    edges: INITIATIVE_TREE_EDGES,
    depth: INITIATIVE_TREE_DEPTH,
    extra: (n) =>
      `[(q:\`Question\`)-[a:ABOUT]->(${n}) WHERE ${edgeLive("a")} AND ${nodeLive("q")} | q.ref_id] AS brainstorms, ` +
      `[(o:\`Option\`)-[ro:RESULTED_IN]->(${n}) WHERE ${edgeLive("ro")} AND ${nodeLive("o")} | o.ref_id] AS made_by`,
  });
  if (!tree.ok) return tree;
  const nodes = tree.data.nodes.flatMap((r): InitiativeTreeNode[] => {
    const type = INITIATIVE_TREE_READ_LABELS.find((l) => r.labels.includes(l));
    if (!type) return [];
    const brainstorms = strings(r.row.brainstorms);
    const madeBy = strings(r.row.made_by);
    return [
      {
        ref_id: r.ref_id,
        type,
        properties: r.properties,
        ...(brainstorms.length ? { brainstorms } : {}),
        ...(madeBy.length ? { madeBy } : {}),
      },
    ];
  });
  return {
    ok: true,
    data: { nodes, edges: tree.data.edges, stage: initiativeStage(nodes), truncated: tree.data.truncated },
  };
}

// ── Initiatives ─────────────────────────────────────────────────────────────

export interface InitiativeSummary {
  ref_id: string;
  name: string;
  status: string | null;
  /** When it was made, ms: when it reached the graph (`date_added_to_graph`), else `created_at`, else `updated_at`. */
  created_at: number | null;
  /**
   * How recent it is, ms: the later of reaching the graph and `updated_at` (capped at now), so a date a model
   * wrote can't file a new initiative as old. The canvas's desk shows the latest.
   */
  updated_at: number | null;
  created_by: string | null;
  created_by_kind: string | null;
  assignee_id: string | null;
}

/** Initiatives read at most, before sorting by recency. */
const INITIATIVE_SCAN_CAP = 500;

/**
 * The workspace's `HiveInitiative` nodes, most recently updated first
 * (`updated_at`, falling back to when it was made: `created_at`, then
 * `date_added_to_graph`), at most `limit`. `building` is true while a build
 * job writes to any of them.
 */
export async function listInitiatives(
  caller: Caller,
  limit = 5,
): Promise<WorkbenchResult<{ initiatives: InitiativeSummary[]; building: boolean }>> {
  if (useMocks()) {
    await mockLatency();
    return {
      ok: true,
      data: { initiatives: mockInitiativeList().slice(0, limit), building: mockInitiativesBuilding() },
    };
  }
  const result = await rows(
    caller,
    `MATCH (n:\`HiveInitiative\`) WHERE ${nodeLive("n")} ` +
      `RETURN n.ref_id AS id, n.name AS name, n.status AS status, n.created_at AS created_at, ` +
      `n.date_added_to_graph AS added, n.updated_at AS updated_at, n.created_by AS created_by, ` +
      `n.created_by_kind AS created_by_kind, n.assignee_id AS assignee_id LIMIT ${INITIATIVE_SCAN_CAP}`,
    INITIATIVE_SCAN_CAP,
  );
  if (!result.ok) return result;
  const when = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
  const now = Date.now();
  const initiatives = result.data
    .flatMap((r): InitiativeSummary[] => {
      const id = str(r.id);
      if (!id) return [];
      // The graph's own stamp first: `created_at`/`updated_at` may be what a model wrote (a year off, say).
      const added = graphEpochToMs(r.added);
      const created = added ?? when(r.created_at) ?? when(r.updated_at);
      // Recency is the later of reaching the graph and the last change, never in the future.
      const changed = when(r.updated_at);
      const updated = Math.max(added ?? 0, changed !== null ? Math.min(changed, now) : 0) || created;
      return [
        {
          ref_id: id,
          name: str(r.name) ?? id,
          status: str(r.status),
          created_at: created,
          updated_at: updated,
          created_by: str(r.created_by),
          created_by_kind: str(r.created_by_kind),
          assignee_id: str(r.assignee_id),
        },
      ];
    })
    .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0) || b.ref_id.localeCompare(a.ref_id))
    .slice(0, limit);
  return { ok: true, data: { initiatives, building: false } };
}
