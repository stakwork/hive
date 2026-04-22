# Org Canvas — Live + Authored

A design for the org-level canvas where DB entities (workspaces, features, later members/tasks) live side-by-side with human/LLM-authored content (objectives, notes, decisions) on the same infinite whiteboard, navigable via zoom.

Status: **plan**. Nothing in here is implemented yet; the current canvas treats every node as authored.

## Goal

One visual surface where managers and the CEO see "the state of the org" — which workspaces exist, which strategic objectives span them, and how those objectives are progressing — and where AI agents can decorate and enrich the picture freely. Users can draw whatever they want; the system keeps DB-backed entities honest by re-projecting them on every read.

## The three concepts the whole design rests on

1. **Scope** — "what canvas am I looking at." A scope is a URI stored in the existing `Canvas.ref` column.
   - `""` → the org root.
   - `"node:<authoredNodeId>"` → zoom-into an authored node (e.g. an objective's sub-canvas).
   - More scope kinds slot in later (`ws:<id>` for a workspace team view, `feature:<id>` for a feature deep-dive).

2. **Projection** — "given a scope, what live nodes belong here." A pure function of scope + current DB state. Never persisted.

3. **Authored blob** — "what has a human or LLM drawn here." One JSON document per scope, stored in `Canvas.data`, keyed by `(orgId, ref)`.

The merged `CanvasData` the client renders is `projection(scope) + blob(scope)`, filtered by referential integrity. The stored state is only the blob.

## The model, pictured

```
                                  ┌─── readCanvas(ref) ───┐
                                  │                        │
  DB (workspaces, features, ...) ─┤  Projector(scope)       │
                                  │        ↓               │
                                  │   live nodes           │
                                  │  (+ rollups)           │
                                  │                        ├─► merged CanvasData
  Canvas.data (authored blob) ────┤        ↓               │      (one flat object
   • authored nodes               │   + authored nodes     │       the client sees)
   • edges (any endpoints)        │   + edges              │
   • positions (live ids → x,y)   │   + position overlay   │
   • hidden (live ids)            │   - hidden filter      │
                                  │   - dangling edges     │
                                  └────────────────────────┘

                                  ┌─── writeCanvas(ref) ──┐
  client sends merged  ──────────►│                        │
                                  │  split by isLiveId:    │
                                  │   authored → blob.nodes│
                                  │   live → blob.positions│
                                  │   edges → blob.edges   ├─► Canvas.data
                                  │                        │
                                  └────────────────────────┘
```

## The ontology we're working with

What the DB already owns (from `prisma/schema.prisma`):

- **Workspace** — `@sourceControlOrg`, has members, features, tasks.
- **Feature** (called a "plan" in the Hive UX) — lives inside a Workspace, has phases and tasks, has a status.
- **Phase** — inside a Feature, has tasks.
- **Task** — inside a Feature (optionally inside a Phase), has an assignee, status, priority.
- **WorkspaceMember** — user + role inside a workspace.

What the canvas adds on top, as **authored nodes only** — no new Prisma model:

- **Objective** — a free-floating story a manager or the CEO is telling. "Ship mobile by Q3", "Reduce onboarding friction", "Become SOC2-compliant." Objectives often span workspaces. They are connected, by edges, to the real Features that contribute to them. An objective's progress is derived from the Features it's edged to; the objective itself is just a JSON node in a canvas document.
- **Note** — amber free-form callout. "Remember to…" / "Open question…"
- **Decision** — purple free-form callout. "Shared vs dedicated pools?" / "Adopt X or Y?"

The key design choice: **objectives are canvas-native**, not a Prisma model. They can be renamed, reshaped, split, merged, or deleted with a single canvas write. No migration cost to iterate. The LLM can redraw them at will.

## How "links" work — by not being a separate thing

Edges are the only relation primitive.

- A user draws a line from an authored objective to a real feature. That's an edge between an authored node and a `feature:<cuid>` node. It's stored like any other edge.
- The server, on render, sees an objective with outgoing edges to live feature ids, projects the feature content (status, progress), and stamps a rollup into the objective's `customData`. Done.
- When the user zooms into the objective, the authored-sub scope projects exactly those feature ids as live nodes on the child canvas.

There is no `links` field. No `ObjectiveFeature` join table. No hidden metadata. **The edge IS the link.** This was the simplification the rest of the design hinges on.

### Trade-offs this accepts

- Every edge carries semantic weight. An arrow drawn "decoratively" from an objective to a random note creates a relationship. In v1 that's fine — there's no such thing as a purely decorative edge. Later a `kind` field on edges could distinguish "semantic" from "aesthetic" if needed.
- Rollup logic has to decide which edges count. Rule: when computing a node's rollup, walk its edges, keep only those whose other endpoint is a live entity of a kind this node rollup knows how to aggregate. Feature-id endpoints feed feature-aware rollups; note-or-decision endpoints are ignored. This rule is local to each category's rollup function — not a data-model decision.

## Canvas vs. Connections — where depth lives

Edges on the canvas are deliberately shallow. They say **"these two things are related"** and nothing more. Depth lives in the **Connections sidebar that already exists** on the org page: a Connection is a long-form document (mermaid diagram, architecture write-up, OpenAPI spec) about how two systems interact, generated by the agent via the existing `save_connection` / `update_connection` tools.

The division of labor:

- **Canvas nodes** — the "what" — workspaces, objectives, notes, decisions.
- **Canvas edges** — the "these are related" pointer. Just `{ fromNode, toNode, label? }`. Short human-readable labels ("blocks", "depends on") are fine; everything structured belongs elsewhere.
- **Connections sidebar** — the "here's how, in depth." One Connection per meaningful pair of systems, holding the researched documentation.

This is why the plan has **no edge `customData`, no edge categories, no structured edge metadata**. Anything that might have wanted to live on an edge — confidence, source, verification state, diagrams, prose — lives in a Connection instead, where there's room for it and a UI built for it. The canvas stays lightweight.

Future work (not v1): clicking a canvas edge opens its Connection in the sidebar; drawing a canvas edge implicitly creates a Connection slot; the agent can be told "research the Connection for this edge pair" and will populate the sidebar document on demand. Slug derivation from the two endpoint ids (sorted, so direction doesn't matter) is enough to bind them. None of that needs building for v1 — edges can exist for a long time without their Connections existing yet.

## Storage — `Canvas.data` blob shape

One Prisma row per `(orgId, ref)`. The `data` JSON:

```ts
interface CanvasBlob {
  /** Authored nodes only. Library-generated ids (never prefixed). */
  nodes: CanvasNode[];
  /**
   * Edges between any two nodes. Endpoints may be authored ids, live
   * ids (`ws:<cuid>`, `feature:<cuid>`), or a mix. Always stored here;
   * never in the projection.
   */
  edges: CanvasEdge[];
  /**
   * Per-canvas placement for live nodes. Key = live id (e.g.
   * `ws:abc`), value = `{ x, y }`. Missing key → auto-placed.
   */
  positions?: Record<string, { x: number; y: number }>;
  /**
   * Live nodes the user has chosen to hide from this canvas.
   * Projected nodes not in this set are visible by default.
   */
  hidden?: string[];
}
```

Four fields. `nodes` and `edges` already exist; `positions` and `hidden` are the only new bits. **No Prisma migration needed** — both new fields live inside the existing `data JSON` column.

### Id convention

One rule applied everywhere: **live ids have a `<kind>:` prefix; authored ids don't.**

- `ws:<cuid>` — Workspace projection.
- `feature:<cuid>` — Feature projection.
- Future: `member:<cuid>`, `task:<cuid>`, `phase:<cuid>`.
- Anything else — authored.

A single predicate `isLiveId(id: string): boolean` (prefix sniff) is the only place in the system that cares about the distinction.

## The three scope kinds in v1

Ship the framework flexible enough to support all three, implement them in order.

### 1. Root scope — `ref = ""`

- **Live nodes**: workspaces as `ws:<cuid>` nodes. `customData` carries a rollup of their feature health.
- **Authored content**: objectives, notes, decisions, free-floating text, edges between anything.
- **Primary user**: the CEO / org admin. Reads progress top-down.

### 2. Authored-sub scope — `ref = "node:<authoredId>"`

The sub-canvas you enter by clicking into an authored node on its parent canvas.

- **Live nodes**: the entities the parent-canvas edges of this authored node point to. If the authored node is an objective edged to three Features on root, those three Features are the live nodes here. `customData` carries deeper feature-level rollups (phase progress, blocker count).
- **Authored content**: sub-milestones, sub-objectives, notes, decisions, edges.
- **Primary user**: the objective owner. Marks pieces off, adds narrative, pulls in more Features by drawing more edges on the parent canvas.

### 3. Workspace-sub scope — `ref = "ws:<cuid>"`

Deferred to after objectives are shipped. Included in this plan so the framework doesn't get narrowed around v1.

- **Live nodes**: the workspace's Features, Members, and (optionally) active Tasks. Meetings / messages / calls may come later.
- **Authored content**: team-level notes, decisions, workstream groupings.
- **Primary user**: the team lead. Coordination surface.

## The merge — `readCanvas(orgId, ref)`

```
1. Parse ref into a Scope.
2. Load the authored blob for (orgId, ref). Missing → empty blob.
3. Run every registered Projector against the Scope. Collect live
   nodes + rollups.
4. Drop live nodes whose id is in blob.hidden.
5. For each remaining live node, apply blob.positions[id] as x/y
   (fallback to an auto-layout for the rest).
6. Merge rollups into each live node's customData.
7. Concat live nodes + authored nodes.
8. Filter edges: keep only those whose both endpoints exist in the
   merged set. Dropped edges stay in the blob for now; a cleanup
   pass can prune them later.
9. Return { nodes, edges }.
```

Nine lines of intent. The implementation is ~40 lines of TypeScript.

## The split — `writeCanvas(orgId, ref, incoming)`

Client sends the merged `CanvasData` back. Server:

```
1. Start a fresh blob.
2. For every node in incoming.nodes:
   • if isLiveId(node.id): store only { x, y } in blob.positions.
   • else: push into blob.nodes as-is.
3. blob.edges = incoming.edges (always persisted verbatim).
4. blob.hidden = (existing row).hidden   // preserved; write path
                                         // for `hidden` is separate.
5. Persist blob.
```

The split is mechanical. The client is entirely unaware of it.

`hidden` is managed by dedicated endpoints (e.g. `POST /canvas/:ref/hide`, `POST /canvas/:ref/show`) so it doesn't get churned by autosave.

## Projectors — the extension point

```ts
interface Projector {
  project(scope: Scope, orgId: string): Promise<{
    nodes: CanvasNode[];
    /** id → partial customData, merged into the live node. */
    rollups?: Record<string, Record<string, unknown>>;
  }>;
}

const PROJECTORS: Projector[] = [
  rootProjector,      // workspaces + rollups on root
  authoredProjector,  // features on an objective's sub-canvas
  // workspaceProjector, featureProjector — later
];
```

Each projector decides whether to emit anything given the scope. `rootProjector` is a no-op for non-root; `authoredProjector` is a no-op for non-authored-sub. The framework calls them all; merging is trivial.

### Sketch: `rootProjector`

```ts
async project(scope, orgId) {
  if (scope.kind !== "root") return { nodes: [] };
  const workspaces = await db.workspace.findMany({
    where: { sourceControlOrgId: orgId, deleted: false },
  });
  return {
    nodes: workspaces.map(w => ({
      id: `ws:${w.id}`,
      type: "text",
      category: "workspace",
      text: w.name,
      x: 0, y: 0,
      ref: `ws:${w.id}`,          // enables team-view zoom later
    })),
    rollups: Object.fromEntries(
      workspaces.map(w => [`ws:${w.id}`, workspaceRollup(w)]),
    ),
  };
}
```

### Sketch: `authoredProjector`

The subtle projector. Its children come from **edges on the parent canvas**.

```ts
async project(scope, orgId) {
  if (scope.kind !== "authored") return { nodes: [] };

  // Find the parent-canvas blob that contains this authored node.
  const parent = await findParentContaining(orgId, scope.nodeId);
  if (!parent) return { nodes: [] };

  // Every edge touching this authored node.
  const touching = parent.edges.filter(
    e => e.fromNode === scope.nodeId || e.toNode === scope.nodeId,
  );
  const otherEnds = touching.map(e =>
    e.fromNode === scope.nodeId ? e.toNode : e.fromNode,
  );

  // For v1, only `feature:` endpoints are projected.
  const featureIds = otherEnds
    .filter(id => id.startsWith("feature:"))
    .map(id => id.slice("feature:".length));

  const features = await db.feature.findMany({
    where: { id: { in: featureIds }, deleted: false },
    include: { phases: true, tasks: true },
  });

  return {
    nodes: features.map(f => ({
      id: `feature:${f.id}`,
      type: "text",
      category: "feature",
      text: f.title,
      x: 0, y: 0,
      ref: `feature:${f.id}`,
    })),
    rollups: Object.fromEntries(
      features.map(f => [`feature:${f.id}`, featureRollup(f)]),
    ),
  };
}
```

Finding the parent canvas (`findParentContaining`) is the one expensive operation in this design. Two options:

- **Cached scan**: walk up `(orgId, *)` canvases, find the first whose `blob.nodes` contains `scope.nodeId`. O(canvases); fine if there aren't many.
- **Stored back-pointer**: when an authored node is first given a sub-canvas, record `parentRef` as a field on the sub-canvas blob (one-time write). O(1) lookup forever.

Start with the scan for simplicity; add the back-pointer if it becomes hot.

## Rollup logic

Per category, not a universal rule. A rollup is a function `(entity) → Partial<CustomData>`.

- **Workspace rollup** (live node on root): derived from the workspace's Features. `status` = worst status among its active features. `primary` = average progress. `secondary` = "N features" or "M blockers."
- **Feature rollup** (live node on an objective's sub-canvas): derived from the feature's Phases/Tasks. Same shape.
- **Objective rollup** (authored node, derived on read): walk outgoing edges, collect live feature endpoints, aggregate their rollups. `status` = worst; `primary` = weighted mean; `secondary` = "N features."

Rollups are computed at read time and merged into the node's `customData` in the merge step. They are never persisted. The source of truth for rollup inputs is always the DB.

The authored objective can also carry its **own** manually-set `customData.status` and `customData.primary`, for when the user wants to override or when the objective isn't yet linked to anything. Rule: **manual customData wins; rollup fills the gaps.** Concretely, when merging, rollup fields only populate keys the authored node doesn't already have set.

## Agent tool surface — almost unchanged

Existing tools (`read_canvas`, `update_canvas`, `patch_canvas`) gain a `ref?: string` argument, defaulting to `""` (root). Everything else stays. The agent can already:

- Read the merged canvas and see live + authored nodes in one array.
- Add authored nodes with `patch_canvas`.
- Add edges between any two ids — the server doesn't care whether endpoints are live, authored, or mixed.
- Drop an edge to "unlink" an authored node from a Feature.

**One new sentence in the prompt:**

> "Node ids prefixed with `ws:` or `feature:` are database entities. You can edge to them and choose where they sit on the canvas, but their `text` and `category` are fixed — those come from the database. Every other node is authored and fully yours. To express 'this objective is about these Features,' draw an edge from the objective to each `feature:` node — that's how the canvas links to real work."

No new tool. No second vocabulary. The whole "link" story is carried by a single sentence and the agent's existing edge ops.

A small future convenience: a `list_entities({ kind, workspaceId? })` tool so the agent can discover real entity ids without having to read a canvas that already mentions them. Needed once objectives exist and the agent is asked to find relevant Features across the org. Defer to when we actually need it.

## Client changes — minimal

`OrgCanvasBackground.tsx`:

- Already tracks sub-canvases via `ref`. Wire `ref` through the new merge-aware endpoint on fetch and save.
- The library already calls `onResolveCanvas(ref)` when the user clicks a `ref`-bearing node. Live workspace/feature nodes carry their own `ref`, so navigation works with no new code.
- Saving: hand the whole merged canvas back to the server. Server splits it. The client has no awareness of authored vs. live.

Editing constraints on live nodes:

- **Text/category are server-owned.** The library allows inline-edit by default. We either (a) short-circuit the edit UI for live-ids, or (b) let edits go through and silently drop them at the write-splitter. Option (a) is cleaner — a category-level `readOnly: true` hint on `workspace` / `feature` categories.
- **Position is user-owned.** Drag freely; saves as positions.
- **Deletion on the canvas = "hide from this canvas."** We write the live id into `blob.hidden` and re-render. Never touches the DB. A sidebar / palette lets the user bring hidden entities back.

## Renderer changes — tiny

The `system-canvas` theme already supports per-category configuration. Add:

- `workspace` category — teal container (exists already).
- `feature` category — new. Similar footprint to workspace but a different accent color. Same slots (status pill, progress bar, footer metrics) as `objective`, because both are rollup-driven.

Both live categories get a lock/database icon in the toolbar position, or their toolbar is suppressed entirely. A double-click on them opens a drawer (the real entity's page or an inline drawer) — no inline text edit.

## Prompt generation — unchanged mechanism

The existing `canvas-categories.ts` registry drives `buildCategoryDescription()` and `buildPromptCategorySection()`. Add:

- `workspace` (already present) — mark `agentWritable: false` so the registry knows the agent shouldn't construct these from scratch (they're projected, not authored).
- `feature` — new entry, same `agentWritable: false`.
- `objective`, `note`, `decision` — already present, `agentWritable: true` by implication.

The prompt generator emits the live-id sentence automatically for all `agentWritable: false` categories.

## Dangling edges

When a workspace or feature is deleted, edges referencing them become unresolvable. Policy:

- **Read side**: step 8 of the merge silently drops them. They don't render; they can't cause a crash.
- **Write side**: they stay in the blob. A future idempotent cleanup pass can prune them, or we prune on every write. (Cheap enough to prune on every write — it's a single filter.) Start with write-side prune; it's simple and prevents indefinite accumulation.

Re-adding a deleted workspace with the same id is vanishingly unlikely (cuids), so we don't need to guard against "edge reappears because entity came back."

## Ship slice — v1 (root canvas)

1. Extend `CanvasBlob` typing in `src/app/org/[githubLogin]/connections/` and its server-side types to include `positions` and `hidden`. No Prisma change.
2. Add `parseScope`, `isLiveId`, `applyPositions`, and a `mergeProjections` helper. ~40 lines total.
3. Write `rootProjector` with workspaces + rollup.
4. Introduce `readCanvas` / `writeCanvas` in the server. Swap the existing `/api/orgs/[githubLogin]/canvas` handlers to use them.
5. Add `workspace` live rendering (already mostly done) + rollup stamping.
6. Extend the category registry with `agentWritable`; one new sentence in the prompt.
7. Live-node edit suppression in `OrgCanvasBackground.tsx`: no inline text edit, drag-to-position works, delete→hide.
8. Ship. The root canvas now shows real workspaces, the user and LLM can draw objectives and edges, and edges survive DB changes.

At this point there are no live rollups on objectives yet — they're just pretty cards with a status pill. That's fine for the first cut.

## Ship slice — v2 (objective zoom + rollups)

1. Add `feature` category to the renderer and registry.
2. Write `authoredProjector` + `findParentContaining`.
3. Write `featureRollup` (Phase/Task aggregation) and `objectiveRollup` (walks outgoing edges, aggregates feature rollups).
4. Add a `kind: "authored"` parsing rule to `parseScope`; navigation lights up.
5. Prompt gets one more sentence about zoom: "Each authored node has its own sub-canvas, reachable by clicking. Inside, the live nodes are the entities edged to this node on its parent canvas."
6. Ship. Objectives now roll up automatically from their linked Features. Clicking in shows the decomposition. Users start using the feature.

## Ship slice — v3 (workspace team view)

1. New scope kind in `parseScope`: `ws:<cuid>`.
2. `workspaceProjector` emits Features + Members as live nodes for `ws:<cuid>` scope.
3. New categories in the registry: `member`. `feature` already exists.
4. Rollups: member rollup is trivial (online/away/whatever). Feature rollup is reused.
5. Ship.

Later slices add tasks, meetings, transcripts, calls, messages — each one new projector + one new category.

## What we're explicitly NOT doing

- No `Objective` Prisma model. Objectives are authored JSON. This is load-bearing — it's what makes the LLM rewrite story work.
- No `links` field on nodes. Edges are the only relation.
- No cross-scope edges in v1. An edge on root is for root. An edge on an objective's sub-canvas is for that sub-canvas. Cross-scope linking (e.g. objective → task three levels down) is a v4+ problem and probably doesn't need a new primitive — it falls out of nested projection if we want it later.
- No new join tables. No new schema. The only persisted mutation is `Canvas.data`.
- No special treatment for decorative vs semantic edges in v1. An edge is an edge. Add a `kind` field when we have a concrete UX need.

## Open questions worth revisiting once we start building

- **Rollup caching.** On every canvas read we re-query Features/Tasks and re-aggregate. For an org with many workspaces this could be slow. A short-lived per-request cache is easy; a redis-backed cache with invalidation on DB writes is the real answer if it matters.
- **Live-node edit drawer.** What opens when a user double-clicks a workspace or feature live node? v1 can route to the existing workspace/feature page. v2 might show a side drawer on the canvas itself.
- **Hidden live nodes UX.** How does the user bring one back? A "+ show entity" palette that lists everything not currently placed. Small but not free.
- **Auto-layout for first render.** When a workspace has no stored position, where does it go? A deterministic hash-based placement is fine; a proper force-directed layout is overkill for v1.
- **Multi-user presence.** If two managers open the same canvas simultaneously, whose position wins? Existing Pusher + autosave handle this awkwardly (last write wins). Real CRDT or yjs integration is a separate concern; not on the critical path.

## Success criteria

- A CEO can open `/org/<login>/connections` and see a live map of workspaces, a few objectives spanning them, and edges connecting them to the real features.
- Renaming a workspace in the DB: the canvas reflects it on next read.
- Drawing an edge from an objective to a feature: the objective's rollup picks up the feature's status immediately.
- Clicking into an objective: see only the features (and nested authored nodes) that matter to it.
- The LLM, when asked "what are we working on?", can read the canvas, compare with the DB, add notes and objectives, and edge them to real features — with zero code to teach it the difference between live and authored beyond one sentence of prompt.
