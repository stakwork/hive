/**
 * Read-model behind `propose_delete_node` and its approval handler.
 *
 * Both the propose-time card and the approval-time re-check run the SAME
 * summary read (`readNodeDeleteSummary`) against live graph data through
 * `rows()` (`src/services/graph/workbench.ts`), so they inherit its
 * membership gate, read-only guard, and swarm resolution — and so the two
 * checks can never drift. `verifyNodeSoftDeleted` is the final read that
 * decides whether an approval is honestly reported as success.
 *
 * Neither helper ever throws: a failure is folded into `{ ok: false,
 * reason: "unavailable" }` / `"unknown"` so callers can treat "the graph
 * didn't answer" as its own outcome, never as "the node is gone."
 */

import { rows } from "@/services/graph/workbench";
import { isSafeRefId } from "@/services/swarm/api/nodes";

interface Caller {
  slug: string;
  userId: string;
}

/** Checked at call time, like `workbench.ts`'s own mock branch: tests flip it per test. */
const useMocks = () => process.env.USE_MOCKS === "true";

/**
 * Hive sends no `namespace` on graph-write calls, so Jarvis applies its own
 * default partition. Inlined as a literal rather than configured — a
 * mismatch here would silently read/delete the wrong namespace's node.
 */
export const JARVIS_DEFAULT_NAMESPACE = "default";

/**
 * The non-`Data_Bank` labels in jarvis-backend's `REF_ID_LABELS`
 * (`api/service/node_service.py`): system nodes, not content. An edge to
 * one of these is kept on delete, never hard-deleted, the same as an edge
 * to another namespace.
 */
export const JARVIS_SYSTEM_LABELS = ["Schema", "CronConfig", "MigrationRollback", "NameSpace", "About"];

/** A readable name for node `v`, same priority the workbench reads. */
const nameOf = (v: string) => `coalesce(${v}.name, ${v}.title, ${v}.tool_name, ${v}.file, ${v}.path, ${v}.ref_id)`;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface NodeDeleteEdge {
  edge_type: string;
  direction: "outgoing" | "incoming";
  other_ref_id: string;
  other_name?: string;
  muted: boolean;
}

export interface NodeDeleteSummary {
  labels: string[];
  name: string;
  is_deleted: boolean;
  unique_source_id?: string;
  /** At most 25 edges Jarvis's single-node delete would hard-delete. */
  edges: NodeDeleteEdge[];
  /** Total edges that would be hard-deleted (may exceed `edges.length`). */
  edge_total: number;
  /** Edges to another namespace, or to a system node, that are kept. */
  kept_edges: number;
}

export type NodeDeleteSummaryResult =
  | { ok: true; summary: NodeDeleteSummary }
  | { ok: false; reason: "not_found" | "ambiguous" | "unavailable" };

/** `true`/`false` read off `is_deleted`; `"unknown"` when the graph couldn't answer or answered oddly. */
export type VerifyDeletedResult = true | false | "unknown";

// ─── Mocks (USE_MOCKS) ──────────────────────────────────────────────────

/**
 * Keyed by ref_id, following `mockNodeConnections` in `workbench.ts`.
 * Reuses `concept-glimmer` / `concept-chat-artifacts` from
 * `workbench-fixture.ts` for the "has edges" / "no edges" cases; the rest
 * are sentinel ref_ids this module owns, for scenarios the shared fixture
 * has no reason to model (mirror-owned labels, code-graph nodes, ingested
 * nodes, already-deleted nodes, ambiguity, a hub with 25+ edges).
 */
