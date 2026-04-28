# Org Plans (Features) on the Canvas

Make **Plans** (the user-facing name for `Feature` rows in the schema) first-class on the org canvas, so a user can create a Plan from any scope — root, workspace, initiative, or milestone — and have it appear visually in the place they created it.

> Status: **Open questions for the team.** No code changes yet beyond a stub right-click "Promote to Plan…" menu item that's wired into the canvas with no functionality, so the surface is in place when these decisions land.

> Related plan docs: `docs/plans/org-initiatives.md` (initiative + milestone projectors, the canvas projection model). `docs/plans/milestone-progress.md` (slices that introduced `feature:` projection on milestone sub-canvases).

## Terminology

The schema name is `Feature`. The UI name is **Plan** (Sidebar item, `/w/<slug>/plan` route, page title — see `src/components/Sidebar.tsx:117`, `src/app/w/[slug]/plan/page.tsx:21`).

This doc uses **Plan** in user-facing copy and **Feature** in schema/API contexts. The right-click menu item is "Promote to Plan…".

## Why this is coming up

Right now, the org canvas projects `feature:<id>` nodes **only on milestone sub-canvases** (`milestoneProjector` in `src/lib/canvas/projectors.ts:542`). Plans without a `milestoneId` are completely invisible on the canvas — they only exist on the Plan list page.

We want a "Promote to Plan…" right-click action on free-floating notes. The promoted Plan should *appear in place of the note* — the note vanishes, a Plan card lands at the same `(x, y)`. That works trivially on the milestone sub-canvas because the milestone projector already emits `feature:` nodes there. **It does not work on root, workspace, or initiative canvases**, because no projector emits Plan nodes for those scopes.

There are two ways to fix this gap. Pick wrong and we either constrain users (Plans can't be created from where they're thinking) or we duplicate cards across canvases.

## Open questions

### Q1. Should Plans render on every scope, and if so, with what predicate?

| Scope | Today | Open question |
|---|---|---|
| **root** (`""`) | No Plan projection | Should root surface "org-level Plans"? Which Plans qualify? |
| **workspace** (`ws:<id>`) | No Plan projection | Should workspace canvases project all the workspace's Plans? Just the ones not attached to a milestone? |
| **initiative** (`initiative:<id>`) | No direct Plan projection (milestone cards roll up Plan counts) | Should initiative canvases project Plans, and how do they "belong to" an initiative? |
| **milestone** (`milestone:<id>`) | Projects Plans where `milestoneId === this.milestoneId` | Unchanged. |

Two scoping models are coherent:

- **Most-specific only** — each Plan renders at exactly one scope: its lowest-level home. Adding a milestone to a Plan visually moves it from initiative scope to milestone scope. No duplicates. Predicate becomes "Plans whose direct attachment matches this scope and isn't claimed by something more specific."
- **Bubble up** — a Plan with `milestoneId` set renders on its milestone canvas AND its workspace canvas AND root. Per-canvas position overlays already work this way (`Canvas.data.positions` is keyed by `(ref, liveId)`), so users could place the same Plan independently on each scope. Maximally flexible; risks visual clutter.

### Q2. Does Plan need a direct relation to Initiative?

Today `Feature` has `workspaceId` (required) and `milestoneId` (optional). It has no `initiativeId`. The only way a Plan relates to an initiative is transitively: `Plan → Milestone → Initiative`.

If the user right-clicks a note on an initiative canvas and picks "Promote to Plan…", the natural intent is "this Plan belongs to this initiative." But without a direct `Feature.initiativeId` field, we can only honor that intent by either:

- **(a)** forcing the user to pick a milestone in the dialog (so the Plan inherits its initiative through the milestone), or
- **(b)** adding `Feature.initiativeId` (nullable) and letting Plans live at the initiative level without a milestone, or
- **(c)** refusing to promote on initiative scope (contradicts "every scope works").

The decision is currently **no schema change**: option (a) — Plans relate to initiatives only via milestones. That has a downstream consequence: an initiative-scope promote either forces a milestone pick or isn't allowed. Worth re-confirming with the team before we wire the dialog, because it's the difference between "Plans live anywhere" and "Plans live in a workspace, optionally inside a milestone."

### Q3. Where does a brand-new Plan with no milestone live?

