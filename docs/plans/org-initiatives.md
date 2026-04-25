# Org Canvas — Initiatives & Milestones

A live whiteboard at the org level where **Initiatives** and **Milestones** are real DB rows, projected onto an infinite canvas alongside Workspaces and Repositories. Humans create, edit, and order them; the canvas reflects the DB. The agent annotates around them with notes, decisions, and edges.

> **Supersedes** `docs/plans/org-canvas.md`. The previous design used authored-JSON "Objectives" with drillable child canvases. That model has been replaced wholesale: initiatives and milestones are now first-class DB entities (`Initiative` + `Milestone` Prisma models, shipped separately by another track). This doc reflects the post-cutover state.

## Goal

One visual surface where managers and the CEO see "the state of the org" — workspaces, the strategic initiatives the org is pursuing, and the milestones that make up each initiative — and where AI agents can decorate and enrich the picture with notes, decisions, and dependency edges.

The animating principle: **the roadmap IS the product**. Adding a milestone, marking one done, watching an initiative's progress fill — those aren't documentation steps; they ARE the operating interface. Humans drive the structure (initiatives, milestones, ordering); agents annotate (notes, decisions, edges between things).

Distinction from the old "objectives" plan: **structure is no longer authored JSON**. It's real database rows, with all the integrity that gives us (foreign keys, ordering invariants, an audit trail, a separate table UI in `OrgInitiatives.tsx`). The canvas becomes a *view* of that structure, plus a free authoring layer on top.

## The four concepts the design rests on

1. **Scope** — "what canvas am I looking at." A scope is a URI stored in the existing `Canvas.ref` column.
   - `""` → the org root.
   - `"ws:<cuid>"` → a workspace sub-canvas (repos).
   - `"initiative:<cuid>"` → an initiative timeline sub-canvas (milestones).
   - Reserved (no projector yet): `"milestone:<cuid>"`, `"feature:<cuid>"`.
   - Anything else → `"opaque"` — stored verbatim, no projection. Keeps any pre-cutover sub-canvases working.

2. **Projection** — "given a scope, what live nodes belong here." A pure function of scope + current DB state. Never persisted.

3. **Authored blob** — "what has a human or LLM drawn here." One JSON document per scope, stored in `Canvas.data`, keyed by `(orgId, ref)`. Holds notes, decisions, free text, edges, and per-canvas position overrides for live nodes.

4. **DB-creating categories** — `initiative` and `milestone` are visible in the canvas's `+` menu, but selecting them does **not** drop a node onto the canvas. Instead it opens a creation dialog that hits the initiatives/milestones REST API. The new row gets projected on the next read; Pusher pushes the refresh.

## What's authored vs. what's projected

| Category | Source | Where data lives | `+` menu behavior |
| --- | --- | --- | --- |
| `note`, `decision`, free `text` | authored | `Canvas.data` blob | Drops a node on the canvas (standard library behavior) |
| `workspace` | DB-projected | `Workspace` table | Hidden from `+` menu; created via existing workspace flow |
| `repository` | DB-projected | `Repository` table | Hidden from `+` menu; created via GitHub sync |
| `initiative` | DB-projected | `Initiative` table | Opens **CreateInitiativeDialog**; on save → `POST /api/orgs/<login>/initiatives`; Pusher refresh re-projects |
| `milestone` | DB-projected | `Milestone` table | Opens **CreateMilestoneDialog**; on save → `POST /api/orgs/<login>/initiatives/<id>/milestones`; Pusher refresh re-projects |

The category registry (`canvas-categories.ts`) gains a third axis besides `agentWritable`:

