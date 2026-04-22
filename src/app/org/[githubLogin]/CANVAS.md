# Org Canvas Feature

The org page has a live, spatial **Canvas** (whiteboard) that the AI agent can read and write via chat. The user sees it as the background of the org page and can edit it in real time; the agent keeps it in sync with the conversation.

Keep this doc short — point to it when making changes, don't turn it into a spec.

## Files involved

- **`src/app/org/[githubLogin]/OrgChat.tsx`** — Chat UI on the org page. Wraps `DashboardChat` and passes `orgId` through, which is what unlocks canvas + connection tools server-side.
- **`src/app/api/ask/quick/route.ts`** — The streaming ask endpoint. When called with an `orgId`, it merges `buildCanvasTools(orgId)` (and connection tools) into the toolset alongside the per-workspace ask tools.
- **`src/lib/ai/canvasTools.ts`** — The three canvas tools: `read_canvas`, `update_canvas`, `patch_canvas`. Each takes an optional `ref` (defaults to `""` = root). Persists through `@/lib/canvas` and broadcasts `CANVAS_UPDATED` over the org Pusher channel.
- **`src/lib/canvas/`** — The projection pipeline. `readCanvas` merges the authored `Canvas.data` blob with live nodes from `PROJECTORS` (workspaces today; features, members, tasks later). `writeCanvas` splits an incoming merged `CanvasData` back into an authored-only blob + a `positions` overlay for live ids. `parseScope`, `isLiveId`, and `CanvasBlob` are the public shapes. See `docs/plans/org-canvas.md` for the design.
- **`src/lib/constants/prompt.ts`** — `getCanvasPromptSuffix()` teaches the agent the canvas workflow and layout. Appended to the multi-workspace system prompt when `orgId` is present, alongside `getConnectionPromptSuffix()`. The Categories section is generated from the registry (see below).
- **`src/app/org/[githubLogin]/connections/canvas-categories.ts`** — Single source of truth for categories. Pure data: one `CategorySpec` per category with `id`, `agentDescription`, optional `promptGuidance`, optional `customDataKeys`. Exports `buildCategoryDescription()` (tool schema) and `buildPromptCategorySection()` (prompt bullets).
- **`src/app/org/[githubLogin]/connections/canvas-theme.ts`** — Renderer config: `CategoryDefinition` for each category's visual slots (progress bars, headers, colors). Reads ids from `CATEGORY_REGISTRY` and throws at load if any id lacks a renderer definition.
- **`src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx`** — Client component that fetches the canvas, subscribes to `CANVAS_UPDATED` Pusher events, and renders via `SystemCanvas`.

## High-level flow

1. User chats on the org page → `OrgChat` posts to `/api/ask/quick` with `orgId` + workspace slugs.
2. Route builds workspace ask tools and, because `orgId` is set, also attaches connection + canvas tools.
3. System prompt = multi-workspace prompt + connection suffix + canvas suffix. Disjoint vocabularies let the agent pick: "draw/diagram" → canvas, "document integration" → connections.
4. Agent calls `read_canvas` first, then `update_canvas` (full redraw) or `patch_canvas` (targeted edits).
5. Each write persists to `Canvas` and fires a Pusher `CANVAS_UPDATED` event on the org channel; the client re-fetches and re-renders.

## Design notes (things that are easy to get wrong)

- **Live vs authored nodes.** Ids prefixed with `<kind>:` (e.g. `ws:<cuid>`) are **projected from the DB on every read**. The agent never authors them; the category registry marks those categories with `agentWritable: false`, which keeps them out of the tool schema. Authored and live nodes are merged into one `CanvasData` the client sees — it never has to distinguish them. On write, the server splits them back (`src/lib/canvas/io.ts`); live-id text/category are discarded, only `{x, y}` is persisted as a position overlay.
- **Preserve user edits.** The prompt instructs the agent to always `read_canvas` first and echo back user-authored nodes AND projected live nodes on `update_canvas`. Keep this invariant if you refactor.
- **Adding a category = two edits.** The registry in `canvas-categories.ts` is authoritative. To add one: (1) append a `CategorySpec` entry there, (2) add the matching `CategoryDefinition` under the same `id` in `CATEGORY_DEFINITIONS` in `canvas-theme.ts`. The prompt and tool schema pick it up automatically. The theme throws at load if a spec lacks a definition, so mismatches are loud. If the category is DB-projected, also set `agentWritable: false` so it's filtered out of the agent's tool schema.
- **Adding a projected entity kind = one projector.** Add a `Projector` in `src/lib/canvas/projectors.ts`, register it in `PROJECTORS`, teach `parseScope` the ref prefix if you want a dedicated scope, and add the prefix to `LIVE_ID_PREFIXES` in `src/lib/canvas/scope.ts`. No other code should need to learn about the new kind.
- **Layout is the agent's job.** The prompt describes the intended layer order (workspaces → objectives → initiatives → notes/decisions) but doesn't prescribe coordinates — the model picks `x` / `y`, and the user can drag things after. Keep it that way.
