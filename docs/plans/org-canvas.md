# Org Canvas — Live + Authored

> ⚠️ **SUPERSEDED — see [`org-initiatives.md`](./org-initiatives.md)**
>
> This doc describes the v1/v1.1 model where strategic structure was authored as JSON `objective` nodes with drillable child canvases. That model has been replaced wholesale: Initiatives and Milestones are now real Prisma models (`Initiative`, `Milestone`) projected onto the canvas like Workspaces and Repositories. Authored objectives are gone.
>
> This doc is preserved for historical context — particularly the "Three concepts" framing (Scope / Projection / Authored blob), the merge/split pipeline, and the "edges are decoration, not load-bearing" rationale, all of which carry forward unchanged. Anything below about authored objectives, `node:<id>` refs, `DRILLABLE_CATEGORIES`, or `computeChildRollups` is **out of date**; read `org-initiatives.md` for the current model.

A design for the org-level canvas where DB entities (workspaces, repositories, later features/members/tasks) live side-by-side with human/LLM-authored content (objectives, notes, decisions) on the same infinite whiteboard, navigable via zoom.

Status: **superseded by `org-initiatives.md`**. The v1/v1.1 ship described here (root projection of workspaces, workspace sub-canvas projecting repositories, drillable authored objectives with child-canvas rollup) shipped, then was replaced when Initiatives and Milestones became real DB models.

## Goal

One visual surface where managers and the CEO see "the state of the org" — which workspaces exist, which strategic objectives span them, and how those objectives are progressing — and where AI agents can decorate and enrich the picture freely. Users can draw whatever they want; the system keeps DB-backed entities honest by re-projecting them on every read.

The animating principle: **the roadmap IS the product.** Breaking an objective into mini-objectives, ticking one off as done, promoting a note into a real Feature — those aren't documentation steps; they ARE the operating interface. Human ICs and LLM agents both work against the same canvas, and progress bubbles up automatically.

## The three concepts the whole design rests on

1. **Scope** — "what canvas am I looking at." A scope is a URI stored in the existing `Canvas.ref` column.
   - `""` → the org root.
   - `"ws:<cuid>"` → a workspace sub-canvas (the repos / members / future features view).
   - `"node:<authoredNodeId>"` → zoom-into an authored node (today: objectives; drillable at write time via `DRILLABLE_CATEGORIES`).
   - `"feature:<cuid>"` → feature deep-dive (reserved; no projector yet).
   - Unknown prefixes are accepted as `"opaque"` scopes — stored verbatim with no projection. Keeps pre-v1 sub-canvases working.

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

Not shown: on read, authored objectives with a `ref: "node:<id>"` get a second enrichment pass that peeks at their child canvas and stamps a progress rollup into `customData` (see `computeChildRollups`). On write, the splitter auto-stamps `ref: "node:<id>"` on any authored objective that doesn't already have one.

## The ontology we're working with

What the DB already owns (from `prisma/schema.prisma`):

- **Workspace** — `@sourceControlOrg`, has members, features, tasks.
- **Feature** (called a "plan" in the Hive UX) — lives inside a Workspace, has phases and tasks, has a status.
- **Phase** — inside a Feature, has tasks.
- **Task** — inside a Feature (optionally inside a Phase), has an assignee, status, priority.
- **WorkspaceMember** — user + role inside a workspace.

What the canvas adds on top, as **authored nodes only** — no new Prisma model:

- **Objective** — a free-floating story a manager or the CEO is telling. "Ship mobile by Q3", "Reduce onboarding friction", "Become SOC2-compliant." Objectives are drillable: clicking one opens its own sub-canvas where mini-objectives live. A parent objective's progress is computed from its child canvas (count of child objectives with `status === "ok"` over total). The objective itself is just a JSON node in a canvas document.
- **Note** — amber free-form callout. "Remember to…" / "Open question…"
- **Decision** — purple free-form callout. "Shared vs dedicated pools?" / "Adopt X or Y?"

The key design choice: **objectives are canvas-native**, not a Prisma model. They can be renamed, reshaped, split, merged, or deleted with a single canvas write. No migration cost to iterate. The LLM can redraw them at will.

## How "links" work — edges are decoration, not load-bearing

