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
    // Defensive: only accept an array of strings. Rows written before
    // `assignedFeatures` existed produce `undefined`, which the
    // workspace projector treats as "no features pinned" — same effect
    // as an empty list.
    assignedFeatures: Array.isArray(v.assignedFeatures)
      ? (v.assignedFeatures as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : undefined,
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
 * Drop authored `research` placeholder nodes that have been "swallowed"
 * by a live `research:<id>` node with the same text.
 *
 * **Why this exists.** The `+ Research` flow drops a temporary
 * authored node onto the canvas (text = the user's typed topic) and
 * fires a chat kickoff. The agent eventually calls `save_research`,
 * which inserts a row whose projector emits a live `research:<id>`
 * node carrying the same text. From that moment on, the canvas has
 * two visually-identical nodes: the authored placeholder and the live
 * card. We can't delete the authored node from the client at the
 * moment of swap reliably (the previous attempt fought autosave +
 * pusher refetch races and never converged); instead, we de-duplicate
 * **at the IO boundary** so reads always show one and writes always
 * persist one.
 *
 * **The rule.** A live `research:<id>` and an authored `research`
 * (no `:` prefix) with matching trimmed text are the same logical
 * node. The authored one is the leftover; drop it. We carry the
 * authored node's `(x, y)` into the live node's position overlay
 * (only when no overlay entry already exists) so the live card
 * lands exactly where the user clicked, even if the agent's
 * `save_research` returned before the position-overlay PUT did.
 *
 * **Where this is called.**
 *   - `readCanvas` — after the merge step, before returning. Hides
 *     the authored placeholder from every reader, immediately.
 *   - `splitCanvas` — before persisting the authored blob. Removes
 *     the placeholder from disk so the blob converges to clean state
 *     on the next autosave. (Read-side dedupe alone would leave
 *     dead authored entries lingering in `Canvas.data.nodes`
 *     forever; harmless but ugly.)
 *
 * **Identity is text-based**, not id-based, because the authored id
 * (UUID generated by the canvas library) and the live id
 * (`research:<cuid>`) have no relationship. The agent's prompt tells
 * it to pass the user's topic verbatim into `save_research.topic`,
 * so text equality is reliable. If the agent rewrites the topic
 * heavily the dedupe misses; the user gets two cards and can delete
 * the authored one. Acceptable failure mode.
 */
interface DedupeResult {
  /** Survivor nodes after dropping authored research duplicates. */
  nodes: CanvasNode[];
  /**
   * For each authored node we dropped, the live id it was matched to
   * and the (x,y) we want to carry forward as a position overlay.
   * Only the read-side caller acts on these; the write side ignores
   * them (positions for live ids are persisted via the `positions`
   * overlay map already, separately).
   */
  carryPositions: Array<{ liveId: string; x: number; y: number }>;
}

function dedupeAuthoredResearch(nodes: CanvasNode[]): DedupeResult {
  // Index live research nodes by trimmed text. A live research node
  // with empty text shouldn't exist (the projector always sets text
  // from `Research.topic`, which is required), but guard anyway.
  const liveByText = new Map<string, CanvasNode>();
  for (const n of nodes) {
    if (!n.id.startsWith("research:")) continue;
    const t = (n.text ?? "").trim();
    if (!t) continue;
    // First live node wins for any given text. Multiple live rows
    // sharing the same topic shouldn't happen in practice (the
    // projector orders by `updatedAt desc` and slugs are unique
    // within an org) but if they do, the deterministic pick keeps
    // dedupe stable across reads.
    if (!liveByText.has(t)) liveByText.set(t, n);
  }

  if (liveByText.size === 0) {
    // No live research nodes at all \u2014 nothing to dedupe against.
    return { nodes, carryPositions: [] };
  }

  const survivors: CanvasNode[] = [];
  const carryPositions: Array<{ liveId: string; x: number; y: number }> = [];

  for (const n of nodes) {
    const isAuthoredResearch =
      n.category === "research" && !n.id.startsWith("research:");
    if (!isAuthoredResearch) {
      survivors.push(n);
      continue;
    }
    const t = (n.text ?? "").trim();
    const live = t ? liveByText.get(t) : undefined;
    if (!live) {
      // No matching live node yet \u2014 the authored placeholder is the
      // only thing on the canvas (the agent hasn't returned
      // `save_research` yet, OR this authored node's text never
      // matched a live row). Keep it; the user is still seeing
      // their in-progress placeholder.
      survivors.push(n);
      continue;
    }
    // Drop the authored node. Carry its position to the live node
    // so the live card lands where the user clicked. (Read-side
    // applies this; write-side ignores.)
    carryPositions.push({ liveId: live.id, x: n.x, y: n.y });
  }

  return { nodes: survivors, carryPositions };
}

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
  blob: CanvasBlob,
): Promise<{
  liveNodes: CanvasNode[];
  liveEdges: CanvasEdge[];
  rollups: Record<string, Record<string, unknown>>;
  columns: CanvasLane[] | undefined;
  rows: CanvasLane[] | undefined;
}> {
  const scope = parseScope(ref);
  // Single read-only context shared by every projector — keeps the
  // blob-derived inputs (`assignedFeatures` today) out of every
  // projector's individual `findUnique`. Projectors that don't need
  // any of these fields simply ignore the second arg.
  const context = {
    assignedFeatures: blob.assignedFeatures,
  };
  const results = await Promise.all(
    PROJECTORS.map((p) => p.project(scope, orgId, context)),
  );
  const liveNodes: CanvasNode[] = [];
  const liveEdges: CanvasEdge[] = [];
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
    if (r.edges) {
      for (const e of r.edges) liveEdges.push(e);
    }
    if (r.rollups) {
      for (const [id, data] of Object.entries(r.rollups)) {
        rollups[id] = { ...(rollups[id] ?? {}), ...data };
      }
    }
    if (!columns && r.columns && r.columns.length > 0) columns = r.columns;
    if (!rows && r.rows && r.rows.length > 0) rows = r.rows;
  }
  return { liveNodes, liveEdges, rollups, columns, rows };
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
  const { liveNodes, liveEdges, rollups, columns, rows } = await projectAll(
    ref,
    orgId,
    blob,
  );

  const hidden = new Set(blob.hidden ?? []);
  // Apply rollups + positions to live nodes first so the dedupe step
  // sees their final coordinates (matters when the dedupe carries an
  // authored node's position into the live overlay \u2014 we don't want
  // to clobber an existing per-canvas overlay with the authored
  // placeholder's position, see below).
  const visibleLive = liveNodes
    .filter((n) => !hidden.has(n.id))
    .map((n) => applyPosition(n, blob.positions))
    .map((n) => applyRollup(n, rollups[n.id]));

  // Dedupe authored `research` placeholders against their live
  // counterparts. See `dedupeAuthoredResearch` for the contract; the
  // returned `carryPositions` lets us land the live card where the
  // user originally clicked, even if the position-overlay PUT lost a
  // race with the projector's first emit.
  const merged: CanvasNode[] = [...visibleLive, ...blob.nodes];
  const { nodes: deduped, carryPositions } = dedupeAuthoredResearch(merged);

  // Apply carry-over positions: only when no overlay entry already
  // exists (the user may have intentionally moved the live card
  // since it appeared, in which case their drag wins). Mutates the
  // surviving live node in `deduped` in place, since we just built
  // that array a line ago and nothing else references it.
  if (carryPositions.length > 0) {
    const overlayHas = (id: string) =>
      blob.positions !== undefined && blob.positions[id] !== undefined;
    for (const carry of carryPositions) {
      if (overlayHas(carry.liveId)) continue;
      const target = deduped.find((n) => n.id === carry.liveId);
      if (!target) continue;
      target.x = carry.x;
      target.y = carry.y;
    }
  }

  const nodes = deduped;
  const presentIds = new Set(nodes.map((n) => n.id));
  // Authored edges live in the blob; synthetic edges (e.g.
  // `feature:<id> → milestone:<id>` for DB membership) come from
  // projectors and are never persisted. Concat both and drop any
  // dangling endpoints — synthetic edges to a hidden milestone, for
  // instance, get pruned automatically.
  const edges = [...liveEdges, ...blob.edges].filter(
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

  // Dedupe authored `research` placeholders against their live
  // counterparts BEFORE the split loop so the authored leftover
  // never makes it into the persisted blob. The dedupe also returns
  // `carryPositions` \u2014 we apply those to the `positions` overlay
  // here (only when no overlay entry already exists), so the live
  // research card stays anchored where the user clicked even if a
  // dedicated position-overlay PUT never happened.
  const incomingNodes = incoming.nodes ?? [];
  const { nodes: dedupedIncoming, carryPositions } =
    dedupeAuthoredResearch(incomingNodes);
  for (const carry of carryPositions) {
    if (positions[carry.liveId] !== undefined) continue;
    positions[carry.liveId] = { x: carry.x, y: carry.y };
  }

  for (const n of dedupedIncoming) {
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

  // Drop synthetic projector-emitted edges before persisting. They
  // represent DB membership (e.g. `feature:<X> → milestone:<Y>` from
  // `Feature.milestoneId`) and re-derive on every read. Letting them
  // round-trip into the authored blob would create a parallel
  // representation of the same relationship that could disagree with
  // the DB after a `Feature.milestoneId` change. The `synthetic:`
  // prefix is the discriminator — see `ProjectionResult.edges` in
  // `./types.ts`.
  const edges: CanvasEdge[] = (incoming.edges ?? []).filter(
    (e) => !e.id.startsWith("synthetic:"),
  );

  const blob: CanvasBlob = { nodes, edges };
  if (Object.keys(positions).length > 0) blob.positions = positions;
  if (previous.hidden && previous.hidden.length > 0) blob.hidden = previous.hidden;
  // `assignedFeatures` is preserved untouched on the autosave path for
  // the same reason `hidden` is: a routine canvas edit (drag, resize,
  // add an authored note) MUST NOT clobber the user's pinned-feature
  // list on a workspace sub-canvas. Toggling goes through dedicated
  // `assignFeatureOnCanvas` / `unassignFeatureOnCanvas` mutations.
  if (previous.assignedFeatures && previous.assignedFeatures.length > 0) {
    blob.assignedFeatures = previous.assignedFeatures;
  }
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

  const { liveNodes } = await projectAll(ref, orgId, blob);
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

/**
 * Stamp an explicit position overlay for a live id at `(orgId, ref)`.
 *
 * Used by the proposal-approval flow when the user approves a feature
 * and the new node legally projects on the user's current canvas — we
 * want the card to land where the user was looking, not at the
 * projector's auto-laid-out default. Same overlay shape that autosave
 * writes through `splitCanvas`, but a dedicated entry point so the
 * approval handler doesn't have to fake a full canvas round-trip.
 *
 * Existing overlay entries are preserved; only the supplied id's
 * position (and optionally size) is updated. Size defaults to "no
 * change" — pass `width`/`height` only when you actually want to set
 * them (proposals don't, but the signature stays open).
 */
export async function setLivePosition(
  orgId: string,
  ref: string,
  liveId: string,
  position: { x: number; y: number; width?: number; height?: number },
): Promise<void> {
  if (!isLiveId(liveId)) {
    throw new Error(`setLivePosition called with non-live id: ${liveId}`);
  }
  const blob = await loadBlob(orgId, ref);
  const positions = { ...(blob.positions ?? {}) };
  const prev = positions[liveId];
  positions[liveId] = {
    x: position.x,
    y: position.y,
    ...(position.width !== undefined
      ? { width: position.width }
      : prev?.width !== undefined
        ? { width: prev.width }
        : {}),
    ...(position.height !== undefined
      ? { height: position.height }
      : prev?.height !== undefined
        ? { height: prev.height }
        : {}),
  };
  await storeBlob(orgId, ref, { ...blob, positions });
}

// ---------------------------------------------------------------------------
// Assigned-features overlay — pin/unpin feature cards onto a canvas.
//
// Today the only canvas that honors `assignedFeatures` is the workspace
// sub-canvas (`ref` starts with `ws:`) — the workspace projector emits
// one `feature:<id>` node per id in the list. Other refs accept writes
// (a future canvas type might consume the list too) but no projector
// reads them, so pinning a feature on, e.g., an initiative canvas is a
// silent no-op at render time.
//
// Symmetric with `hideLiveNode` / `showLiveNode`: dedicated entry
// points so a routine autosave PUT can't accidentally reset the list.
// Idempotent: pinning an already-pinned feature is a no-op; unpinning
// an absent feature is a no-op.
//
// **TOCTOU**: both `assignFeatureOnCanvas` and
// `unassignFeatureOnCanvas` do a read-modify-write without a
// transaction or optimistic-lock. Two concurrent writers can lose an
// update (T1 reads, T2 reads, T1 writes [+B], T2 writes [+C] → B is
// lost). In practice:
//   - Pin-vs-pin from two users at the same moment: rare, and both
//     writers usually want the same outcome (idempotent).
//   - Agent pin + human pin: more plausible since the prompt
//     encourages the agent to call these tools. Worst case: one of
//     the two pins is lost; recoverable by re-pinning. Acceptable
//     for now; revisit with a `jsonb_set` or `SELECT … FOR UPDATE`
//     if the failure mode bites users.
// ---------------------------------------------------------------------------

/**
 * Strip the `feature:` prefix from a live id so callers can pass either
 * a bare feature id or the canvas-form live id.
 */
function bareFeatureId(featureIdOrLiveId: string): string {
  return featureIdOrLiveId.startsWith("feature:")
    ? featureIdOrLiveId.slice("feature:".length)
    : featureIdOrLiveId;
}

export async function assignFeatureOnCanvas(
  orgId: string,
  ref: string,
  featureId: string,
): Promise<void> {
  const id = bareFeatureId(featureId);
  if (!id) throw new Error("assignFeatureOnCanvas: featureId is empty");
  const blob = await loadBlob(orgId, ref);
  const current = blob.assignedFeatures ?? [];
  if (current.includes(id)) return;
  await storeBlob(orgId, ref, {
    ...blob,
    assignedFeatures: [...current, id],
  });
}

export async function unassignFeatureOnCanvas(
  orgId: string,
  ref: string,
  featureId: string,
): Promise<void> {
  const id = bareFeatureId(featureId);
  if (!id) return;
  const blob = await loadBlob(orgId, ref);
  const current = blob.assignedFeatures ?? [];
  if (current.length === 0) return;
  const next = current.filter((existing) => existing !== id);
  if (next.length === current.length) return;
  await storeBlob(orgId, ref, {
    ...blob,
    // Drop the field entirely when empty so the DB row stays compact —
    // mirrors the `hidden` cleanup in `showLiveNode`.
    assignedFeatures: next.length > 0 ? next : undefined,
  });
}

/**
 * Read the assigned-feature ids for a single canvas. Returns `[]` when
 * the row doesn't exist or the field is absent. Used by the assign-
 * existing UI to mark already-pinned features as unselectable.
 */
export async function readAssignedFeatures(
  orgId: string,
  ref: string,
): Promise<string[]> {
  const blob = await loadBlob(orgId, ref);
  return blob.assignedFeatures ?? [];
}
