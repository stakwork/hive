/**
 * `readCanvas` + `writeCanvas` — the projection pipeline.
 *
 * Reads are `authored blob + projected nodes, filtered by referential
 * integrity`. Writes split the incoming merged document back into an
 * authored-only blob.
 *
 * Callers (REST routes, agent tools, Pusher handlers) never touch
 * `Canvas.data` directly. Go through these two helpers so the
 * invariants (one row per `(orgId, ref)`, empty-string sentinel for
 * root, authored-vs-live split) are applied in exactly one place.
 */
import { Prisma } from "@prisma/client";
import type { CanvasData, CanvasEdge, CanvasNode } from "system-canvas";
import { db } from "@/lib/db";
import { isLiveId, parseScope } from "./scope";
import { PROJECTORS } from "./projectors";
import { computeChildRollups } from "./rollups";
import type { CanvasBlob } from "./types";

// ---------------------------------------------------------------------------
// Blob <-> JSON
// ---------------------------------------------------------------------------

const EMPTY_BLOB: CanvasBlob = { nodes: [], edges: [] };

/**
 * Normalize whatever we pulled out of Postgres into a `CanvasBlob`.
 * The DB column is `Json` so we defensively default missing fields —
 * rows written before `positions` / `hidden` existed are automatically
 * upgraded (read-only; we only write the new fields when the user
 * actually sets them).
 */
function asBlob(value: unknown): CanvasBlob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_BLOB };
  }
  const v = value as Partial<CanvasBlob>;
  return {
    nodes: Array.isArray(v.nodes) ? (v.nodes as CanvasNode[]) : [],
    edges: Array.isArray(v.edges) ? (v.edges as CanvasEdge[]) : [],
    positions:
      v.positions && typeof v.positions === "object" && !Array.isArray(v.positions)
        ? (v.positions as CanvasBlob["positions"])
        : undefined,
    hidden: Array.isArray(v.hidden) ? (v.hidden as string[]) : undefined,
  };
}

async function loadBlob(orgId: string, ref: string): Promise<CanvasBlob> {
  const row = await db.canvas.findUnique({
    where: { orgId_ref: { orgId, ref } },
    select: { data: true },
  });
  if (!row) return { ...EMPTY_BLOB };
  return asBlob(row.data);
}

async function storeBlob(
  orgId: string,
  ref: string,
  blob: CanvasBlob,
): Promise<void> {
  const jsonData = blob as unknown as Prisma.InputJsonValue;
  await db.canvas.upsert({
    where: { orgId_ref: { orgId, ref } },
    update: { data: jsonData },
    create: { orgId, ref, data: jsonData },
  });
}

// ---------------------------------------------------------------------------
// Merge — turn `(blob, projectors)` into the `CanvasData` the client sees.
// ---------------------------------------------------------------------------

/**
 * Apply rollups to a live node's `customData`. The plan's rule:
 * **manual customData wins; rollup fills the gaps.** We already merge
 * edges and positions elsewhere — this is the one place rollup values
 * get stamped into nodes, and it's non-destructive on purpose.
 */
function applyRollup(
  node: CanvasNode,
  rollup: Record<string, unknown> | undefined,
): CanvasNode {
  if (!rollup || Object.keys(rollup).length === 0) return node;
  const existing = node.customData ?? {};
  const merged: Record<string, unknown> = { ...rollup };
  for (const [k, v] of Object.entries(existing)) {
    if (v !== undefined) merged[k] = v;
  }
  return { ...node, customData: merged };
}

/**
 * Apply the user's stored per-canvas position to a live node, if any.
 * Missing keys fall back to whatever the projector supplied.
 */
function applyPosition(
  node: CanvasNode,
  positions: CanvasBlob["positions"],
): CanvasNode {
  const p = positions?.[node.id];
  if (!p) return node;
  return { ...node, x: p.x, y: p.y };
}

