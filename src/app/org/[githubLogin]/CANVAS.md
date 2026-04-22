# Org Canvas Feature

The org page has a live, spatial **Canvas** (whiteboard) that the AI agent can read and write via chat. The user sees it as the background of the org page and can edit it in real time; the agent keeps it in sync with the conversation.

Keep this doc short — point to it when making changes, don't turn it into a spec.

## Files involved

- **`src/app/org/[githubLogin]/OrgChat.tsx`** — Chat UI on the org page. Wraps `DashboardChat` and passes `orgId` through, which is what unlocks canvas + connection tools server-side.
- **`src/app/api/ask/quick/route.ts`** — The streaming ask endpoint. When called with an `orgId`, it merges `buildCanvasTools(orgId)` (and connection tools) into the toolset alongside the per-workspace ask tools.
- **`src/lib/ai/canvasTools.ts`** — The three canvas tools: `read_canvas`, `update_canvas`, `patch_canvas`. Persists to the `Canvas` table (root row, `ref=""`) and broadcasts `CANVAS_UPDATED` over the org Pusher channel.
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

- **Root canvas only.** Sub-canvases (`ref != ""`) are not yet exposed to the agent.
- **Preserve user edits.** The prompt instructs the agent to always `read_canvas` first and echo back user-authored nodes on `update_canvas`. Keep this invariant if you refactor.
- **Adding a category = two edits.** The registry in `canvas-categories.ts` is authoritative. To add one: (1) append a `CategorySpec` entry there, (2) add the matching `CategoryDefinition` under the same `id` in `CATEGORY_DEFINITIONS` in `canvas-theme.ts`. The prompt and tool schema pick it up automatically. The theme throws at load if a spec lacks a definition, so mismatches are loud.
- **Layout is the agent's job.** The prompt describes the intended layer order (workspaces → objectives → initiatives → notes/decisions) but doesn't prescribe coordinates — the model picks `x` / `y`, and the user can drag things after. Keep it that way.
