# Milestone Progress

Bubble Feature + Task state up to the **Milestone** card on the org canvas, then make milestones drillable into a sub-canvas of their Features and Tasks. Show *who* (people) and *what's running* (agents) at a glance.

> Companion to `docs/plans/org-initiatives.md`. That doc shipped v1 of the milestone timeline (cards, status colors, time-window columns). This doc covers the v2 work explicitly listed there as follow-ups (#2 "milestone sub-canvas," and the un-numbered "what about progress?" gap).

## Goal

A milestone card should answer four questions in one glance, without clicking:

1. **How far along is it?** — progress bar of features completed.
2. **Is anyone working right now?** — small agent badge when one or more agents are mid-run.
3. **Who's involved?** — compact avatar stack of the humans behind the linked Features.
4. **What's inside?** — drill into the milestone to see its Features and (in the same view) their Tasks laid out spatially.

The animating principle from `org-initiatives.md` still holds: **the roadmap IS the product**. Watching a progress bar fill, watching an agent badge pop on when work starts and pop off when it lands — those are the operating signals, not afterthoughts.

## What ships, in order

This is the build sequence. Each slice is independently shippable; later slices unlock zoom/visualization once the data is flowing.

1. **API: Milestone ↔ Feature becomes 1:N.** Schema is already 1:N; the API surface is artificially clamped to 1:1. Unclamp it. (Foundational — every later slice depends on multiple features per milestone making sense.)
2. **Server: project Feature progress onto the milestone card.** Add a `progress` slot to the milestone category. (The headline visual.)
3. **Server: project "agent active" signal.** Add an outer-corner badge that lights up when any Task under any linked Feature has `workflowStatus IN ('PENDING', 'IN_PROGRESS')`.
4. **Server: project team avatars.** Top-right inner badge with a stack of involved-user initials (max 3 + "+N").
5. **Client: drillable milestone sub-canvas.** New `milestoneProjector` for scope `milestone:<cuid>`. Projects Features as `feature:<id>` cards alongside their Tasks as `task:<id>` smaller cards in a single flat layout (Feature owns a column; Tasks stack under it).
6. **Polish:** Pusher fan-out so workspace-channel + org-channel both refresh when relevant Tasks change; tests; dialog UI for adding/removing multiple features per milestone.

## The four concepts (extending `org-initiatives.md`)

The same four pillars (Scope / Projection / Authored blob / DB-creating categories) carry over unchanged. We add two more entity prefixes that are already reserved in `LIVE_ID_PREFIXES` (`src/lib/canvas/scope.ts:21-27`):

- `feature:<cuid>` — **already in the prefix list**, no scope-handler today; we add a projector entry on the milestone scope.
- `task:<cuid>` — **NOT in the prefix list yet**. Add it. Tasks are leaves in v2 (no drill).

`parseScope` already handles `milestone:<cuid>` and `feature:<cuid>` (`src/lib/canvas/scope.ts:71-76`). We add `task:<cuid>` to `LIVE_ID_PREFIXES` only — no `parseScope` branch yet because tasks are not navigable.

---

## Slice 1 — API: Milestone ↔ Feature becomes 1:N

The Prisma relation is already correct (`Milestone.features Feature[]`, `Feature.milestoneId String?`). The API does this:

`src/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/route.ts:8-27`:
```ts
const MILESTONE_INCLUDE = {
  features: { ..., take: 1 },        // ← clamped
};
function serializeMilestone({ features, ...rest }) {
  return { ...rest, feature: features[0] ?? null };  // ← flattened
}
```

And on PATCH (lines 89-93):
```ts
features: featureId ? { connect: { id: featureId } } : { set: [] },
// ^ "set: []" wipes ALL links to disconnect; { connect } adds one.
```

### What changes

- `MILESTONE_INCLUDE.features` drops `take: 1`. Order by `Feature.createdAt asc`.
- `serializeMilestone` returns `features: Feature[]` (plural). **Drop the `feature` singular field.** This is a breaking response shape; touch every caller.
- PATCH body accepts:
  - `addFeatureId: string` → `{ connect: { id } }`
  - `removeFeatureId: string` → `{ disconnect: { id } }`
  - `featureIds: string[]` → `{ set: [{ id }, ...] }` (full replace; the existing `featureId: null` semantics map to `featureIds: []`).
  - **Keep `featureId` working for one release as a compatibility shim** that maps to `addFeatureId` / `set: []`. Mark it deprecated in JSDoc; remove later.
- Each connect/disconnect candidate goes through the same cross-org IDOR guard (lines 64-77) — keep this exact pattern, just loop it for arrays.

### Callers to migrate

- `src/app/org/[githubLogin]/LinkFeatureModal.tsx` — currently sends `{ featureId }`. Change to `addFeatureId` / `removeFeatureId`. The dialog also needs a UI shift: today it picks one feature; v2 needs an "add another" pattern (multiselect chip list with typeahead). `features/search` route stays as-is.
- `src/app/org/[githubLogin]/OrgInitiatives.tsx` — wherever it renders `milestone.feature` (singular), switch to mapping over `milestone.features`.
- Any test that asserts on `serializeMilestone` shape.

### Pusher

Already correct in line 101-106 — emits to `""` (root) + `initiative:<initiativeId>`. **Add** `milestone:<milestoneId>` to the fan-out so an open milestone sub-canvas refreshes when a feature is added/removed:

```ts
notifyCanvasesUpdatedByLogin(
  githubLogin,
  ["", `initiative:${initiativeId}`, `milestone:${milestoneId}`],
  "milestone-updated",
  { initiativeId, milestoneId },
);
```

---

## Slice 2 — Progress bar on the milestone card

This is the headline visual change. Driven entirely by extending the existing `milestoneTimelineProjector` and `milestoneCategory`.

### Server: `milestoneTimelineProjector`

`src/lib/canvas/projectors.ts:325-393`. Currently selects:
```ts
include: { _count: { select: { features: true } } }
```

Change to:
```ts
include: {
  features: {
    select: { id: true, status: true },
    where: { deleted: false },
  },
},
```

Compute, per milestone:
```ts
const features = m.features ?? [];
const total = features.length;
const done = features.filter((f) => f.status === "COMPLETED").length;
const progress = total === 0 ? 0 : done / total;  // 0..1, NOT a percent string
```

Stash on `customData`:
```ts
customData: {
  status: m.status,
  sequence: m.sequence,
  progress,         // 0..1, for the system-canvas ProgressSlot
  featureCount: total,
  featureDone: done,
  ...(footerParts.length > 0 && { secondary: footerParts.join(" · ") }),
},
```

**Why a fraction not a percent string:** the initiative card uses `customData.primary = "67%"` because its renderer parses the string back into a number for the bar. Progress slots in system-canvas (`ProgressSlot`, `types.d.ts:228-233`) want a `NodeAccessor<number>` already in 0..1 range. New code, do it the right way; we don't need to keep parsing strings.

The footer text changes from "Due Mar 4 · 2 features" to "Due Mar 4 · 2/3 features" when `total > 0`. Keep the no-due-date and no-features fallbacks.

### Client: `milestoneCategory` slots

`src/app/org/[githubLogin]/connections/canvas-theme.ts:384-419`.

Add a `bodyTop` slot — system-canvas's purpose-built thin-band-under-the-header position (`slots.js:84-95`, ~35% of font-size tall, ~9px padding from title). This is the cleanest spot: it sits between the existing `header` (the IN PROGRESS / NOT STARTED / COMPLETED text) and the title text rendered by the wrapped-body renderer. **No conflict with `withWrappedBody`** — `body` and `bodyTop` are different slots.

```ts
slots: {
  topEdge: { kind: "color", extent: "full", color: ... },
  header: { kind: "text", value: ..., color: ... },
  bodyTop: {
    kind: "progress",
    value: (ctx) => {
      const v = ctx.node.customData?.progress;
      return typeof v === "number" ? v : 0;
    },
    color: (ctx) => milestoneStatusColor(ctx.node),
    bgColor: hexAlpha("#FFFFFF", 0.08),
  },
  footer: { kind: "custom", render: ... },
},
```

The bar's color tracks the status color (green when COMPLETED, blue when IN_PROGRESS, gray when NOT_STARTED). When status is COMPLETED but progress is < 100% (a human marked done early), the bar shows incomplete-but-green — that's a feature, not a bug: it makes manual override visible.

**Don't render the bar when `featureCount === 0`.** A 0% bar reads as "behind" rather than "no work yet." The `ProgressSlot` API doesn't support hidden-when-zero directly, so use a `kind: "custom"` renderer that returns `null` when count is 0, otherwise renders the same SVG the `progress` kind would. Cheap; copy the `ProgressSlot` rendering from `slots.js`.

> **System-canvas alternative.** If we don't want to copy SVG, add a `hideWhenZero?: boolean` field to `ProgressSlot` (mirrors `CountSlot.hideWhenEmpty`). One-line library change in your repo. Recommended if we end up wanting it elsewhere too.

---

## Slice 3 — Agent active badge

A small dot/count badge that shows when the milestone has work *in flight right now*.

### The "in flight" predicate

Per the codebase audit:

```sql
EXISTS (
  SELECT 1 FROM tasks t
  WHERE t.feature_id IN (<linked feature ids>)
    AND t.deleted = false
    AND t.archived = false
    AND t.workflow_status IN ('PENDING', 'IN_PROGRESS')
)
```

This matches the kanban view's definition of "in flight" (`src/components/tasks/KanbanView.tsx:25-73`), and the workspace-wide stats endpoint (`src/app/api/tasks/stats/route.ts:36-43`). PENDING is included because the kanban folds it into IN_PROGRESS — the work has been queued, the agent will pick it up imminently.

### Projection

Extend the milestone select to pull a count:
```ts
include: {
  features: {
    select: {
      id: true,
      status: true,
      _count: {
        select: {
          tasks: {
            where: {
              deleted: false,
              archived: false,
              workflowStatus: { in: ["PENDING", "IN_PROGRESS"] },
            },
          },
        },
      },
    },
    where: { deleted: false },
  },
},
```

Per milestone:
```ts
const agentCount = features.reduce((sum, f) => sum + f._count.tasks, 0);
customData.agentCount = agentCount;  // 0 = no badge
```

### Client slot

The `topRightOuter` slot is purpose-built for notification-tab badges that hang off the corner (`types.d.ts:173-179`, `slots.js:96-105`). Use it:

```ts
topRightOuter: {
  kind: "count",
  value: (ctx) => ctx.node.customData?.agentCount ?? 0,
  color: ACCENT_AGENT,        // pick a high-contrast accent (warm yellow / orange?)
  hideWhenEmpty: true,         // built-in: badge disappears at 0
},
```

**The "agent icon" framing.** A count badge is the right v1 — it answers "how many" with one glyph and never lies. Adding a literal robot/agent icon means picking a glyph; do that as a polish slice if the count alone reads as ambiguous next to existing count badges elsewhere on the canvas. Keep it simple first.

> **Optional pulse animation.** When `agentCount > 0` we could give the badge a slow pulse. system-canvas slots don't support animation today; a small `kind: "custom"` renderer with an inline `<animate>` element is the path of least resistance. **Do not** ship pulses on every node — only on milestones with active agents.

---

## Slice 4 — Team avatar stack

Show the humans behind the linked features so a CEO scanning the canvas sees not just *what* but *who*.

### "Involved" definition (per Feature)

Following the audit's recommendation, "involved in feature F" is the union of:

- `Feature.assigneeId`
- `Feature.createdById`
- distinct `ChatMessage.userId where featureId = F`
- (transitively) `Task.assigneeId` and `Task.createdById` for each Task under F

For v1 we keep it cheap: just the **direct Feature relations** (assignee + createdBy + chat-message authors). Task-level union is a polish slice if needed.

Per milestone, take the **union across all linked features**, then sort by frequency descending (most-involved first), de-duplicate by user id.

### Projection cost

This is an N+1 risk. Two options:

- **Cheap path (recommended for v1):** select `assignee` and `createdBy` only — no chat-message scan. That's already two outer joins per feature, but Prisma handles it in one query.
- **Honest path (later):** group-by query against `ChatMessage` keyed by feature id. If the milestone timeline starts feeling slow, add a `MilestoneTeamMember` materialized view or a small in-memory cache keyed by `(milestoneId, max-relevant-updatedAt)`.

```ts
features: {
  select: {
    ...,
    assignee: { select: { id: true, name: true, image: true } },
    createdBy: { select: { id: true, name: true, image: true } },
  },
},
```

Then in JS:
```ts
const involved = new Map<string, { id: string; name: string; image?: string | null }>();
for (const f of features) {
  if (f.assignee) involved.set(f.assignee.id, f.assignee);
  if (f.createdBy) involved.set(f.createdBy.id, f.createdBy);
}
customData.team = Array.from(involved.values()).slice(0, 4);
customData.teamOverflow = Math.max(0, involved.size - 4);
```

### Client slot

The avatar stack is custom — system-canvas has no built-in "row of circles with images" primitive, and forcing it into a pill isn't right. Use `kind: "custom"` in the `topRight` (corner) slot:

```ts
topRight: {
  kind: "custom",
  render: (ctx) => renderTeamStack(ctx),
},
```

`renderTeamStack` draws up to 3 overlapping circles (16px radius each, 10px overlap) plus a "+N" pill if `teamOverflow > 0`. Each circle is a `<circle>` with a `<clipPath>`'d `<image href={user.image}>` if image exists, else the user's initials in a `<text>`. Pure SVG; no `<foreignObject>` needed.

The `topRight` corner box is small (`CORNER_INSET + corner` ~ 20×20 px), so we extend horizontally past it. That's fine — the slot's rect is just a *seed* position; we render outward from it.

**Zoom-progressive.** Per Q7, we always render compact: at zoom-out the stack reads as small dots; zoomed in they resolve into recognizable initials/avatars. No library change needed. If we want true zoom-aware (hide entirely when zoom < 0.5), that's a v2 library extension to pass `viewport` into `SlotContext`.

---

## Slice 5 — Drill into milestone: Features + Tasks in one canvas

Per Q6: a single flat layout with Features and their Tasks visible at once. No second drill click.

### New scope: `milestone:<cuid>`

Already parsed by `scope.ts:71-73` as `{ kind: "milestone", milestoneId }`. We add the projector.

### New live id prefix: `task:`

Add `"task:"` to `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`. Tasks are not navigable yet (no scope branch), but they need to be recognized as live so the splitter strips authored fields on save.

### New category: `feature` (id-prefix `feature:`) and `task` (id-prefix `task:`)

In `canvas-categories.ts`:
```ts
{ id: "feature", agentWritable: false, userCreatable: false },
{ id: "task",    agentWritable: false, userCreatable: false },
```

Both are DB-projected, never authored, never created from the `+` menu (Features are created on the workspace plan page; Tasks are created from a feature's chat).

In `canvas-theme.ts`, two new `CategoryDefinition`s:

- **Feature card** — medium card (~260×100). Header kicker "FEATURE", body wraps the title, footer shows `tasksDone/tasksTotal`. Color reflects `Feature.status` (use the existing FeatureStatus → color map from `src/components/features/`). Carries `ref: "feature:<id>"` for optional drill (deferred — v3 could route to the existing feature detail page or chat).
- **Task card** — compact (~180×64). Header is the task workflow status word (matching the kanban: IN_PROGRESS, COMPLETED, ERROR, HALTED). `topEdge` color band tracks workflow status (blue / green / red / amber). Body wraps `Task.title`. No footer (or a single line: assignee initials + dueDate). No `ref` (tasks are leaves).

### Layout: feature columns, task stack underneath each

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   FEATURE A     │  │   FEATURE B     │  │   FEATURE C     │
│   "title"       │  │   "title"       │  │   "title"       │
│   3/5 tasks     │  │   1/2 tasks     │  │   0/4 tasks     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
  ┌─ task ─┐         ┌─ task ─┐            ┌─ task ─┐
  │  done  │         │  prog  │            │  todo  │
  └────────┘         └────────┘            └────────┘
  ┌─ task ─┐         ┌─ task ─┐            ┌─ task ─┐
  │  done  │         │  done  │            │  todo  │
  └────────┘         └────────┘            └────────┘
   ...                                      ...
```

Geometry constants in `geometry.ts`:
```ts
export const FEATURE_W = 260;
export const FEATURE_H = 100;
export const FEATURE_ROW_Y = 60;
export const FEATURE_ROW_X0 = 40;
export const FEATURE_ROW_STEP = FEATURE_W + ROW_GAP;

export const TASK_W = 180;
export const TASK_H = 64;
export const TASK_STACK_X_OFFSET = (FEATURE_W - TASK_W) / 2;  // center under feature
export const TASK_STACK_Y0 = FEATURE_ROW_Y + FEATURE_H + 24;
export const TASK_STACK_STEP_Y = TASK_H + 12;
```

Projector pseudocode:
```ts
export const milestoneProjector: Projector = {
  async project(scope, orgId) {
    if (scope.kind !== "milestone") return { nodes: [] };
    // Org-ownership guard via initiative.
    const milestone = await db.milestone.findFirst({
      where: { id: scope.milestoneId, initiative: { orgId } },
      select: { id: true },
    });
    if (!milestone) return { nodes: [] };

    const features = await db.feature.findMany({
      where: { milestoneId: milestone.id, deleted: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, title: true, status: true, workflowStatus: true,
        tasks: {
          where: { deleted: false, archived: false },
          orderBy: { createdAt: "asc" },
          select: { id: true, title: true, status: true, workflowStatus: true, assigneeId: true },
        },
      },
    });

    const nodes: CanvasNode[] = [];
    features.forEach((f, fi) => {
      const fx = FEATURE_ROW_X0 + fi * FEATURE_ROW_STEP;
      nodes.push({
        id: `feature:${f.id}`,
        type: "text", category: "feature",
        text: f.title,
        ref: `feature:${f.id}`,           // optional: future deep-dive scope
        x: fx, y: FEATURE_ROW_Y,
        customData: {
          status: f.status,
          workflowStatus: f.workflowStatus,
          taskCount: f.tasks.length,
          taskDone: f.tasks.filter(t => t.status === "DONE").length,
        },
      });
      f.tasks.forEach((t, ti) => {
        nodes.push({
          id: `task:${t.id}`,
          type: "text", category: "task",
          text: t.title,
          x: fx + TASK_STACK_X_OFFSET,
          y: TASK_STACK_Y0 + ti * TASK_STACK_STEP_Y,
          customData: {
            status: t.status,
            workflowStatus: t.workflowStatus,
            assigneeId: t.assigneeId,
          },
        });
      });
    });
    return { nodes };
  },
};
```

### Position overlays still apply

The merge step lays `blob.positions[liveId]` over the projector's defaults — same as workspaces, repos, and milestones today. So a user who drags a task aside has it stick. Tasks **don't get a `ref`** so the auto-stamping is moot; sequence/x doesn't carry semantic weight here (no reorder API for tasks within a feature today).

### Edges

Authored only — let the agent draw notes/decisions and edges between feature/task nodes via `update_canvas` / `patch_canvas`. The library already filters edges to those with both endpoints present, so dangling edges from a deleted feature don't crash.

### Pusher

Mutating any Task that's under a Feature linked to a Milestone needs to fan a `CANVAS_UPDATED` event to `milestone:<id>`. This is **the cross-cutting bit**: today, task mutations live deep in `src/services/task-workflow.ts`, the Stakwork webhook (`src/app/api/stakwork/webhook/route.ts:273`), and the GitHub PR webhook (`src/app/api/github/webhook/[workspaceId]/route.ts:619`). These already call `updateFeatureStatusFromTasks`. Wrap that call (or place a sibling call) with a Pusher fan-out:

```ts
// In src/services/roadmap/feature-status-sync.ts after updating feature.status:
const milestoneId = feature.milestoneId;
if (milestoneId) {
  // initiative is needed for the timeline ref; one extra select.
  const ms = await db.milestone.findUnique({
    where: { id: milestoneId },
    select: { initiativeId: true, initiative: { select: { orgId: true } } },
  });
  if (ms?.initiative?.orgId) {
    void notifyCanvasesUpdatedByOrgId(ms.initiative.orgId, [
      "",
      `initiative:${ms.initiativeId}`,
      `milestone:${milestoneId}`,
    ], "task-progress", { milestoneId });
  }
}
```

(Add a `notifyCanvasesUpdatedByOrgId` variant to `src/lib/canvas/pusher.ts` if it doesn't exist — only `…ByLogin` does today.)

This is the only "side-channel" Pusher emit the work introduces. Single source of truth: it lives next to `updateFeatureStatusFromTasks` so any future task→feature status edge automatically refreshes the canvas too.

---

## Status → visual mapping (extending `org-initiatives.md`)

Adding two new categories to the existing milestone palette:

| Entity | Status field | Color mapping |
| --- | --- | --- |
| Feature | `Feature.status` (FeatureStatus) | BACKLOG → muted gray; PLANNED → slate; IN_PROGRESS → cool blue (`#7dd3fc`); COMPLETED → green (`#4ade80`); CANCELLED → muted gray + dashed border; ERROR → red (`#f87171`); BLOCKED → amber (`#fbbf24`) |
| Task | `Task.workflowStatus` (mapped) | PENDING+IN_PROGRESS → blue; COMPLETED → green; ERROR+FAILED → red; HALTED → amber. Mirrors `KanbanView.tsx:57-73` exactly. |

Reuse the milestone's pattern: `topEdge` color band + `header` text rendered in the same color so it survives clipping.

---

## Adding decorative bands? (optional, deferred)

The milestone sub-canvas could emit horizontal **rows** to separate Features from their Tasks visually:
- Top row band labeled "FEATURES"
- Bottom row band labeled "TASKS"

Mechanism is the same `rows?: CanvasLane[]` projection result that `milestoneTimelineProjector` uses for `columns`. Implementation cost is ~10 lines. Skip in v1; revisit if the layout reads as flat without explicit zones.

---

## What we're explicitly NOT doing in v1

- **No agent tool to link features to milestones.** v3+ work in `org-initiatives.md`.
- **No drilling into a Feature card to see its full chat / tasks page.** The `feature:<id>` ref is reserved but routes nowhere. (Could route to `/w/<slug>/plan/<featureId>` later.)
- **No drilling into Task cards.** Leaves.
- **No reorder by drag for features/tasks.** Same posture as milestones in v1.
- **No "agent identity" surfacing** (specific avatar/name per running agent). Just a count badge on the milestone, and a workflow-status color on the task card. Knowing *which* agent is running is a v3+ detail.
- **No real-time "presence" join.** `usePlanPresence` is feature-scoped, not milestone-scoped. We don't bolt it on here.
- **No zoom-aware slot renderers.** Per Q7, always render compact.

## Migration / cutover risks

- **The milestone API response shape changes** (`feature` singular → `features` array). Audit all callers: `LinkFeatureModal.tsx`, `OrgInitiatives.tsx`, the canvas projector itself, the search route's response shape. The compatibility shim (`featureId` body field on PATCH) keeps writes working but reads will break for any consumer that pulls `milestone.feature`.
- **Cost of projector queries.** `milestoneTimelineProjector` already does N+1ish (one milestone fetch + nested features). Adding `features.tasks._count` doesn't change the round-trip count thanks to Prisma's relation aggregation, but it does add joins. Watch the page load on initiatives with 20+ milestones and 5+ features each.
- **Pusher amplification.** Every Task status change now triggers a canvas refresh. Most workspaces have many tasks; throttle if needed. The library is already debounce-tolerant for `CANVAS_UPDATED`, but verify under load.

## Reference: file map

```
src/lib/canvas/
  scope.ts        — adds "task:" to LIVE_ID_PREFIXES
  projectors.ts   — extends milestoneTimelineProjector w/ progress + agentCount + team;
                    adds milestoneProjector for scope "milestone:<id>"
  geometry.ts     — adds FEATURE_W/H/ROW_*, TASK_W/H/STACK_*
  pusher.ts       — adds notifyCanvasesUpdatedByOrgId (sibling of ByLogin)

src/app/org/[githubLogin]/connections/
  canvas-categories.ts — adds `feature`, `task` (both agentWritable: false, userCreatable: false)
  canvas-theme.ts      — adds featureCategory, taskCategory; adds bodyTop ProgressSlot
                          + topRightOuter agent count slot + topRight team-stack slot
                          to milestoneCategory

src/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/
  route.ts                 — drops take:1; serializes features (plural); accepts
                              addFeatureId/removeFeatureId/featureIds; keeps featureId shim;
                              extends Pusher fan-out to milestone:<id>

src/app/org/[githubLogin]/
  LinkFeatureModal.tsx     — multi-select chip UI (typeahead reuses search route)
  OrgInitiatives.tsx       — renders `milestone.features` (plural)

src/services/roadmap/
  feature-status-sync.ts   — emits canvas refresh after parent feature.status change

docs/plans/
  milestone-progress.md    — THIS FILE
  org-initiatives.md       — keep canonical for v1/v2 milestone semantics; cross-ref this doc
```

## Success criteria

- Open an initiative timeline. Each milestone card shows a thin progress bar between the status header and the title. Bar fills proportionally to "linked features completed."
- Mark a Feature `COMPLETED` from the plan page. Within ~1s, the milestone card's bar advances and the footer ticker increments (e.g. `2/5 features` → `3/5 features`).
- Start a Stakwork run on a Task whose Feature is linked to a Milestone. The milestone card's top-right outer corner gets a "1" badge. Cancel/complete the run; the badge disappears.
- Click a milestone. New sub-canvas opens showing each linked Feature as a card with its Tasks stacked below it. Each Task card colored by workflow status. Drag a task; it stays put on reload.
- Two browsers open on the same milestone sub-canvas. User A merges a PR that flips a Task to `DONE` + `COMPLETED`. User B's milestone sub-canvas shows the change within ~1s. The user's other open initiative timeline simultaneously updates the milestone progress bar.
- Hover over a milestone's team-avatar stack. (Optional.) Tooltip lists the involved users. The stack collapses to "+N" beyond 3.

## Open questions / nice-to-haves

- **Should the progress bar respect manual milestone status overrides?** If a user sets `Milestone.status = COMPLETED` while only 2/5 features are done, do we (a) hide the bar, (b) show full bar (status wins), or (c) show truthful bar (data wins)? Recommendation: **(c)** — manual status is for "I'm calling this done despite incomplete features"; the bar should still show what reality looks like. Same posture as the deployment-status rollup.
- **Workspace-channel Pusher.** Currently the `/w/<slug>/plan` page does NOT receive milestone-link change events. If we want the plan page's "this feature is on milestone X" pill to update live, fan to the workspace channel too. Defer until that pill exists.
- **Phase rollup.** `Phase.status` exists but is manual and never auto-derived. If a milestone sub-canvas wanted Phase as a middle layer (Feature → Phase → Task), we'd need automated phase status first. Defer.
- **Collapsed task piles.** A feature with 30 tasks turns into a long vertical stack on the milestone sub-canvas. Consider an authored-blob flag `customData.collapsed: true` (per feature node) that hides children at render time and shows a `+30 tasks` pill. Library doesn't natively support hiding sibling nodes; would need a small canvas-level filter step. Defer.