async function projectAll(
  ref: string,
  orgId: string,
): Promise<{
  liveNodes: CanvasNode[];
  rollups: Record<string, Record<string, unknown>>;
}> {
  const scope = parseScope(ref);
  const results = await Promise.all(
    PROJECTORS.map((p) => p.project(scope, orgId)),
  );
  const liveNodes: CanvasNode[] = [];
  const rollups: Record<string, Record<string, unknown>> = {};
  for (const r of results) {
    for (const n of r.nodes) liveNodes.push(n);
    if (r.rollups) {
      for (const [id, data] of Object.entries(r.rollups)) {
        rollups[id] = { ...(rollups[id] ?? {}), ...data };
      }
    }
  }
  return { liveNodes, rollups };
}

/**
 * Read the canvas at `(orgId, ref)` as a merged `CanvasData`:
 *
 *   1. Parse the ref into a Scope.
 *   2. Load the authored blob (missing row → empty blob).
 *   3. Run all projectors; collect live nodes + rollups.
 *   4. Drop hidden live nodes.
 *   5. Apply stored positions to the survivors.
 *   6. Merge rollups into each live node's customData.
 *   7. Concat live + authored nodes.
 *   8. Compute child-canvas rollups for drillable authored nodes
 *      (objectives) and stamp them into customData.
 *   9. Filter edges to those with both endpoints present.
 *
 * See `docs/plans/org-canvas.md` § "The merge" for the spec this
 * implements.
 */