Edges are the cheap relation primitive: `{ fromNode, toNode, label? }`, endpoints can be authored or live in any combination. They exist to say "these two things are related" and to make the canvas readable. **They do NOT determine what a parent objective rolls up from.**

The original plan here proposed using edges as the membership relation — draw an edge from objective → feature and the feature would both feed the objective's rollup AND appear on the objective's child canvas. We abandoned that during v1.1. Reasons:

- Layers should be independent. What lives inside an objective's sub-canvas is the user's (and agent's) composition problem, not a derivation from the parent's edges. An objective can hold mini-objectives, notes, team members, features — whatever the team decides — without those being constrained by what got edged on the parent.
- Edges are UX scaffolding. An arrow between cards is for the reader. Forcing it to carry membership semantics makes every decorative line a rollup input, and pollutes the rollup with junk edges to notes and decisions.
- The rollup has a simpler definition if we just look at **what's inside the child canvas**: count the child objectives with `status === "ok"` vs total, stamp the percent into the parent. No edge walk. No endpoint-kind filter. No "which edges count" heuristic.

So edges survive as a purely visual relation ("depends on", "blocks", "contributes to") and **the child canvas is the source of truth for a parent's progress**. See the "Drillable authored nodes" section below for the current shape.

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
   * ids (`ws:<cuid>`, `repo:<cuid>`, …), or a mix. Always stored here;
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

- `ws:<cuid>` — Workspace projection. *(shipped)*
- `repo:<cuid>` — Repository projection. *(shipped)*
- `feature:<cuid>` — Feature projection. *(reserved; no projector yet)*
- Future: `member:<cuid>`, `task:<cuid>`, `phase:<cuid>`.
- Anything else — authored.

The source of truth is `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`. A single predicate `isLiveId(id: string): boolean` (prefix sniff) is the only place in the system that cares about the distinction.

## Scope kinds

Four in the framework; three have projectors today.

### 1. Root scope — `ref = ""`  *(shipped)*

- **Live nodes**: workspaces as `ws:<cuid>` nodes. Workspace rollup (feature health) is future work.
- **Authored content**: objectives, notes, decisions, free-floating text, edges between anything.
- **Primary user**: the CEO / org admin. Reads progress top-down.

### 2. Workspace sub-scope — `ref = "ws:<cuid>"`  *(shipped)*

Reached by clicking a `ws:<cuid>` node on root.

- **Live nodes**: the workspace's repositories as `repo:<cuid>` nodes. The workspace projector guards with a `findFirst({ id, sourceControlOrgId })` check to prevent cross-org reads by guessing cuids.
- **Authored content**: team-level notes, decisions, workstream groupings, mini-objectives.
- **Future**: features, members, active tasks, meetings/messages as additional projections — each one new projector, no schema change.

### 3. Authored-sub scope — `ref = "node:<authoredId>"`  *(shipped — drillable objectives)*

The sub-canvas you enter by clicking into an authored `objective` node. `splitCanvas` auto-stamps this ref on every authored objective at write time, so clicking it always resolves.

- **Live nodes**: **none by default**. Layers are independent — the child canvas is a fresh whiteboard, not a projection of the parent's edges (see the "How links work" section). The user and the agent compose the child canvas from scratch: mini-objectives, notes, decisions.
- **Bubble-up**: the parent's `customData.primary` / `.secondary` / `.status` are rolled up from the child canvas — count of child objectives with `status === "ok"` over total child objectives. Manual customData on the parent always wins (same rule as live-node rollups).
- **Primary user**: the objective owner. Breaks the objective into mini-objectives, ticks them off, watches the parent's progress bar fill.

### 4. Feature sub-scope — `ref = "feature:<cuid>"`  *(unshipped)*

Reserved for when Features get their own deep-dive canvas. Projector stub will emit phases / tasks / PRs.

## The merge — `readCanvas(orgId, ref)`

```
1. Parse ref into a Scope.
2. Load the authored blob for (orgId, ref). Missing → empty blob.
3. Run every registered Projector against the Scope. Collect live
   nodes + rollups.
4. Drop live nodes whose id is in blob.hidden.
5. For each remaining live node, apply blob.positions[id] as x/y
   (fallback to the projector's default placement).
6. Merge rollups into each live node's customData (manual wins).
7. Compute child-canvas rollups for drillable authored nodes
   (objectives with a `node:<id>` ref) in ONE batched findMany;
   stamp them into each parent's customData (manual wins).
8. Concat live nodes + authored nodes.
9. Filter edges: keep only those whose both endpoints exist in the
   merged set. Dropped edges stay in the blob for now; a cleanup
   pass can prune them later.
10. Return { nodes, edges }.
```

Steps 1–6 and 8–9 are in `src/lib/canvas/io.ts` (merge). Step 7 is `src/lib/canvas/rollups.ts` (`computeChildRollups`).

## The split — `writeCanvas(orgId, ref, incoming)`

Client sends the merged `CanvasData` back. Server:

```
1. Start a fresh blob.
2. For every node in incoming.nodes:
   • if isLiveId(node.id): merge { x, y } into blob.positions and drop
     the rest. Text / category / customData are owned by the projection
     and silently discarded.
   • else (authored): push onto blob.nodes as-is. If its category is
     in DRILLABLE_CATEGORIES (currently just "objective") and it has
     no explicit `ref`, auto-stamp `ref: "node:<id>"` so the library's
     drill-in fires on click.
3. blob.edges = incoming.edges (always persisted verbatim).
4. blob.hidden = (existing row).hidden   // preserved; write path
                                         // for `hidden` is separate.
5. Persist blob.
```

Key invariant: **omitting a live id from the incoming document is NOT an implicit hide.** Positions for missing live ids are preserved from the previous blob. This protects users from autosave races and partial writes silently resetting their drags. Explicit hides go through the dedicated `POST /canvas/hide` endpoint.

## Projectors — the extension point for live nodes

```ts
interface Projector {
  project(scope: Scope, orgId: string): Promise<{
    nodes: CanvasNode[];
    /** id → partial customData, merged into the live node. */
    rollups?: Record<string, Record<string, unknown>>;
  }>;
}

const PROJECTORS: Projector[] = [
  rootProjector,       // workspaces on root
  workspaceProjector,  // repositories on a workspace sub-canvas
  // featureProjector, memberProjector — later
];
```

Each projector decides whether to emit anything given the scope (`rootProjector` no-ops for non-root, `workspaceProjector` no-ops for non-workspace, etc.). The framework calls them all; merging is trivial.

### `rootProjector` (shipped)

```ts
async project(scope, orgId) {
  if (scope.kind !== "root") return { nodes: [] };
  const workspaces = await db.workspace.findMany({
    where: { sourceControlOrgId: orgId, deleted: false },
  });
  return {
    nodes: workspaces.map((w, i) => ({
      id: `ws:${w.id}`,
      type: "text",
      category: "workspace",
      text: w.name,
      ref: `ws:${w.id}`,              // enables workspace-sub zoom
      ...defaultWorkspacePosition(i),
    })),
    rollups: {},                       // future: feature-health rollup
  };
}
```

### `workspaceProjector` (shipped)

```ts
async project(scope, orgId) {
  if (scope.kind !== "workspace") return { nodes: [] };
  // Ownership guard: prevent cross-org reads by guessing cuids.
  const workspace = await db.workspace.findFirst({
    where: { id: scope.workspaceId, sourceControlOrgId: orgId, deleted: false },
  });
  if (!workspace) return { nodes: [] };
  const repos = await db.repository.findMany({ where: { workspaceId: workspace.id } });
  return {
    nodes: repos.map((r, i) => ({
      id: `repo:${r.id}`,
      type: "text",
      category: "repository",
      text: r.name,
      ...defaultRepoPosition(i),
    })),
  };
}
```

## Child-canvas rollups — the extension point for authored nodes

Authored-node rollups are **different** from projector rollups. Instead of deriving state from the DB, they read the authored node's own **child canvas** (one level down) and summarize it.

Currently one rule: for every authored `objective` with a `ref: "node:<id>"`, count its child canvas's `objective`-category nodes where `customData.status === "ok"` over total, stamp `{ primary: "N%", secondary: "done/total", status: "ok"|"attn" }` into the parent's customData (manual wins).

Batched into one `findMany({ where: { ref: { in: [...] } } })` so read cost stays O(1) DB round-trips regardless of how many drillable objectives the parent has.

See `src/lib/canvas/rollups.ts` (`summarizeChildObjectives`, `computeChildRollups`).

Adding a new rollup kind (e.g. "a note with a checklist"): extend `rollups.ts` with the aggregation, teach `splitCanvas`'s `DRILLABLE_CATEGORIES` if the category needs a sub-canvas.

## Rollup rule — manual customData wins

One universal rule, applied wherever rollups stamp into nodes:

- If the authored / live node already has a value for a customData key, keep it.
- Otherwise, use the rollup's value.

Concretely: `applyRollup(node, rollupPartial)` merges non-undefined keys from `node.customData` on top of `rollupPartial`. A user who's typed "status: risk" on an objective keeps it even when the child canvas is 100% done — their call. Remove the manual override to get the rollup back.

## Agent tool surface

The three existing tools (`read_canvas`, `update_canvas`, `patch_canvas`) each take an optional `ref?: string` (defaults to `""` = root). Same vocabulary works everywhere. The agent can:

- Read the merged canvas at any scope and see live + authored nodes in one array.
- Add / edit / remove authored nodes with `patch_canvas` or `update_canvas`.
- Add edges between any two ids — the server doesn't care whether endpoints are live, authored, or mixed.
- Populate a drillable objective's child canvas by passing `ref: "node:<id>"`.

The prompt teaches two things: (a) **don't author projected categories** (they're filtered out of the tool schema via `agentWritable: false`), and (b) **use `ref: "node:<id>"` to work on an objective's sub-canvas**. Both lessons are in `getCanvasPromptSuffix()` in `src/lib/constants/prompt.ts`.

