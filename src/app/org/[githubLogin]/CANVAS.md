# Org Canvas

A live whiteboard on the org page. Initiatives and Milestones are real DB rows projected onto the canvas; humans create them through the `+` menu (which opens a dialog and hits the REST API). The agent annotates around them.

**Design doc:** `docs/plans/org-initiatives.md` — read it before non-trivial changes. (Old plan `docs/plans/org-canvas.md` is superseded.)

## The short version

- `src/lib/canvas/` — projection pipeline. `readCanvas(orgId, ref)` merges DB-projected live nodes (workspaces, repos, initiatives, milestones) with the authored `Canvas.data` blob. `writeCanvas` splits merged docs back into an authored-only blob.
- `src/lib/ai/canvasTools.ts` — agent tools (`read_canvas`, `update_canvas`, `patch_canvas`), each with optional `ref`. Agent does NOT create initiatives or milestones — those are human-only via the `+` menu.
- `src/app/api/orgs/[githubLogin]/canvas/*` — REST routes (root + `[ref]` + `hide`), all thin wrappers over `@/lib/canvas`.
- `src/app/api/orgs/[githubLogin]/initiatives/*` — REST routes for the DB-backed Initiative + Milestone models. Every mutating call emits `CANVAS_UPDATED` so open canvases refetch.
- `src/app/org/[githubLogin]/connections/` — client: `OrgCanvasBackground.tsx` (the UI), `canvas-categories.ts` (category registry — single source of truth), `canvas-theme.ts` (renderer definitions).
- `src/components/initiatives/` — shared `InitiativeDialog` / `MilestoneDialog` reused by the table UI and the canvas `+` menu.
- `src/lib/constants/prompt.ts` — `getCanvasPromptSuffix()` teaches the agent.

## Gotchas

- **Live vs authored.** Node ids prefixed `ws:` / `repo:` / `initiative:` / `milestone:` are projected from the DB — never authored. The registry flags those categories `agentWritable: false` so they stay out of the tool schema.
- **DB-creating `+` menu.** `initiative` and `milestone` are visible in the user's `+` menu (`userCreatable: true`) but creation is **intercepted** in `OrgCanvasBackground`: it opens the matching dialog instead of dropping a node. On save → POST to API → Pusher refresh → projector re-emits the node. Click position is saved to `Canvas.data.positions[liveId]` so the new node lands where the user clicked.
- **Adding a category** = add to `canvas-categories.ts` + add a matching `CategoryDefinition` in `canvas-theme.ts` (same `id`; load-time check throws on mismatch).
- **Adding a projected entity** = new `Projector` in `src/lib/canvas/projectors.ts` + add the id prefix to `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`.
- **Pusher invalidation.** Mutations to Initiatives/Milestones must emit `CANVAS_UPDATED` on the org channel with the right `ref` (root for initiatives; `initiative:<id>` for milestones; both for milestone changes that affect the root-level rollup).