export async function readCanvas(
  orgId: string,
  ref: string,
): Promise<CanvasData> {
  const blob = await loadBlob(orgId, ref);
  const { liveNodes, rollups } = await projectAll(ref, orgId);

  const hidden = new Set(blob.hidden ?? []);
  const visibleLive = liveNodes
    .filter((n) => !hidden.has(n.id))
    .map((n) => applyPosition(n, blob.positions))
    .map((n) => applyRollup(n, rollups[n.id]));

  // Authored nodes get a second enrichment pass: for drillable
  // objectives, we peek into their child canvas and roll up the
  // progress of the mini-objectives inside. Manual customData still
  // wins (same rule applyRollup enforces), so a user who's typed
  // their own `status` or `primary` keeps it.
  const childRollups = await computeChildRollups(orgId, blob.nodes);
  const authored = blob.nodes.map((n) => applyRollup(n, childRollups[n.id]));

  const nodes: CanvasNode[] = [...visibleLive, ...authored];
  const presentIds = new Set(nodes.map((n) => n.id));
  const edges = blob.edges.filter(
    (e) => presentIds.has(e.fromNode) && presentIds.has(e.toNode),
  );

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Split — turn the merged `CanvasData` the client sends back into a blob.
// ---------------------------------------------------------------------------

/**
 * Categories whose authored nodes get a sub-canvas. When we store one
 * of these, we auto-stamp `ref: "node:<id>"` so the library's
 * drill-in hook (`onResolveCanvas`) fires on click. The agent never
 * has to know about this — the ref always mirrors the node id.
 *
 * Adding a new drillable category: append the id here and the
 * sub-canvas lights up automatically (blank authored blob, same
 * read/write pipeline as every other canvas row).
 */
const DRILLABLE_CATEGORIES = new Set(["objective"]);

function drillableRefFor(node: CanvasNode): string {
  return `node:${node.id}`;
}

/**
 * Reduce an incoming merged `CanvasData` to just the authored half +
 * any new position overlays for live ids. Pure; no DB access.
 *
 * Field ownership:
 *   - authored nodes: kept verbatim. Drillable categories
 *     (`DRILLABLE_CATEGORIES`) get their `ref` auto-stamped to
 *     `node:<id>` so clicking the node resolves to its sub-canvas.
 *     A non-default `ref` the caller set explicitly is preserved.
 *   - live-id text / category / customData: silently dropped (owned by
 *     projection; re-derived on read).
 *   - live-id positions: merged into `blob.positions`. Omitting a live
 *     id from the incoming document is **not** an implicit "hide" —
 *     we keep its previous position untouched so that stale or
 *     partial writes (autosave race, agent that forgot to echo) don't
 *     silently lose a user's drag. Use the dedicated hide endpoint to
 *     hide a live node.
 *   - `hidden`: preserved from `previous`; never touched by this path.
 */
export function splitCanvas(
  incoming: CanvasData,
  previous: CanvasBlob,
): CanvasBlob {
  const nodes: CanvasNode[] = [];
  const positions: Record<string, { x: number; y: number }> = {
    ...(previous.positions ?? {}),
  };

  for (const n of incoming.nodes ?? []) {
    if (isLiveId(n.id)) {
      positions[n.id] = { x: n.x, y: n.y };
      continue;
    }
    if (n.category && DRILLABLE_CATEGORIES.has(n.category) && !n.ref) {
      nodes.push({ ...n, ref: drillableRefFor(n) });
    } else {
      nodes.push(n);
    }
  }

  const edges: CanvasEdge[] = incoming.edges ?? [];

  const blob: CanvasBlob = { nodes, edges };
  if (Object.keys(positions).length > 0) blob.positions = positions;
  if (previous.hidden && previous.hidden.length > 0) blob.hidden = previous.hidden;
  return blob;
}

/**
 * Persist a client-side merged `CanvasData` at `(orgId, ref)`. Splits
 * it back into an authored blob before writing.
 *
 * The pipeline is **idempotent**: `writeCanvas(read)` is a no-op modulo
 * the DB's `updatedAt`. Round-trip safety is the property we care about
 * the most — it's what lets the agent call `read_canvas` → mutate →
 * `update_canvas` without accidentally clobbering DB-owned fields.
 */
export async function writeCanvas(
  orgId: string,
  ref: string,
  incoming: CanvasData,
): Promise<CanvasBlob> {
  const previous = await loadBlob(orgId, ref);
  const blob = splitCanvas(incoming, previous);
  await storeBlob(orgId, ref, blob);
  return blob;
}

/**
 * Summary of a hidden live node — just enough for a "Restore" UI to show
 * a recognizable label next to each entry. Extend carefully: this shape
 * crosses the REST boundary.
 */
export interface HiddenLiveEntry {
  /** The live id, e.g. `ws:abc`. Round-trip into `showLiveNode`. */
  id: string;
  /** Display label sourced from the projector (workspace name, etc.). */
  name: string;
  /** Prefix kind — lets the UI group entries ("Hidden workspaces"). */
  kind: string;
}

/**
 * List live nodes hidden on this canvas, resolved to display metadata.
 *
 * The name comes from the projector's own `text` — we run projection
 * exactly once here to avoid duplicating the "how do I look up a
 * workspace name" logic. An entry in `blob.hidden` with no matching
 * projection (entity was deleted after being hidden) drops out silently,
 * which is also the right behavior for the UI: you can't restore
 * something that no longer exists.
 */
export async function readHiddenLive(
  orgId: string,
  ref: string,
): Promise<HiddenLiveEntry[]> {
  const blob = await loadBlob(orgId, ref);
  const hiddenIds = blob.hidden;
  if (!hiddenIds || hiddenIds.length === 0) return [];

  const { liveNodes } = await projectAll(ref, orgId);
  const byId = new Map(liveNodes.map((n) => [n.id, n]));

  const out: HiddenLiveEntry[] = [];
  for (const id of hiddenIds) {
    const node = byId.get(id);
    if (!node) continue;
    const kind = id.split(":")[0] ?? "";
    out.push({ id, name: node.text ?? id, kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hidden-list mutations — dedicated endpoints per the plan, so autosave
// (which only writes nodes + positions) can't accidentally reset them.
// ---------------------------------------------------------------------------

export async function hideLiveNode(
  orgId: string,
  ref: string,
  liveId: string,
): Promise<void> {
  if (!isLiveId(liveId)) {
    throw new Error(`hideLiveNode called with non-live id: ${liveId}`);
  }
  const blob = await loadBlob(orgId, ref);
  const hidden = new Set(blob.hidden ?? []);
  if (hidden.has(liveId)) return;
  hidden.add(liveId);
  await storeBlob(orgId, ref, { ...blob, hidden: [...hidden] });
}

export async function showLiveNode(
  orgId: string,
  ref: string,
  liveId: string,
): Promise<void> {
  const blob = await loadBlob(orgId, ref);
  if (!blob.hidden || blob.hidden.length === 0) return;
  const next = blob.hidden.filter((id) => id !== liveId);
  if (next.length === blob.hidden.length) return;
  await storeBlob(orgId, ref, {
    ...blob,
    hidden: next.length > 0 ? next : undefined,
  });
}
