# Org Canvas

A live whiteboard on the org page. Users and the AI agent edit it together.

**Design doc:** `docs/plans/org-canvas.md` — read it before non-trivial changes.

## The short version

- `src/lib/canvas/` — projection pipeline. `readCanvas(orgId, ref)` merges DB-projected live nodes (workspaces, repos) with the authored `Canvas.data` blob. `writeCanvas` splits merged docs back into an authored-only blob.
- `src/lib/ai/canvasTools.ts` — agent tools (`read_canvas`, `update_canvas`, `patch_canvas`), each with optional `ref`.
- `src/app/api/orgs/[githubLogin]/canvas/*` — REST routes (root + `[ref]` + `hide`), all thin wrappers over `@/lib/canvas`.
- `src/app/org/[githubLogin]/connections/` — client: `OrgCanvasBackground.tsx` (the UI), `canvas-categories.ts` (category registry — single source of truth), `canvas-theme.ts` (renderer definitions).
- `src/lib/constants/prompt.ts` — `getCanvasPromptSuffix()` teaches the agent.

## Gotchas

- **Live vs authored.** Node ids prefixed `ws:` / `repo:` / `feature:` are projected from the DB — never authored. The registry flags those categories `agentWritable: false` so they stay out of the tool schema.
- **Adding a category** = add to `canvas-categories.ts` + add a matching `CategoryDefinition` in `canvas-theme.ts` (same `id`; load-time check throws on mismatch).
- **Adding a projected entity** = new `Projector` in `src/lib/canvas/projectors.ts` + add the id prefix to `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`.
- **Authored objectives are drillable.** `splitCanvas` auto-stamps `ref: "node:<id>"` on any node with a category in `DRILLABLE_CATEGORIES`. The child canvas's progress rolls up into the parent via `computeChildRollups`; manual `customData` still wins.