const MOCK_SUMMARIES: Record<string, NodeDeleteSummaryResult> = {
  // Reused from workbench-fixture.ts: a plain Concept with a few edges,
  // including one muted and one cross-namespace-shaped kept edge.
  "concept-glimmer": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "Concept"],
      name: "Glimmer (gRLM)",
      is_deleted: false,
      edges: [
        { edge_type: "PARENT_OF", direction: "outgoing", other_ref_id: "concept-coding", other_name: "Coding", muted: false },
        { edge_type: "PARENT_OF", direction: "outgoing", other_ref_id: "concept-verification", other_name: "Verification", muted: true },
        { edge_type: "HAS_CONCEPT", direction: "incoming", other_ref_id: "hive-workspace-mock", other_name: "mock-stakgraph", muted: false },
      ],
      edge_total: 3,
      kept_edges: 1,
    },
  },
  // Reused: not a source/target of any mock edge — the no-edges case.
  "concept-chat-artifacts": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "Concept"],
      name: "Chat Artifacts",
      is_deleted: false,
      edges: [],
      edge_total: 0,
      kept_edges: 0,
    },
  },
  "mock-delete-many-edges": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "Concept"],
      name: "Hub Concept",
      is_deleted: false,
      edges: Array.from({ length: 25 }, (_, i) => ({
        edge_type: "RELATED_TO",
        direction: "outgoing" as const,
        other_ref_id: `mock-edge-${i}`,
        other_name: `Edge ${i}`,
        muted: false,
      })),
      edge_total: 40,
      kept_edges: 0,
    },
  },
  "mock-delete-mirror-owned": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "HiveFeature"],
      name: "Mirror Feature",
      is_deleted: false,
      edges: [],
      edge_total: 0,
      kept_edges: 0,
    },
  },
  "mock-delete-code-graph": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "File"],
      name: "index.ts",
      is_deleted: false,
      edges: [],
      edge_total: 0,
      kept_edges: 0,
    },
  },
  "mock-delete-ingested": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "Concept"],
      name: "Ingested Concept",
      is_deleted: false,
      unique_source_id: "src-123",
      edges: [],
      edge_total: 0,
      kept_edges: 0,
    },
  },
  "mock-delete-already-deleted": {
    ok: true,
    summary: {
      labels: ["Data_Bank", "Node", "Concept"],
      name: "Gone Concept",
      is_deleted: true,
      edges: [],
      edge_total: 0,
      kept_edges: 0,
    },
  },
  "mock-delete-not-found": { ok: false, reason: "not_found" },
  "mock-delete-ambiguous": { ok: false, reason: "ambiguous" },
  "mock-delete-unavailable": { ok: false, reason: "unavailable" },
};

function mockNodeDeleteSummary(ref_id: string): NodeDeleteSummaryResult {
  const found = MOCK_SUMMARIES[ref_id];
  if (found) return found;
  // Unknown ref_id: a generic plain node, matching the mock Jarvis GET route's fallback.
  return {
    ok: true,
    summary: { labels: ["Data_Bank", "Node", "Concept"], name: "Mock Node", is_deleted: false, edges: [], edge_total: 0, kept_edges: 0 },
  };
}

/** Sentinel ref_ids for `verifyNodeSoftDeleted` outcomes other than the default `true`. */
const MOCK_VERIFY: Record<string, VerifyDeletedResult> = {
  "mock-verify-false": false,
  "mock-verify-unknown": "unknown",
};

function mockVerifyNodeSoftDeleted(ref_id: string): VerifyDeletedResult {
  return MOCK_VERIFY[ref_id] ?? true;
}

// ─── Reads ──────────────────────────────────────────────────────────────

/**
 * One node (by `ref_id`, scoped to Jarvis's default namespace) and the
 * edges its single-node delete would touch: hard-deleted edges capped at
 * 25 with a total, and a count of edges kept (another namespace, or a
 * system-node label). A node with no edges still returns one row — the
 * `OPTIONAL MATCH` keeps the anchor row even when nothing joins.
 *
 * Never throws. `limit: 2` (not 1) so a duplicate `ref_id` reads as
 * `ambiguous` instead of silently picking one.
 */
