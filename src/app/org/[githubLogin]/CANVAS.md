# Org Canvas

A live whiteboard on the org page. Initiatives and Milestones are real DB rows projected onto the canvas; humans create them through the `+` menu (which opens a dialog and hits the REST API). The agent annotates around them.

**Design doc:** `docs/plans/org-initiatives.md` — read it before non-trivial changes. (Old plan `docs/plans/org-canvas.md` is superseded.)

## The short version

- `src/lib/canvas/` — projection pipeline. `readCanvas(orgId, ref)` merges DB-projected live nodes (workspaces, repos, initiatives, milestones) with the authored `Canvas.data` blob. `writeCanvas` splits merged docs back into an authored-only blob. `geometry.ts` is the shared source of truth for card sizes / row layout. `pusher.ts` is the shared `CANVAS_UPDATED` emitter.
- `src/lib/ai/canvasTools.ts` — agent tools (`read_canvas`, `update_canvas`, `patch_canvas`), each with optional `ref`. Agent does NOT create initiatives or milestones — those are human-only via the `+` menu.
- `src/app/api/orgs/[githubLogin]/canvas/*` — REST routes (root + `[ref]` + `hide`), all thin wrappers over `@/lib/canvas`.
- `src/app/api/orgs/[githubLogin]/initiatives/*` — REST routes for the DB-backed Initiative + Milestone models. Every mutating call emits `CANVAS_UPDATED` so open canvases refetch.
- `src/app/org/[githubLogin]/connections/` — client: `OrgCanvasBackground.tsx` (the UI), `canvas-categories.ts` (category registry + scope rules — single source of truth), `canvas-theme.ts` (renderer definitions).
- `src/components/initiatives/` — shared `InitiativeDialog` / `MilestoneDialog` reused by the table UI and the canvas `+` menu.
- `src/lib/constants/prompt.ts` — `getCanvasPromptSuffix()` teaches the agent.

## Gotchas

- **Live vs authored.** Node ids prefixed `ws:` / `repo:` / `initiative:` / `milestone:` are projected from the DB — never authored. The registry flags those categories `agentWritable: false` so they stay out of the tool schema.
- **DB-creating `+` menu.** `initiative` and `milestone` are visible in the user's `+` menu (`userCreatable: true`) but creation is **intercepted** in `OrgCanvasBackground`: it opens the matching dialog instead of dropping a node. On save → POST to API → Pusher refresh → projector re-emits the node. Click position is saved to `Canvas.data.positions[liveId]` so the new node lands where the user clicked.
- **Scope-aware `+` menu.** `categoryAllowedOnScope(id, ref)` in `canvas-categories.ts` is the single rule for which categories appear in the menu, and the same rule guards `handleNodeAdd`'s dispatch. Today: `initiative` only on root; `milestone` only on `initiative:<id>`; `workspace`/`repository` never (`userCreatable: false`).
- **Side-channel DB writes from canvas interactions.** Most live-node fields are read-only: the splitter discards `text` / `category` / `customData` on live ids on autosave. Position (`x`/`y`) and size (`width`/`height`) are the exceptions — they ride through `Canvas.data.positions[liveId]` as a per-canvas overlay (size is optional; only set when the user has resized). The other exception is the **milestone status swatch toolbar**, which intercepts in `handleNodeUpdate` and PATCHes the milestone REST endpoint directly. Optimistic local update + Pusher reconcile. New "edit a DB field from the canvas" features should follow that PATCH pattern.
- **`currentRef` state** tracks which canvas the user is looking at (driven by `SystemCanvas`'s `onNavigate` and `onBreadcrumbClick`). It gates the HiddenLivePill (root only), the scope-aware `+` menu, and the URL sync.
- **Deep links via `?canvas=<ref>`.** On mount, the URL's `?canvas=` is read synchronously into a ref, a spinner overlay covers the canvas, and `SystemCanvas`'s imperative `zoomIntoNode(ref, { durationMs: 0 })` drills in once root has loaded. The library only navigates from the currently-rendered canvas, so we always mount root first; the overlay hides the brief flash.
- **`hiddenLive` is `HiddenLiveEntry[] | null` (null = not yet fetched), NOT `[]`.** The notify effect short-circuits while null. `ConnectionsPage` gates the chat mount on the first non-stub callback to seed `defaultExtraWorkspaceSlugs` correctly; firing with an empty stub would seed the chat with no filtering and the real list would land too late (DashboardChat reads the prop only on mount).
- **Adding a category** = add to `canvas-categories.ts` (with `agentWritable` / `userCreatable` flags) + add a matching `CategoryDefinition` in `canvas-theme.ts` (same `id`; load-time check throws on mismatch).
- **Adding a projected entity** = new `Projector` in `src/lib/canvas/projectors.ts` + add the id prefix to `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`. Card width / row layout go in `geometry.ts` so theme and projector see the same numbers.
- **Adding decorative bands (columns / rows / lanes).** A projector returns optional `columns?` / `rows?` on its `ProjectionResult`. `readCanvas` merges them onto the returned `CanvasData`; the library renders them as background bands + headers. Bands are decorative — cards never snap to them. See `buildTimelineColumns` in `projectors.ts` for the milestone-timeline pattern.
- **Pusher invalidation.** Mutations to Initiatives/Milestones must emit `CANVAS_UPDATED` on the org channel with the right `ref` (root for initiatives; `initiative:<id>` for milestones; both for milestone changes that affect the root-level rollup). Use `notifyCanvasUpdatedByLogin` / `notifyCanvasesUpdatedByLogin` from `@/lib/canvas`.
