# Brainstorm canvas: architecture and performance fixes

Standalone: another session can pick this up cold. Repo: `stakwork/hive`; paths are under `src/app/org/[githubLogin]/` unless noted. Written 2026-10-22, from a code review of the Brainstorm tab at `2f64f5cf7`. Companion to `docs/plans/infinite-canvas.md` (what we're building); this doc is how to make it hold up.

Nothing here has been profiled yet. Step 0 measures first so each fix can show its effect.

## Order and PRs

One PR per numbered step, each from fresh `master`, run one at a time. Running order: **0 → 6 → 1 → 2 → 3 → 4 → 5 → 7**. Step 6 goes early because deleting the old desk (~2,500 lines) leaves later steps less to work around.

| # | Step | Size | Depends on |
|---|---|---|---|
| 0 | Baseline profile | S | — |
| 1 | Camera as one world transform | L | 0 |
| 2 | Cards keep their state when culled | M | 1 |
| 3 | Fetching: server-side search and lookup, one refresh source | L | — |
| 4 | Real time: shared proposals, artifacts off chat transcripts, indexed job lookup | L | — |
| 5 | Navigation as one reducer | M | 1 |
| 6 | One brainstorm renderer | M | — |
| 7 | Artifact previews on cards are static | S | 1 |

---

## 0. Baseline profile

**Why:** the review's performance claims are from reading code. Measure before and after.

- Seed an org with 3 initiatives on the desk, one with ~4 milestones × ~5 features, a brainstorm of 3 questions × 3 options, and a few artifacts (mock-org data in `src/app/api/mock/graph/initiative-fixture.ts` is the starting point).
- With React DevTools Profiler and a Performance trace (Tom's DevTools; Playwright can't measure this well), record: a 2s wheel zoom, a 2s drag pan, one level flight (org → initiative).
- Note commits per second, ms per commit, components rendered per commit, dropped frames.
- Save the numbers in this doc under "Results" so later PRs can quote them.

**Done:** numbers recorded for all three gestures.

## 1. Camera as one world transform

**Problem:** the camera is React state. `flyTo`, the wheel handler and pointer drag call `setCam` every frame (`_components/infinite-canvas/InfiniteCanvas.tsx` ~314, ~636, ~662), and the level-transition blend `trans.u` is state too. Each frame re-renders the whole `InfiniteCanvas`, re-sorts `ordered`, rebuilds every path in `Links` (with a `board.nodes.filter` per option), recomputes `visibility()`/`focusWeight()` per node, and re-renders every visible card. No card component is memoized (`nodes.tsx`, `desk.tsx`, `feature-panels.tsx` have zero `memo`), and each card gets new screen-space `left/top/width/scale` props every frame.

**Decide first: React Flow or a hand-built world layer.** `@xyflow/react` is already a dependency (the old desk uses it). It already moves the camera with one transform and skips off-screen cards (`onlyRenderVisibleElements`). Check whether the canvas's level-by-level zoom, open/dim blend and cards drawn at a fixed width then scaled fit its custom nodes. Use it if they do, and build the layer below only if they don't. Write the reason in the PR.

**Change:**
- One world layer `<div>` inside the canvas root with `transform: translate(tx,ty) scale(z)`, `transform-origin: 0 0`. Cards and the `Links` SVG are placed in **world** coordinates (`n.rect`) inside it, at their design width and scaled once by `n.rect.w / designW` (static per layout, not per frame).
- Camera lives in a ref. A `setCamera(c)` helper writes the layer's `style.transform` (and the desk background from `deskStyle`) directly; wheel, drag and `flyTo` call it, never `setState`.
- React state keeps only what changes the scene: level, open trees, and a coarse zoom bucket if any card needs zoom-dependent detail (re-render on bucket change only).
- Level transitions (`trans.u`): drive opacity of open/dim through CSS variables on the world layer (or per-node `style.opacity` via refs) during the flight; commit to state once at the end.
- `onScreen` culling: compute against world-space viewport bounds, re-run on camera settle (end of flight / debounce of wheel and drag) rather than every frame. Over-render a margin so panning doesn't pop.
- `React.memo` on `SceneItem`, `Face`, `FrameHeader`, `StoriesPanel`, `QuestionCard`, `OptionCard`, `BuildCard`, `ArchitectureCard`, `StackCard`, `AddCard`; `ctx` already stable via `useMemo` — make sure `onClick` handlers are stable too (one delegated handler keyed by `data-node` instead of `clickNode(n)` closures).
- `Links`: compute paths in world space, memoized on `scene`/`board`/open state; the transform moves them for free. Precompute `madeBy` and option→question lookups into maps once per board.
- Job markers: move into each card (they're already in design units), not a second pass over `ordered`.
- Text crispness: add `will-change: transform` only while moving, remove on settle so the browser re-rasterizes text sharp.

**Files:** `infinite-canvas/InfiniteCanvas.tsx`, `scene.ts` (helpers for world→screen only where chrome needs it: AskBox anchor, AllInitiatives anchor), `theme.ts` (`deskStyle`), `nodes.tsx`, `desk.tsx`, `feature-panels.tsx`.

**Tests:** existing unit tests under `src/__tests__/unit/app/org/` for scene/layout still pass; add one asserting a wheel event does not trigger a React commit of `SceneItem` (render counter via a test-only prop or Profiler `onRender`).

**Done:** zoom and pan produce no React commits mid-gesture (Profiler), a flight commits at most twice, Step 0 numbers improve and are recorded.

## 2. Cards keep their state when culled

**Problem:** `SceneItem` returns `null` when off screen or `vis < 0.01` (`InfiniteCanvas.tsx` ~1148). Card-local state is lost: rename draft and `editing` (`nodes.tsx` ~454), add-requirement/story draft (~548), accept/reject in flight (~234). Panning away mid-edit or flying to another level drops the draft; artifact thumbnails remount and restart `useInView({ once })`.

**Change:**
- Never unmount a card that has local state in use. Simplest: culled cards render `display: none` / `visibility: hidden` instead of `null` once mounted (keep `null` only for never-seen cards, so first paint stays cheap).
- Alternatively, lift drafts to a small canvas store (`_state/`) keyed by node id. Prefer the first; do the second only if the DOM count gets too high at org zoom.
- An in-flight decide (`deciding`) should come from the mutation, not component state.

**Done:** start typing a rename, pan the card off screen and back — draft intact; same across a level change and back.

## 3. Fetching: server-side search and lookup, one refresh source

**Problems:**
1. ⌘K, "show all" and a deep link (`?at=`) read **every** plan: `read` returns all ids when `palette || showAll || seek` (`InfiniteCanvas.tsx` ~193). Up to `LISTED_INITIATIVES` (50) × workspaces separate `initiative-tree` reads against the swarm.
2. Five overlapping invalidation sources for the same queries (`infinite-canvas/useCanvasBoard.ts`, `_state/useCanvasJobs.ts`, `infinite-canvas/useCanvasProposals.ts`): 60s polling on list/tree/choice queries; 1.6s polling while `building`; Pusher `INITIATIVE_UPDATED`/`BRAINSTORM_UPDATED`; `useCanvasJobs` tree re-reads on each nudge; turn-end invalidation of all `initiatives`, `initiative-tree`, `choice-tree` across every workspace, twice (second after a 1.5s guess).
3. Pusher events carry no data, so every viewer refetches the full tree from the swarm on every event.

**Change:**
- **Search endpoint:** `GET /api/orgs/[githubLogin]/graph/search?q=` (or per workspace, fanned out server-side) returning `{ refId, type, name, path: [{refId, name, type}], initiativeRefId, workspaceSlug }`. Check whether Jarvis already offers a name search over the plan labels before writing one — reuse `src/services/swarm/api/nodes.ts` / `services/graph/workbench.ts`. `Palette.tsx` queries it (debounced); it no longer needs `board`.
- **Locate endpoint:** `GET …/graph/locate?ref=` → `{ initiativeRefId, workspaceSlug, path }`. Deep links and "pull up …" (`NAVIGATE`) use it, then read only that one plan. Can be the same handler as search with an exact ref.
- **`read` shrinks to:** desk + pulled + the open initiative. Remove the `palette || showAll || seek` branch. "Show all" lists summaries only (it already has them from the list query).
- **One refresh source:** strut/Hive emit `INITIATIVE_UPDATED { workspaceSlug, root }` whenever the graph under an initiative changes (job writes, decided proposals, edits). The canvas invalidates exactly `treeKey(ws, root)` (and the list on create/delete/rename only). Then:
  - drop the turn-end double refresh in `useCanvasBoard`;
  - drop tree re-reads from `useCanvasJobs` (it keeps only the jobs query);
  - drop the blanket `["initiative-tree"]` invalidation in `useCanvasProposals.decide` (the event covers it);
  - keep polling only as a fallback: 5 min, and `building` polling only for the open initiative.
  - Confirm with Tom where the strut-side emit lives (`services/strut-runs/job-turn.ts` or the strut webhook) — the plan doc says "nothing fires today when strut writes the graph".
- **Event payloads:** include a `version`/`updatedAt` in `INITIATIVE_UPDATED` so a client whose cached tree is already at that version skips the refetch (the client that made the edit). Full delta payloads are out of scope; revisit if viewer counts grow.

**Files:** `infinite-canvas/useCanvasBoard.ts`, `Palette.tsx`, `InfiniteCanvas.tsx` (seek), `_state/useCanvasJobs.ts`, `infinite-canvas/useCanvasProposals.ts`, new routes under `src/app/api/orgs/[githubLogin]/graph/`, `src/lib/pusher.ts` (payload types), mock routes under `src/app/api/mock/graph/`.

**Tests:** integration tests for search/locate (access: only workspaces the caller can read — reuse `validateWorkspaceAccess`); unit test that opening the palette issues no `initiative-tree` requests. Integration tests need `TEST_DATABASE_URL` on the test DB (see the guard in stakwork/hive#5584).

**Done:** opening ⌘K or a deep link to a node under an off-desk initiative makes ≤ 2 graph requests; one strut write produces exactly one tree refetch per viewer.

## 4. Real time: shared proposals, artifacts off chat transcripts, indexed job lookup

**Problems:**
1. Pencil cards come only from **your active chat**: `useCanvasProposals` reads `activeConversationId`'s messages. Teammates' pending proposals never show, and switching chats changes the canvas — against "canvas shared, from the graph" (`infinite-canvas.md` §3).
2. Card artifacts are read out of chat transcripts: `deliveredArtifacts` (`src/services/canvas-jobs.ts` ~195–215) unnests whole `shared_conversations.messages` JSON arrays to find a job's refs.
3. Jobs are found by a JSON path filter `input → focus → initiativeRefId` (`canvas-jobs.ts` ~115); no index found in `prisma/migrations`.
4. `useArtifactContent` sends the viewer's own `activeConversationId` to the live PR route, which then tries to update the PR state in an unrelated chat (`artifacts/useArtifactContent.ts` ~165; `api/orgs/[githubLogin]/strut/pull-request/route.ts` ~83).

**Change:**
- **Proposals by initiative:** add `GET /api/orgs/[githubLogin]/strut/proposals?initiative=<ref>` returning pending proposals whose run focus is under that initiative, for any member who can read the workspace. `useCanvasProposals(githubLogin, initiative)` reads it; nudged by a `PROPOSAL_UPDATED` org-channel event (or folded into `CANVAS_CARD_JOB`). Decide stays on the existing route. Check with Tom: does strut keep proposals per conversation such that a teammate may decide one? (Access rule today goes through the proposing turn's conversation.)
- **Artifacts on the run:** when a job turn delivers artifacts (`services/strut-runs/job-turn.ts`, where refs are mapped), also store the refs on the `StrutRun` row (new `artifacts Json?` column, or `output.artifacts` if `output` exists). `listCanvasJobs` reads them from the rows it already has; delete `deliveredArtifacts`. Backfill: a one-off script for runs in the canvas window (`WINDOW_MS`), or accept that older jobs show no artifacts — Tom's call.
- **Indexed focus:** add `focusInitiativeRefId String?` (and `focusRefId String?`) columns on `StrutRun`, written where the focus is stored on the turn's input, with `@@index([focusInitiativeRefId, createdAt])`. Query by column. Migration via `npx prisma migrate dev --name strut_run_focus_columns`; backfill from `input->'focus'` in the same migration's SQL.
- **PR live from the canvas:** `useArtifactContent` takes the conversation id from the caller (chat passes its own; canvas passes none). Default to none.

**Files:** `prisma/schema.prisma` + migration, `src/services/canvas-jobs.ts`, `src/services/strut-runs/job-turn.ts`, `src/lib/canvas/canvas-jobs.ts`, new proposals list route, `infinite-canvas/useCanvasProposals.ts`, `artifacts/useArtifactContent.ts`, `artifacts/ChatArtifacts.tsx`.

**Tests:** integration test for proposals-by-initiative access (member of another workspace denied); `listCanvasJobs` returns artifacts from the row; migration backfill check on a seeded row.

**Done:** two users on the same initiative see the same pencil cards and artifacts; `canvas-jobs` does no JSON unnesting; the jobs query uses the index (`EXPLAIN`).

## 5. Navigation as one reducer

**Problems:**
- ~8 pieces of navigation state (`level`, `initiative`, `seek`, `pendingGo`, `userMoved`, `framed`, `trans`, `pulled`) kept in step by effects that call `go()`, which sets more state; several `exhaustive-deps` disables; `reach` read through a stale closure inside the `seek` effect.
- `?at=` written with `history.replaceState`: browser Back leaves the tab instead of going up a level.
- "Level left the scene → go to org" (`InfiniteCanvas.tsx` ~379) only waits on the list query, so a transient tree gap can bounce you out.

**Change:**
- `useCanvasNav` reducer: state `{ level, pulled, pending: null | { kind: "at" | "go" | "seek", target, text? }, userMoved }`, actions `GO`, `UP`, `REACH`, `SEEK`, `RESOLVED(scene, board)`, `CAMERA_MOVED`. `initiative` is derived from `level` (`initiativeOf`), never stored. Camera flights are a side effect of `level` changes in one effect.
- With Step 3, `SEEK`/`at` resolve through the locate endpoint: dispatch `REACH(initiativeRefId, target)` from the response — no waiting on every plan.
- Back button: `pushState` on `GO` into a level, `replaceState` on `UP`/crumbs, and handle `popstate` → `GO(at)`. Ask Tom before shipping — it changes what Back does on the org page.
- "Left the scene" only fires when the list and that initiative's tree have both settled without the node.

**Files:** new `infinite-canvas/useCanvasNav.ts`, `InfiniteCanvas.tsx`, tests in `src/__tests__/unit/app/org/`.

**Tests:** reducer unit tests: deep link to an off-desk feature; "pull up" with no match asks Jamie; camera move cancels a pending nav; tree refetch gap doesn't eject the level.

**Done:** no navigation effects with disabled deps; reducer covered by unit tests.

## 6. One brainstorm renderer

**Problem:** three renderings of the same choice tree — the canvas's `QuestionCard`/`OptionCard` (`infinite-canvas/nodes.tsx`), the old desk (`brainstorm-board/Desk.tsx`, ~1,050 lines, still used for `&root=` links in `OrgCanvasView.tsx` ~167), and `artifacts/viewers/ChoiceTree.tsx` — plus two write endpoints (`api/workspaces/[slug]/graph/brainstorms/changes` and `…/initiative-tree/changes`).

**Before deleting, check first:**
- **Brainstorms with no feature.** The old desk shows every brainstorm in the org; the canvas only shows those `ABOUT` a feature (v1 rule). Count the brainstorm roots (`listBrainstormRoots`) with no `ABOUT` edge to a plan node, and report the count to Tom before deleting. They would have nowhere to appear.
- **Imports from `brainstorm-board/`.** `src/services/graph/workbench.ts` imports `graphEpochToMs`/`graphTimeToMs` from `brainstorm-board/desk-layout.ts`; move those to `src/lib`. The canvas imports `expandDraft` (`actions.ts`) and `hand` (`fonts.ts`); move them into `infinite-canvas/`.
- **Links into the desk:** `treeDeskHref` / `useOpenArtifact` in `artifacts/openArtifact.ts`, and `brainstormBoardHref` in `artifacts/viewers/graph.tsx`.
- **Docs:** the desk paragraph in `CANVAS.md`.

**Change:**
- `&root=<question>` links resolve (via Step 3's locate) to the feature the brainstorm is about and open the infinite canvas there with that tree unfolded.
- `ChoiceTree` artifact viewer: keep for the chat panel only if it's a different job (a read-only thumbnail); otherwise render the canvas cards in the panel. Confirm with Tom.
- Delete `brainstorm-board/` pieces no longer imported, and the `brainstorms/changes` route once nothing calls it (grep the chat card, `canvasChatArtifacts.ts`, `openArtifact.ts`, mock routes, strut-side callers).
- Remove the `deskLink` / `infiniteCanvas` branching in `OrgCanvasView.tsx`.

**Done:** one renderer for brainstorms on the canvas; `&root=` links land on the canvas; dead code and route removed; `brainstorm-board` unit tests removed or moved.

## 7. Artifact previews on cards are static

**Problem:** card artifact strips render `ChatArtifacts` (scaled DOM, scrollable). HTML, app, URL and PDF kinds use iframes (`viewers/html.tsx`, `app.tsx`, `url.tsx`, `pdf.tsx`); under transforms they're costly and they reload on remount.

**Change:**
- On the canvas (`OnPaper` context is already there), `ChatArtifacts` draws rows and static thumbnails only — never an iframe. Iframe-backed kinds show their icon/title row; the live view opens in `ArtifactPanel`.
- Check `registry.ts`'s `chat.place` for each iframe kind; add an `onCanvas` override only if a kind needs one.

**Done:** no `<iframe>` inside `[data-infinite-canvas] [data-artifacts]` (assert in an e2e or unit test); opening one still works in the panel.

---

## Keep as is

Indexed `byId`/`kids` (`board.ts`), module-level `combine` functions, optimistic edits with rollback (`applyLocally`), the artifact reader route, and the focus sent as text in the context line.

## Open questions for Tom

1. Step 3: where does strut's "graph changed under initiative X" event get emitted — Hive on job settle, or strut directly?
2. Step 4: may a teammate decide another person's proposal? Backfill artifacts onto old runs, or let them go?
3. Step 5: should Back go up a level?
4. Step 6: keep the `ChoiceTree` panel viewer, or show canvas cards in the panel?

## Results

### Step 0 baseline (2026-10-22, master `2f64f5cf7`)

**Method:** `scripts/profile-infinite-canvas.mjs` (untracked until the plan PR).
- Dev server `next dev --turbopack`, `USE_MOCKS`, mock sign-in, `/org/dev-user`.
- Playwright Chromium, headless on the real GPU, 1440×900 at 2×, 120 Hz. Gestures sent at 60 Hz through CDP input.
- React measured in profiling mode through a stand-in DevTools hook. Medians of 5 runs per mode, each on a fresh page load.
- The script grows the mock board through the app's own write endpoints, once per dev-server start, so no fixture files change.

These are dev-build numbers: compare later steps against the same setup.

```bash
NEXTAUTH_URL=http://localhost:3041 npx next dev --turbopack -p 3041
```
```bash
node scripts/profile-infinite-canvas.mjs --base http://localhost:3041 --runs 5 --out <dir>
```

| Gesture | Commits/s | ms/commit mean/p95 | Components/commit | `SceneItem`/commit | Dropped frames | Max frame (ms) | Main thread busy |
|---|---|---|---|---|---|---|---|
| Zoom, org | 57.4 | 4.0 / 4.9 | 103 | 89.5 | 0 | 10.3 | 34% |
| Zoom, initiative | 54.9 | 4.1 / 7.4 | 172 | 102.3 | 0 | 10.3 | 40% |
| Pan, org | 57.3 | 4.0 / 4.9 | 103 | 89.5 | 5 | 49.6 | 36% |
| Pan, initiative | 56.3 | 4.0 / 7.5 | 172 | 102.3 | 6 | 59.7 | 41% |
| Flight org → initiative | 78.8 | 3.3 / 8.3 | 158 | 89.9 | 21 | 82 | 50% |

- There is about one commit of the whole scene per input event.
- `SceneItem` renders equal the scene size, including culled cards that return `null`; only 96–282 canvas DOM nodes exist.
- Inside the initiative, the next most-rendered components per commit are `EditableText` (19), `ReqRow` (12), `Dot` (12), `AddInline` (6), `AskChip` (6) and `Face` (5).

**Requests** (`/api/*`, counted until 3 s quiet; the mock has 7 initiatives in one workspace):

| Action | Total | `initiative-tree` |
|---|---|---|
| First load | 14 | 3 (the desk) |
| Open ⌘K | 4 | 4 (every other plan) |
| Deep link to a feature under an off-desk initiative | 19 | 7 (every plan) |

### Step 1: camera as one world transform (stakwork/hive#5621)

**Built by hand, not on React Flow:**
- Its per-frame blend would re-render every node.
- Its zoom would have to be switched off to keep our wheel rules.
- It culls on every camera move.
- Its handle-based edges don't fit our links.

No `will-change`: it doubled the flight's dropped frames.

| Gesture | Commits/s | `SceneItem`/commit | Dropped frames | Main thread busy |
|---|---|---|---|---|
| Zoom, org | 57.9 → 1.0 | 89.5 → 0 | 0 → 0 | 34% → 6% |
| Zoom, initiative | 56.4 → 1.0 | 100.3 → 0 | 0 → 0 | 38% → 8% |
| Pan, org | 56.8 → 0.9 | 89.5 → 0 | 6 → 2 | 35% → 7% |
| Pan, initiative | 56.4 → 0.9 | 100.3 → 0 | 6 → 4 | 40% → 11% |
| Flight org → initiative | 73 → 11.6 | 87 → 16.6 | 37 → 18 | 61% → 22% |

The ~1 commit/s left during zoom and pan comes from the attention panel's polling, outside the canvas. The baseline was rerun on master just before this change, so its "before" numbers differ slightly from Step 0.

### Step 2: cards keep their state when culled

- A card that has been shown stays mounted when culled, `display: none`, frozen at the props it last showed with (`SceneItem` keeps them, so `SceneCard`'s memo skips every commit while it's hidden). It leaves `boxes`, so the blend painted each frame skips it. A card never shown is still not mounted.
- A container's frame and face, once drawn, both stay; the level hides whichever it doesn't show. A rename in an open frame survives going up a level.
- `display: none`, not `visibility: hidden`: a hidden subtree costs no layout or paint, and is out of tab order, the accessibility tree and hit testing either way.
- Chrome blurs a focused field when its card is hidden, and blur saves. A blur on a field that's no longer visible (`checkVisibility()`) doesn't save, so the draft waits in the field.
- An accept/reject in flight is held in `useCanvasProposals` (`deciding`), not in `PencilBar`.

**DOM:** 94 canvas nodes on a fresh org load. After visiting all 32 levels of the mock board and coming back to the org: 1,663 (87 hidden cards, 1,542 nodes). No cap: hidden subtrees don't render, lay out or paint.

Before is master `0b56149c1` (Step 1), rerun in the same session; medians of 5 runs.

| Gesture | Commits/s | `SceneItem`/commit | Dropped frames | Main thread busy |
|---|---|---|---|---|
| Zoom, org | 0.9 → 0.9 | 0 → 0 | 0 → 0 | 5.7% → 5.7% |
| Zoom, initiative | 1.0 → 1.0 | 0 → 0 | 0 → 0 | 9.5% → 9.3% |
| Pan, org | 0.9 → 0.9 | 0 → 0 | 5 → 5 | 8.2% → 8.1% |
| Pan, initiative | 0.9 → 0.9 | 0 → 0 | 5 → 5 | 10.6% → 11.8% |
| Flight org → initiative | 11.7 → 10.9 | 17.3 → 15.9 | 11 → 14 | 18% → 21% |

- The flight's dropped frames are within run-to-run noise. Over 10 more runs each: before 12–34 (median 13, mean 17.3), after 9–20 (median 16, mean 15.9).
- Inside an initiative opened by deep link, the page starts with 362 canvas nodes instead of 328: org cards from the first frame stay mounted, hidden.