If the user picks a workspace and nothing else, the new Plan has `workspaceId` set, `milestoneId: null`. Today such a Plan only shows on the `/plan` list page — never on the canvas. Two answers:

- Project it on the **workspace sub-canvas** as a free-floating Plan card. Workspace canvas becomes "repos + Plans" rather than "repos only."
- Project it on **root** as an "org-level Plan."
- Both.

The simplest answer is workspace-scope projection — it matches the data model (Plans always have a workspace) and avoids the root-clutter problem.

### Q4. Promote-to-Plan UX per scope

If we go with the most-specific projection model and **no `Feature.initiativeId`**:

| User right-clicks a note on… | Promote dialog asks for | New Plan's relations | Renders on this canvas? |
|---|---|---|---|
| root | workspace (required) | `workspaceId` only | No (root doesn't project Plans). Note vanishes, toast + link. |
| workspace `ws:<id>` | nothing extra (workspace locked to current scope) | `workspaceId: <scope>` | ✅ if workspace projector emits Plans (Q3). |
| initiative `initiative:<id>` | workspace (required), milestone (required to attach) | `workspaceId, milestoneId` | ❌ (initiative canvas doesn't project Plans directly under (a)). Note vanishes, toast. |
| milestone `milestone:<id>` | workspace (required) | `workspaceId, milestoneId: <scope>` | ✅ (milestone projector already does this). |

So with the current decision (no schema change), **only milestone and workspace scopes deliver the magical visual swap**. Root and initiative scopes are toast-only. That's the honest read of the constraint.

If the team later approves `Feature.initiativeId`, initiative scope joins the magical-swap set.

### Q5. Does the "Promote to Plan…" menu item appear on every scope, even if the visual swap won't fire there?

Two consistent answers:

- **Show always.** Honest about the data model — Plans can be created from anywhere. On scopes without projection, surface a toast with a link to the new Plan's `/plan` page. The user understands "Plan was created, it's just not visible on this canvas yet."
- **Show only on scopes that project Plans.** Hide the menu item on root and initiative (under the no-schema-change decision). User never sees a Promote action that "doesn't seem to do anything visibly."

Pick the second if the team votes "no" on workspace/root projection too — otherwise the menu would be useless on every scope except milestone.

### Q6. Source-note disposition after promote

Settled separately in chat: **the source note disappears and the Plan node takes its place.** That's already supported by the existing `applyMutation(canvasRef, c => removeNode(c, note.id))` path; Ctrl-Z restores the note via the existing blob-undo action. No further questions.

## Proposal to discuss

A coherent v1 that respects the "no schema change" decision:

1. **Extend `workspaceProjector`** — emit `feature:<id>` nodes for every non-deleted Plan in the workspace where `milestoneId IS NULL`. Lay them out in their own row beneath the existing repo row. (New `PLAN_ROW_*` constants in `geometry.ts`.)
2. **Leave `rootProjector`, `milestoneTimelineProjector` (initiative scope), and `milestoneProjector` unchanged** for projection.
3. **Promote menu shows on milestone and workspace scopes only** (Q5 second option). On root and initiative, the right-click menu has no items, so the menu doesn't open.
4. **Update `canvas-categories.ts`** — extend the `feature` category's `promptGuidance` to say it can also live on workspace canvases without a milestone. The agent docs stay accurate.
5. **No `Feature.initiativeId`.** The team can revisit if "Plans on initiative canvases" becomes a real ask.
6. **Most-specific projection rule** — a Plan with `milestoneId` set renders on the milestone canvas only, not also on the workspace canvas. Predicate on workspace projector includes `milestoneId IS NULL`.

This delivers the magical visual swap on the two scopes where it makes sense, with zero schema migration, and a clear answer to "where can I create a Plan from the canvas?" — milestone canvases (existing) and workspace canvases (new).

## Today's stub

`src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx` wires `nodeContextMenu` on `<SystemCanvas>` with a single item:

```ts
{
  id: "promote-to-plan",
  label: "Promote to Plan…",
  match: { categories: ["note"] },
}
```

`onSelect` is a no-op (logs once for visibility) until the questions above are settled. The right-click surface is in place; functionality lands once the team makes the calls in Q1–Q5.