- `agentWritable: false` → the agent must not author this category (it's DB-projected). Today: `workspace`, `repository`, `initiative`, `milestone`.
- `userCreatable: false` → the `+` menu hides this category from humans too. Today: `workspace`, `repository`. Initiatives and milestones stay user-creatable, but their creation is intercepted (see below).

## Scope structure

| Scope | `ref` | Projected nodes | `+` menu offers | Drill-in |
| --- | --- | --- | --- | --- |
| Root | `""` | `ws:<id>`, `initiative:<id>` | `note`, `decision`, `text`, **`initiative` (DB-create)** | Click `ws:` → workspace; click `initiative:` → timeline |
| Workspace | `ws:<cuid>` | `repo:<id>` | `note`, `decision`, `text` | none today |
| Initiative | `initiative:<cuid>` | `milestone:<id>` (laid out by `sequence`) | `note`, `decision`, `text`, **`milestone` (DB-create)** | none in v1 (v2: drill into milestone → Features/Tasks) |
| Repository (reserved) | — | — | — | — |
| Milestone (v2) | `milestone:<cuid>` | `feature:<id>`, `task:<id>` (deferred) | TBD | TBD |

## The DB models (refresher)

Schema: `prisma/schema.prisma` (lines ~1520-1559).

- **`Initiative`** — `id`, `orgId`, `name`, `description`, `status` (`DRAFT | ACTIVE | COMPLETED | ARCHIVED`), `assigneeId`, `startDate`, `targetDate`, `completedAt`. Has many `Milestone`.
- **`Milestone`** — `id`, `initiativeId`, `name`, `description`, `status` (`NOT_STARTED | IN_PROGRESS | COMPLETED`), `sequence` (unique within initiative), `dueDate`, `completedAt`, `assigneeId`. Has many `Feature` (via `Feature.milestoneId`).
- **`Feature.milestoneId`** — already wired by the new track. The v2 milestone-sub-canvas projector reads this directly; for v1 it's only used to compute "linked feature count" footers.

API (already shipped by another track):

- `GET/POST /api/orgs/<login>/initiatives`
- `GET/PATCH/DELETE /api/orgs/<login>/initiatives/<id>`
- `GET/POST /api/orgs/<login>/initiatives/<id>/milestones`
- `GET/PATCH/DELETE /api/orgs/<login>/initiatives/<id>/milestones/<msId>`
- `POST /api/orgs/<login>/initiatives/<id>/milestones/reorder`
- Plus a feature-link endpoint.

These already exist. Our job is to **emit `CANVAS_UPDATED` Pusher events** on every mutating call so open canvases refetch.

## Status → visual mapping

**Initiatives** carry no status pill on the canvas. The card shows name, a progress bar (% of milestones COMPLETED), and a footer ("3/7 milestones"). Initiatives may be long-running or never-ending, so a status traffic-light would mislead. The card border stays neutral; the underlying `Initiative.status` field is still readable in the table UI but doesn't drive a canvas color.

**Milestones** have three states with three colors:

| `MilestoneStatus` | Canvas color | Meaning |
| --- | --- | --- |
| `NOT_STARTED` | muted gray | hasn't begun |
| `IN_PROGRESS` | cool blue (`#7dd3fc`) | actively in flight |
| `COMPLETED` | green (`#4ade80`) | done |

No `attn`/`risk` on milestones — those were objective semantics. A milestone is either not started, in progress, or done.

## Projectors

```ts
interface Projector {
  project(scope, orgId): Promise<{
    nodes: CanvasNode[];
    rollups?: Record<string, Record<string, unknown>>;
  }>;
}

const PROJECTORS: Projector[] = [
  rootProjector,             // ws:<id> nodes on root         (existing)
  workspaceProjector,        // repo:<id> nodes on a workspace (existing)
  initiativeProjector,       // initiative:<id> nodes on root  (new)
  milestoneTimelineProjector,// milestone:<id> on an initiative (new)
];
```

### `initiativeProjector` — root scope only

```ts
async project(scope, orgId) {
  if (scope.kind !== "root") return { nodes: [] };
  const initiatives = await db.initiative.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { milestones: true } }, milestones: { select: { status: true } } },
  });
  return {
    nodes: initiatives.map((i, idx) => {
      const total = i._count.milestones;
      const done = i.milestones.filter(m => m.status === "COMPLETED").length;
      const pct = total === 0 ? 0 : Math.round((done / total) * 100);
      return {
        id: `initiative:${i.id}`,
        type: "text",
        category: "initiative",
        text: i.name,
        ref: `initiative:${i.id}`,
        ...defaultInitiativePosition(idx),
        customData: {
          primary: total > 0 ? `${pct}%` : undefined,
          secondary: total > 0 ? `${done}/${total} milestones` : "no milestones yet",
        },
      };
    }),
  };
}
```

Layout: a row beneath the workspace row. Default placement is index-based (deterministic, no jitter). The blob's `positions[liveId]` overlay still wins, so a user-dragged or click-placed initiative sticks where they put it.

### `milestoneTimelineProjector` — initiative scope

Reached by clicking an `initiative:<cuid>` node. Includes an org-ownership guard (`findFirst({ id, orgId })`) so a guessed cuid can't read another org's milestones. Emits one `milestone:<cuid>` node per milestone, laid out **horizontally by `sequence`** so the canvas reads as a left-to-right timeline.

```ts
async project(scope, orgId) {
  if (scope.kind !== "initiative") return { nodes: [] };
  const initiative = await db.initiative.findFirst({
    where: { id: scope.initiativeId, orgId },
    select: { id: true },
  });
  if (!initiative) return { nodes: [] };
  const milestones = await db.milestone.findMany({
    where: { initiativeId: initiative.id },
    orderBy: { sequence: "asc" },
    include: { _count: { select: { features: true } } },
  });
  return {
    nodes: milestones.map((m, idx) => ({
      id: `milestone:${m.id}`,
      type: "text",
      category: "milestone",
      text: m.name,
      ...defaultMilestonePosition(idx),
      customData: {
        status: m.status,                                  // raw enum, theme maps to color
        secondary: formatMilestoneFooter(m),                // due date + feature count
      },
    })),
  };
}
```

No `ref` on milestone nodes in v1 (drill-in is v2). Position is index-based along x with a fixed y; per-canvas `positions[liveId]` still wins.

## DB-creating `+` menu

The library's `AddNodeButton` exposes `(options, addNode)` and our `renderAddNodeButton` already wraps it. Today we filter `workspace`/`repository` out of the options. New behavior:

1. Keep `initiative` and `milestone` in the options list (visible) — they're `userCreatable: true`.
2. Wrap `addNode` so when the user picks a DB-creating category, we **don't pass the synthesized node into our `onNodeAdd` handler**. Instead we open the matching dialog with the click position cached.
3. On dialog save:
   - `POST` to the appropriate endpoint
   - Receive `{ id, ... }`
   - Save `positions["initiative:" + id] = { x, y }` (or `"milestone:" + id`) into the current canvas's blob via the existing PUT endpoint, so the projected node lands where the user clicked
   - Wait for the Pusher `CANVAS_UPDATED` refresh, OR optimistically refetch — both work; the Pusher path is the source of truth.
4. On dialog cancel: nothing happens. No node was added.

Two new shared components, extracted from the existing table UI in `OrgInitiatives.tsx` so the same dialogs serve both surfaces:

- `src/components/initiatives/InitiativeDialog.tsx`
- `src/components/initiatives/MilestoneDialog.tsx`

Not new code, just extracted. The dialogs already exist and are battle-tested.

## Pusher invalidation

Every initiative/milestone mutation must emit `CANVAS_UPDATED` on the org channel so all open canvases refetch.

| Endpoint | Event(s) emitted |
| --- | --- |
| `POST /initiatives` | `{ ref: null }` (root) |
| `PATCH /initiatives/:id` | `{ ref: null }` + `{ ref: "initiative:<id>" }` |
| `DELETE /initiatives/:id` | `{ ref: null }` |
| `POST /initiatives/:id/milestones` | `{ ref: "initiative:<id>" }` + `{ ref: null }` (root rollup changes) |
| `PATCH /initiatives/:id/milestones/:msId` | `{ ref: "initiative:<id>" }` + `{ ref: null }` |
| `DELETE /initiatives/:id/milestones/:msId` | `{ ref: "initiative:<id>" }` + `{ ref: null }` |
| `POST /initiatives/:id/milestones/reorder` | `{ ref: "initiative:<id>" }` |
| Feature-link mutation | `{ ref: "initiative:<id>" }` (footer counts) |

Implementation: a tiny `notifyCanvasUpdated(orgId, ref, action, detail?)` helper (already exists in `canvasTools.ts` — extract or reuse).

## Read merge / write split — unchanged but simpler

Same `readCanvas` / `writeCanvas` pipeline as before. **Two simplifications** vs the old plan:

1. **No more `DRILLABLE_CATEGORIES` auto-stamp.** The splitter no longer writes `ref: "node:<id>"` onto authored objectives. Drill-in flows entirely through projected nodes (`ws:`, `initiative:`) which carry their own `ref` from the projector.
2. **No more `computeChildRollups`.** Initiative progress comes from the projector's own SQL count of completed milestones, not from peeking into a child canvas's authored objectives. `src/lib/canvas/rollups.ts` is deleted.

The merge becomes:

```
1. Parse ref into a Scope.
2. Load the authored blob for (orgId, ref).
3. Run every projector; collect live nodes + rollups.
4. Drop hidden live nodes.
5. Apply blob.positions[liveId] as x/y overlay.
6. Merge rollups into each live node's customData (manual customData wins).
7. Concat live + authored nodes.
8. Filter edges to those with both endpoints present.
```

The split is unchanged, minus the drillable auto-stamp:

```
1. For each incoming node: if isLiveId → store position only; else → keep verbatim.
2. blob.edges = incoming.edges.
3. blob.hidden preserved from previous.
```

## Agent surface (v1)

The agent gets **no new tools** for creating Initiatives or Milestones. Reasoning:

- These are real, user-managed work items. An LLM hallucinating a milestone or duplicating one is worse than the LLM not being able to make them at all.
- The agent's value here is in the *connective tissue*: drawing edges, leaving notes, surfacing decisions, marking dependencies. That requires no new tools — `update_canvas` and `patch_canvas` already do it for authored content.

What the agent does see and can do:

- `read_canvas` returns Initiatives and Milestones as projected nodes (id-prefixed `initiative:`, `milestone:`). Their `customData` reflects current DB state.
- The agent **must not** add `initiative:<id>` or `milestone:<id>` nodes via `update_canvas`/`patch_canvas`. Both categories carry `agentWritable: false` and are filtered from the tool schema's category enum, so the schema itself prevents this.
- The agent can hide them, edge them to/from authored nodes, and edit their `position` (rare but legal — same rules as workspaces today).
- The prompt's "Layout" section is rewritten to guide initiative/milestone framing instead of objective framing.

## Existing authored objectives — hard cutover

Production canvases may contain authored `objective` category nodes and `node:<id>` sub-canvas blobs. Policy:

- **No migration.** The `objective` category is removed from `canvas-categories.ts` and `canvas-theme.ts`.
- The renderer falls through unknown categories without crashing (see existing fallback). Authored `objective` nodes silently disappear from view but stay in the JSON blob.
- `node:<id>` sub-canvas blobs become orphaned — `parseScope` handles them as `opaque` (already does), so reads round-trip with no crash but no projection.
- `parseScope` still recognizes `node:<id>` (kept for backward-compat read paths) but the splitter never emits new ones.

If we want a true cleanup later, write a one-off script to delete `category=="objective"` authored nodes and `ref LIKE 'node:%'` rows. Not blocking.

## What we're explicitly NOT doing

- **No agent tool to create or edit Initiatives/Milestones.** Humans drive structure.
- **No Feature/Task projection on the milestone sub-canvas** in v1. v2 work.
- **No `objective` category.** It's gone.
- **No drillable authored nodes.** Replaced by drillable projected entities.
- **No cross-scope edges.** An edge on the initiative timeline is for that timeline.
- **No `feature:<id>` projection** anywhere yet (the prefix is reserved).
- **No reordering of milestones from the canvas.** Reorder happens in the table UI; the canvas re-projects after.

## v2 follow-ups

In rough priority order:

1. **Milestone sub-canvas** projecting linked Features and (optionally) their Tasks. `ref: "milestone:<cuid>"`. Each Feature appears as a `feature:<id>` node; clicking drills into the existing feature page or a feature-detail sub-canvas. **The agent's main job here is documentation:** linking existing Features to the right Milestones, drawing dependency edges, leaving status notes — annotating and tracking the structure humans created.
2. **Agent annotation tools** (read-only over structure, write over annotation):
   - `link_feature_to_milestone(featureId, milestoneId)` — sets `Feature.milestoneId`. Annotation, not creation.
   - `unlink_feature_from_milestone(featureId)`.
   - These let the agent help organize the Features humans have already created, without ever creating Features or Milestones themselves.
3. **"Promote a note to a Milestone"** — a button on an authored note that opens the milestone create-dialog with the note text pre-filled. The roadmap-is-the-product pattern's missing primitive.
4. **Workspace rollup** — workspace cards on the root canvas could carry an aggregate "N initiatives in flight" footer. Same pattern as the milestone-count footer on initiatives.
5. **Parent-canvas refresh on child edits** — when a milestone changes, the root initiative card's rollup needs refreshing. The Pusher fan-out (root + initiative) handles this; verify in practice.
6. **Live-node edit drawer** — double-clicking an initiative or milestone opens an edit drawer (or routes to the table UI's edit dialog). Not wired yet.

## Success criteria

Root canvas:
- A CEO can open `/org/<login>/connections`, see workspaces across the top and a row of active initiatives below, with progress bars filled in from real milestone completion counts.
- Clicking the `+` and picking "Initiative" opens a dialog. On save, a new card appears at the click position. Re-opening the page shows the same card in the same place.

Initiative timeline:
- Clicking an initiative card opens a horizontal timeline of its milestones, ordered by `sequence`.
- Each milestone card shows its status color (gray / blue / green) and a due-date footer.
- Adding a milestone via the `+` opens the milestone dialog; on save it slots into the timeline.

Pusher:
- Two browsers open on the same org. User A creates an initiative via the table UI. User B's canvas refreshes within ~1s and shows the new card.

Agent:
- Asked to "annotate the canvas with notes about which initiatives depend on which", the agent reads the canvas, writes `note` nodes and edges between projected `initiative:` ids, and never tries to create an `initiative` or `milestone`.

## Reference: file map

```
src/lib/canvas/
  scope.ts        — adds initiative:, milestone: to LIVE_ID_PREFIXES; parses initiative:<cuid>
  types.ts        — adds { kind: "initiative"; initiativeId } to Scope
  projectors.ts   — adds initiativeProjector, milestoneTimelineProjector
  io.ts           — drops DRILLABLE_CATEGORIES auto-stamp + computeChildRollups call
  rollups.ts      — DELETED

src/app/org/[githubLogin]/connections/
  canvas-categories.ts — drops `objective`; adds `initiative`, `milestone`; adds `userCreatable` flag
  canvas-theme.ts      — drops objectiveCategory; adds initiativeCategory, milestoneCategory
  OrgCanvasBackground.tsx — intercepts `+` for initiative/milestone, opens dialogs, position-on-create

src/components/initiatives/
  InitiativeDialog.tsx — extracted from OrgInitiatives.tsx
  MilestoneDialog.tsx  — extracted from OrgInitiatives.tsx

src/app/api/orgs/[githubLogin]/initiatives/
  route.ts                       — adds notifyCanvasUpdated on POST
  [initiativeId]/route.ts        — adds notifyCanvasUpdated on PATCH/DELETE
  [initiativeId]/milestones/...  — adds notifyCanvasUpdated on POST/PATCH/DELETE/reorder

src/lib/constants/prompt.ts — rewrites canvas suffix around initiatives, drops objective wording
src/lib/ai/canvasTools.ts   — drops objective doc strings from customData schema

docs/plans/
  org-canvas.md         — KEPT with a "superseded" banner pointing here
  org-initiatives.md    — THIS FILE (canonical)

src/app/org/[githubLogin]/CANVAS.md — pointer + live-prefix list update
```