A small future convenience: a `list_entities({ kind, workspaceId? })` tool so the agent can discover real entity ids without having to read a canvas that already mentions them. Needed once objectives exist and the agent is asked to find relevant Features across the org. Defer to when we actually need it.

## Client changes

`OrgCanvasBackground.tsx`:

- Fetches root via `/api/orgs/<login>/canvas`, sub-canvases via `/api/orgs/<login>/canvas/<ref>`. Keeps a `Record<ref, CanvasData>` cache keyed by ref. The library drives drill-in via `onResolveCanvas(ref)`; projected nodes carry their own `ref` so navigation works with no custom wiring.
- Save: hand the whole merged canvas back to the server. Server splits it. The client has no awareness of authored vs. live.
- `CANVAS_UPDATED` Pusher events carry `ref` (null for root, string for sub). The client refetches the specific canvas that changed, and only if we have it in the cache (i.e. the user has opened it).

Live-node editing:

- **Text / category / customData** are server-owned. The splitter discards any edits on live ids. No client-side readOnly flag yet — if this becomes a UX issue (users getting confused when their edits revert), add a category-level hint and short-circuit the edit UI.
- **Position** is user-owned. Drag freely; autosave persists it as a `positions[liveId]` overlay.
- **Hide** goes through `POST /canvas/hide` (dedicated endpoint so autosave can't accidentally toggle it).

## Dangling edges

When a workspace / repo / feature is deleted, edges referencing them become unresolvable. Policy:

- **Read side**: the merge drops them silently. They don't render; they can't cause a crash.
- **Write side**: they stay in the blob. Cleanup is a future idempotent sweep.

Re-adding a deleted entity with the same id is vanishingly unlikely (cuids), so we don't guard against "edge reappears because entity came back."

## Ship slices

### v1 — root canvas (shipped)

`CanvasBlob` gains `positions` + `hidden`. `parseScope` / `isLiveId` / projector infrastructure lands. `rootProjector` emits workspaces. `readCanvas` / `writeCanvas` replace the raw DB read/write in the REST routes. Category registry gains `agentWritable`. Prompt teaches live ids.

### v1.1 — workspace sub-canvas + drillable objectives (shipped)

`workspaceProjector` emits repositories (with an org-ownership guard) on the `ws:<cuid>` scope. A `repository` category lands with a slate-indigo theme. `splitCanvas` auto-stamps `ref: "node:<id>"` on authored objectives — the library's existing drill-in fires automatically. `computeChildRollups` reads each drillable objective's child canvas in ONE batched `findMany` and stamps `{ primary, secondary, status }` into the parent's customData (manual wins). Prompt gains the "objectives have sub-canvases" section.

### v2 — feature projection (unshipped)

Add a `feature` category (rollup-driven like `objective`). Add a `featureProjector` that emits `feature:<cuid>` live nodes — likely on the workspace sub-canvas (alongside repos) and/or as a standalone feature scope. Add a feature rollup derived from phases / tasks.

Open: should drawing a line from an authored objective to a `feature:<cuid>` imply membership, or do we stay strict ("edges are decoration; to attach a feature to an objective, open the objective's sub-canvas and add it there")? The v1.1 lesson was that implicit-membership-from-edges complicates the mental model. Leaning toward "the child canvas owns the membership; edges are pure decoration" — which likely means adding a "promote this note to a Feature" agent tool rather than "edge this feature into the objective."

### v3 — workspace team view, continued (unshipped)

Extend `workspaceProjector` (or add a `memberProjector`) for workspace members. `member` category. Later slices add tasks, meetings, transcripts, calls, messages — each one new projector + one new category.

## What we're explicitly NOT doing

- **No `Objective` Prisma model.** Objectives are authored JSON. This is load-bearing — it's what makes the LLM rewrite story work.
- **No `links` field on nodes.** Edges are the only relation primitive, and they're pure decoration ("these are related") — NOT membership. Membership is "what lives in my child canvas," computed per-parent via `computeChildRollups`.
- **No cross-scope edges.** An edge on root is for root. An edge on an objective's sub-canvas is for that sub-canvas. Cross-scope linking falls out naturally from nested projection when / if we want it.
- **No new join tables. No new schema.** The only persisted mutation is `Canvas.data`.
- **No special treatment for decorative vs semantic edges.** An edge is an edge. Add a `kind` field only if a concrete UX need shows up.
- **No edge-derived projection.** The original plan proposed projecting a feature onto an objective's sub-canvas because an edge existed between them on the parent. We rejected this during v1.1 — layers are independent.

## Open questions worth revisiting

- **Parent-canvas refresh after child edits.** Today, editing a mini-objective inside a child canvas doesn't trigger a re-render of the parent's rollup in open viewers; the parent needs to be re-fetched. Fix: when writing a sub-canvas with `ref: "node:<id>"`, also emit `CANVAS_UPDATED` for the parent ref. Requires knowing the parent ref — cached scan or stored back-pointer, same trade-off as before.
- **Rollup caching.** We re-query and re-aggregate on every canvas read. Short-lived per-request cache is easy; DB-invalidated cache is the real answer if latency matters.
- **Live-node edit drawer.** Double-clicking a workspace / repo / feature should open a drawer or the entity's existing page. Not wired yet.
- **Hidden live nodes UX.** How does a user bring one back? Needs a "+ show entity" palette. Small but not free.
- **Multi-user presence.** Two managers editing the same canvas simultaneously is "last write wins" today. Real CRDT / yjs integration is a separate concern.
- **Note → Feature promotion.** The "roadmap is the product" pattern's missing primitive: a tool / UX that takes an authored note and creates a real `Feature` record, replacing the note node with a projected `feature:<cuid>` node. Key for v2+ once feature projection lands.

## Success criteria

Root canvas:
- A CEO can open `/org/<login>/connections` and see a live map of workspaces, a few authored objectives, and edges connecting them.
- Renaming a workspace in the DB: the canvas reflects it on next read.

Workspace drill-down (shipped):
- Clicking a workspace card opens a sub-canvas with the workspace's repositories.
- The user and agent can annotate that sub-canvas with notes, decisions, and mini-objectives.

Objective drill-down (shipped):
- Clicking an authored objective opens a blank sub-canvas.
- Adding mini-objectives and marking them `status: ok` makes the parent's progress bar fill. No manual number entry required.
- Setting a manual status on the parent overrides the rollup.

LLM workflow:
- When asked to plan an initiative, the agent creates the parent objective and immediately calls `update_canvas` with `ref: "node:<id>"` to populate the child canvas.
- When asked "what's the state of X?", the agent reads the root canvas, drills into the relevant objective via the `ref`, and summarizes what it sees.
