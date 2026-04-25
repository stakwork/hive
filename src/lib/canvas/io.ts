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
import type {
  CanvasData,
  CanvasEdge,
  CanvasLane,
  CanvasNode,
} from "system-canvas";
import { db } from "@/lib/db";
import { isLiveId, parseScope } from "./scope";
import { PROJECTORS } from "./projectors";
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
 * Apply the user's stored per-canvas overlay to a live node. Position
 * is always present in an overlay entry; size (`width`/`height`) is
 * optional and only set when the user has resized the card. Anything
 * missing falls back to whatever the projector supplied (which itself
 * falls back to the theme default for the category).
 */
function applyPosition(
  node: CanvasNode,
  positions: CanvasBlob["positions"],
): CanvasNode {
  const p = positions?.[node.id];
  if (!p) return node;
  const next: CanvasNode = { ...node, x: p.x, y: p.y };
  if (p.width !== undefined) next.width = p.width;
  if (p.height !== undefined) next.height = p.height;
  return next;
}

async function projectAll(
  ref: string,
  orgId: string,
): Promise<{
  liveNodes: CanvasNode[];
  rollups: Record<string, Record<string, unknown>>;
  columns: CanvasLane[] | undefined;
  rows: CanvasLane[] | undefined;
}> {
  const scope = parseScope(ref);
  const results = await Promise.all(
    PROJECTORS.map((p) => p.project(scope, orgId)),
  );
  const liveNodes: CanvasNode[] = [];
  const rollups: Record<string, Record<string, unknown>> = {};
  // Lanes are decorative chrome attached to a scope, not a per-node
  // concept. We expect at most one projector per scope to emit lanes;
  // first non-empty set wins. Multiple projectors emitting on the same
  // scope is a config error — we'd just silently use one — so we don't
  // try to merge.
  let columns: CanvasLane[] | undefined;
  let rows: CanvasLane[] | undefined;
  for (const r of results) {
    for (const n of r.nodes) liveNodes.push(n);
    if (r.rollups) {
      for (const [id, data] of Object.entries(r.rollups)) {
        rollups[id] = { ...(rollups[id] ?? {}), ...data };
      }
    }
    if (!columns && r.columns && r.columns.length > 0) columns = r.columns;
    if (!rows && r.rows && r.rows.length > 0) rows = r.rows;
  }
  return { liveNodes, rollups, columns, rows };
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
 *   8. Filter edges to those with both endpoints present.
 *
 * See `docs/plans/org-initiatives.md` § "Read merge / write split" for
 * the spec this implements.
 *
 * NOTE: the pre-cutover plan included a step 8 that peeked into each
 * authored objective's child canvas and stamped a progress rollup into
 * the parent. That logic is gone: initiatives are now DB-projected, so
 * their progress comes from the projector's own SQL count of completed
 * milestones. `src/lib/canvas/rollups.ts` was deleted along with it.
 */
export async function readCanvas(
  orgId: string,
  ref: string,
): Promise<CanvasData> {
  const blob = await loadBlob(orgId, ref);
  const { liveNodes, rollups, columns, rows } = await projectAll(ref, orgId);

  const hidden = new Set(blob.hidden ?? []);
  const visibleLive = liveNodes
    .filter((n) => !hidden.has(n.id))
    .map((n) => applyPosition(n, blob.positions))
    .map((n) => applyRollup(n, rollups[n.id]));

  const nodes: CanvasNode[] = [...visibleLive, ...blob.nodes];
  const presentIds = new Set(nodes.map((n) => n.id));
  const edges = blob.edges.filter(
    (e) => presentIds.has(e.fromNode) && presentIds.has(e.toNode),
  );

  // Columns/rows are decorative — paint background bands behind nodes,
  // never snap nodes to them. Omitted from the response when no
  // projector emitted any.
  const result: CanvasData = { nodes, edges };
  if (columns) result.columns = columns;
  if (rows) result.rows = rows;
  return result;
}

// ---------------------------------------------------------------------------
// Split — turn the merged `CanvasData` the client sends back into a blob.
// ---------------------------------------------------------------------------

/**
 * Reduce an incoming merged `CanvasData` to just the authored half +
 * any new overlay entries for live ids. Pure; no DB access.
 *
 * Field ownership:
 *   - authored nodes: kept verbatim (including their own width/height).
 *   - live-id text / category / customData: silently dropped (owned by
 *     projection; re-derived on read).
 *   - live-id position (`x`/`y`): merged into `blob.positions[id]`. Always
 *     present on the incoming node, so always overwritten.
 *   - live-id size (`width`/`height`): merged into the same overlay
 *     entry **only when present** on the incoming node. Projectors don't
 *     emit size, so an absent `width`/`height` means "user has never
 *     resized — keep using the theme default." Once the user resizes
 *     once, the size sticks via the overlay (subsequent saves keep
 *     overwriting with the latest value).
 *   - Omitting a live id from the incoming document is **not** an
 *     implicit "hide" — we keep its previous overlay entry untouched so
 *     that stale or partial writes (autosave race, agent that forgot
 *     to echo) don't silently lose a user's drag/resize. Use the
 *     dedicated hide endpoint to hide a live node.
 *   - `hidden`: preserved from `previous`; never touched by this path.
 *
 * NOTE: the pre-cutover plan auto-stamped `ref: "node:<id>"` on
 * authored objective nodes here so they could drill into a child
 * canvas. That code is gone: drillable structure now lives entirely
 * on projected entities (`ws:`, `initiative:`), which carry their own
 * `ref` from the projector. Authored nodes don't drill.
 */
export function splitCanvas(
  incoming: CanvasData,
  previous: CanvasBlob,
): CanvasBlob {
  const nodes: CanvasNode[] = [];
  const positions: NonNullable<CanvasBlob["positions"]> = {
    ...(previous.positions ?? {}),
  };

  for (const n of incoming.nodes ?? []) {
    if (isLiveId(n.id)) {
      const entry: { x: number; y: number; width?: number; height?: number } = {
        x: n.x,
        y: n.y,
      };
      // Preserve a previously-saved size if the incoming node didn't
      // carry one (e.g. a partial agent write that only echoed x/y).
      // An explicit user resize always rides through with width/height
      // set; an absent value here means "no change," not "reset to
      // default." Resetting requires a new code path.
      const prev = previous.positions?.[n.id];
      const width = n.width ?? prev?.width;
      const height = n.height ?? prev?.height;
      if (width !== undefined) entry.width = width;
      if (height !== undefined) entry.height = height;
      positions[n.id] = entry;
      continue;
    }
    nodes.push(n);
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