export async function readNodeDeleteSummary(slug: string, userId: string, ref_id: string): Promise<NodeDeleteSummaryResult> {
  if (!isSafeRefId(ref_id)) return { ok: false, reason: "not_found" };
  if (useMocks()) return mockNodeDeleteSummary(ref_id);
  try {
    const caller: Caller = { slug, userId };
    const ns = JARVIS_DEFAULT_NAMESPACE;
    const systemLabels = JARVIS_SYSTEM_LABELS.map((l) => `'${l}'`).join(",");
    const query =
      `MATCH (n:Data_Bank {ref_id:'${ref_id}'}) WHERE n.namespace = '${ns}' ` +
      `OPTIONAL MATCH (n)-[r]-(o) WHERE coalesce(r.is_deleted,false)=false ` +
      `WITH n, r, o, (o IS NOT NULL AND o.namespace = n.namespace AND NOT any(l IN labels(o) WHERE l IN [${systemLabels}])) AS willDelete ` +
      `WITH n, ` +
      `collect(CASE WHEN r IS NOT NULL AND willDelete THEN {edge_type: type(r), outgoing: startNode(r) = n, other_ref_id: o.ref_id, other_name: ${nameOf("o")}, muted: coalesce(r.is_muted,false)} END)[0..25] AS edgeList, ` +
      `count(CASE WHEN r IS NOT NULL AND willDelete THEN 1 END) AS edge_total, ` +
      `count(CASE WHEN r IS NOT NULL AND NOT willDelete THEN 1 END) AS kept_edges ` +
      `RETURN labels(n) AS labels, ${nameOf("n")} AS name, coalesce(n.is_deleted,false) AS is_deleted, ` +
      `n.unique_source_id AS unique_source_id, edgeList, edge_total, kept_edges`;
    const result = await rows(caller, query, 2, 10_000);
    if (!result.ok) return { ok: false, reason: "unavailable" };
    if (result.data.length === 0) return { ok: false, reason: "not_found" };
    if (result.data.length > 1) return { ok: false, reason: "ambiguous" };
    const row = result.data[0];
    const labels = Array.isArray(row.labels) ? row.labels.filter((l): l is string => typeof l === "string") : [];
    const edges: NodeDeleteEdge[] = (Array.isArray(row.edgeList) ? row.edgeList : []).flatMap((e) => {
      if (!e || typeof e !== "object") return [];
      const rec = e as Record<string, unknown>;
      const edge_type = str(rec.edge_type);
      const other_ref_id = str(rec.other_ref_id);
      if (!edge_type || !other_ref_id) return [];
      return [
        {
          edge_type,
          direction: (rec.outgoing === true ? "outgoing" : "incoming") as "outgoing" | "incoming",
          other_ref_id,
          other_name: str(rec.other_name),
          muted: rec.muted === true,
        },
      ];
    });
    return {
      ok: true,
      summary: {
        labels,
        name: str(row.name) ?? ref_id,
        is_deleted: row.is_deleted === true,
        unique_source_id: str(row.unique_source_id),
        edges,
        edge_total: num(row.edge_total),
        kept_edges: num(row.kept_edges),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Re-reads the same anchor after an approved delete: `true` only when
 * exactly one row comes back with `is_deleted === true`. `false` for a
 * live node; `"unknown"` for anything else (zero/duplicate rows, or the
 * graph not answering) — never treated as success.
 */
export async function verifyNodeSoftDeleted(slug: string, userId: string, ref_id: string): Promise<VerifyDeletedResult> {
  if (!isSafeRefId(ref_id)) return "unknown";
  if (useMocks()) return mockVerifyNodeSoftDeleted(ref_id);
  try {
    const caller: Caller = { slug, userId };
    const ns = JARVIS_DEFAULT_NAMESPACE;
    const query = `MATCH (n:Data_Bank {ref_id:'${ref_id}'}) WHERE n.namespace = '${ns}' RETURN coalesce(n.is_deleted,false) AS is_deleted`;
    const result = await rows(caller, query, 2, 10_000);
    if (!result.ok) return "unknown";
    if (result.data.length !== 1) return "unknown";
    return result.data[0].is_deleted === true ? true : false;
  } catch {
    return "unknown";
  }
}
