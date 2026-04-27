# Org Canvas as Default View + Pusher Subscription Fix

Make the system canvas the default view of the org page (no more "click Connections to see it"), restructure the page chrome around an icon-only left rail, add a node-detail panel on the right when a canvas node is selected, and fix the Pusher subscription bug that's been silently breaking real-time `CANVAS_UPDATED` delivery.

Status: **shipped**.

## Goal

Today the org page (`/org/[githubLogin]`) opens to a textual Workspaces list, and the canvas — clearly the more interesting surface — is hidden behind a "Connections" button that navigates to a separate route (`/org/[githubLogin]/connections`). Users have to know to click in. We want the opposite: canvas first, with the legacy sections still reachable but demoted to icons in a left rail.

While we're rebuilding the chrome, we also fix a real-time bug: when the agent calls `patch_canvas` / `update_canvas`, the `CANVAS_UPDATED` Pusher event sometimes never reaches `OrgCanvasBackground`, so the canvas doesn't refresh until the user reloads. The cause is a shared-channel teardown race between `ConnectionsSidebar` and `OrgCanvasBackground`. Both components subscribe to the same `org-{githubLogin}` channel, but `ConnectionsSidebar`'s effect dependency churn causes it to re-mount its subscription several times during initial load, and each cleanup calls `pusher.unsubscribe(channelName)` — which destroys the *singleton* channel object that `OrgCanvasBackground` already bound to. By the time the user starts chatting, the canvas's handler is orphaned on a dead channel.

Two related problems, one PR. The Pusher fix is the load-bearing piece; the chrome change is the user-visible piece.

## Non-goals

- **Voice mode** — earlier iteration of this plan included a voice tab in the right panel; deferred to its own feature (see `voice-agent.md`). The right panel ships with one tab today: Details.
- **Agent canvas-suggestion diff cards** — also deferred.
- **Removing or replacing any of the seven existing tab views.** Workspaces / Chat / Members / Initiatives / Schematic / Graph all keep their current implementations; only the chrome around them changes.
- **Touching `system-canvas-react`.** All changes live in app-level code.
- **Changing canvas data, projectors, or the `Canvas.data` schema.** This is a chrome + bug-fix PR, not a model change.

## The chrome we're building

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◢◣ stakwork  @stakwork  ↗                                              │
├──┬──────────────────────────────────────────────┬─────────────────────┤
│▣ │                                              │  Right panel        │
│  │                                              │  (Details)          │
│⌬ │                                              │                     │
│  │            SYSTEM CANVAS                     │  When a node is     │
│✦ │            (default view)                    │  selected, show its │
│  │                                              │  name + summary +   │
│⊞ │                                              │  any quick links    │
│  │                                              │                     │
│♟ │                                              │  When nothing is    │
│  │                                              │  selected, render   │
│↯ │                                              │  the existing       │
│  │                                              │  ConnectionsSidebar │
│⤳ │      ┌──────────────────────┐                │  body (doc list).   │
│  │      │ Ask the agent…       │ [+]            │                     │
│  │      └──────────────────────┘                │                     │
└──┴──────────────────────────────────────────────┴─────────────────────┘
```

- **Left rail** — narrow (~56px), icons only, with `<Tooltip>` labels on hover. One icon per existing section: Canvas (Network), Connections (Link2), Initiatives (Target), Workspaces (LayoutGrid), Members (Users), Schematic (GitBranch), Graph (Workflow). Active item highlighted. Replaces the current `<TabsList>` + Connections `<Link>` in `OrgPageContent.tsx:391-409`.
- **Center column** — the canvas for Canvas/Connections views; the existing component for the other five views (full-bleed, no canvas underneath). Mounted *once* in the layout so canvas zoom/pan/sub-canvas state survives a Canvas → Connections toggle.
- **Right panel** — fixed `w-80` like today, opaque, single mode for now: **Details**. Body content depends on canvas selection (see "Right panel content" below). For the Connections view, it shows the existing connections-doc list exactly as it does today.

That's the whole UI change. No new entities, no new APIs.

## Routing

Path-based, not query-based — seven sections deserve real URLs:

| Path | View |
| ---- | ---- |
| `/org/[githubLogin]` | Canvas (default) |
| `/org/[githubLogin]/connections` | Canvas + connections doc list (existing URL preserved) |
| `/org/[githubLogin]/initiatives` | Initiatives table |
| `/org/[githubLogin]/workspaces` | Workspaces list |
| `/org/[githubLogin]/members` | Members grid |
| `/org/[githubLogin]/schematic` | Mermaid editor |
| `/org/[githubLogin]/graph` | GraphPortal |

Implementation: lift the layout into `src/app/org/[githubLogin]/layout.tsx` (server) which renders an `<OrgShell>` client component holding the rail, the persistent canvas mount, and the right panel slot. Each view becomes a route segment with its own `page.tsx`. The current `OrgPageContent.tsx` decomposes into one page per route. The existing `/connections/page.tsx` keeps its URL but now renders just the right-panel doc list (the canvas itself is in the layout).

Sub-canvas drilling (`?canvas=<ref>`) and the connection-viewer slug (`?c=<slug>`) are unchanged — they coexist with the new path-based view nav because they're different params.

## Right panel content

One file, two states, driven by canvas selection.

| State | Renders |
| ----- | ------- |
| No node selected | Existing `ConnectionsSidebar` body (the doc list — already reachable directly via `/connections` and as the right panel of the Canvas view too, so the user always has *something* there). |
| Node selected | A `NodeDetail` card. Title = node name. Below it, content per category (see next section). When the user clicks elsewhere on the canvas (or the close X), this collapses back to the Connections list. |

`NodeDetail` reads from two sources:
- The selected `CanvasNode` itself (always present in client memory — `system-canvas-react` exposes selection via its handle/event surface; we'll wire whichever event it actually emits in PR 3).
- For live nodes (id prefix `ws:` / `repo:` / `initiative:` / `milestone:` / `feature:` / `task:`), a small `GET /api/orgs/[githubLogin]/canvas/node/[liveId]` endpoint that returns the entity's `description` (and other already-public fields). Initiatives have a `description String?` (`prisma/schema.prisma:1524`); milestones have one too (`schema.prisma:1544`); workspaces, repositories, features, tasks all have `description`. None of this is sensitive — it's all stuff the user can already see in the entity's primary UI — but routing through one endpoint keeps the component dumb and lets us add a permission check in one place.

For author-created `note` and `decision` nodes, no fetch is needed — the body text is in the `CanvasNode` itself.

### What `NodeDetail` shows per category

| Category | Header | Body | Footer link |
| -------- | ------ | ---- | ----------- |
| `workspace` | Name + "WORKSPACE" eyebrow | `description` (or "No description set") | "Open workspace →" |
| `repository` | Name + "REPOSITORY" | `description` | "View on GitHub →" if a URL is recorded |
| `initiative` | Name + "INITIATIVE" + status badge | `description`, then stats line: `N/M milestones`, `Started …`, `Target …` | "Open in Initiatives →" (deep-links to `/org/[githubLogin]/initiatives` with the row expanded) |
| `milestone` | Name + "MILESTONE" + status badge | `description`, then `Due …`, `N/M features` | "Open in Initiatives →" |
| `feature` | Name + "FEATURE" + status badge | `brief` (truncated) | "Open feature →" (workspace plan page) |
| `task` | Name + "TASK" + status badge | `description` | "Open task →" |
| `note` | "NOTE" eyebrow | `node.text` (rendered as Markdown) | — |
| `decision` | "DECISION" eyebrow | `node.text` (rendered as Markdown) | — |

All of this is read-only in this PR. Editing a node's underlying entity from the panel is a follow-up.

## The Pusher bug, in detail

### What's broken today

`getPusherClient()` returns a process-singleton (`src/lib/pusher.ts:14-27`). `pusher.subscribe(name)` from `pusher-js` returns the *same* `Channel` instance for any given channel name across all callers. So when two components subscribe to `org-{githubLogin}`, they share a single `Channel` object and add their own `bind()`s to it.

`pusher.unsubscribe(name)` tears that shared `Channel` down — every binding on it, regardless of which component added it. After unsubscribe, the next `subscribe(name)` call creates a *new* `Channel` instance; old `bind()` references on the previous instance are dead.

Today, both `ConnectionsSidebar` (`ConnectionsSidebar.tsx:32-49`) and `OrgCanvasBackground` (`OrgCanvasBackground.tsx:576-651`) call:

```ts
const pusher = getPusherClient();
const channel = pusher.subscribe(channelName);
channel.bind(EVENT, handler);
return () => {
  channel.unbind(EVENT, handler);
  pusher.unsubscribe(channelName);  // ← destroys the shared channel
};
```

This would *only* be safe if each component's lifecycle were stable. It isn't:

- `ConnectionsPage` passes `handleConnectionCreated` (defined inline at `ConnectionsPage.tsx:165-167`) to `ConnectionsSidebar`. It's a fresh function on every render.
- `ConnectionsSidebar`'s subscription effect lists `onConnectionCreated` in its dep array (`ConnectionsSidebar.tsx:49`), so it re-runs on every parent render.
- `ConnectionsPage` re-renders 3+ times during initial load (workspaces fetch resolves, connections fetch resolves, `hiddenInitialized` flips to `true`, etc.).
- Each re-run executes the cleanup → `pusher.unsubscribe(channelName)` → destroys the channel `OrgCanvasBackground` is bound to. The next subscribe in the same render builds a new channel; `OrgCanvasBackground`'s effect doesn't re-run (its dep array is stable on `[githubLogin]`), so it never re-binds.

By the time the user is interacting, `OrgCanvasBackground`'s `CANVAS_UPDATED` handler is bound to a dead `Channel` instance and the canvas stops live-updating. Reproduces every page load.

### Why we can't just memoize the callback

Memoizing `handleConnectionCreated` with `useCallback` would stop the dep-array thrash and mask the symptom — but it leaves the underlying landmine in place. *Any* future component subscribing to the same channel becomes a footgun, and `pusher-js`'s shared-channel semantics are surprising enough that the next person will hit it again. We fix it properly: introduce a refcounted channel manager and route both subscriptions through it.

### The fix: a tiny refcounted channel hook

New file `src/hooks/usePusherChannel.ts`:

```ts
// Keyed by channel name. Each entry tracks how many React subscribers
// are currently using the channel so we only call pusher.unsubscribe
// when the last one unmounts. This is the contract pusher-js *should*
// expose but doesn't — its subscribe()/unsubscribe() are global per
// channel name, which makes them unsafe to call from individual
// component effects.
const refCounts = new Map<string, number>();

export function usePusherChannel(channelName: string | null): Channel | null {
  // Subscribe on mount, decrement on unmount. When count hits 0,
  // unsubscribe. Returns the live Channel instance (or null when
  // Pusher isn't configured / no channel name yet).
  // Implementation handles strict-mode double-mount via the refcount.
}
```

Then in `ConnectionsSidebar` and `OrgCanvasBackground`:

```ts
const channel = usePusherChannel(getOrgChannelName(githubLogin));
useEffect(() => {
  if (!channel) return;
  channel.bind(EVENT, handler);
  return () => channel.unbind(EVENT, handler);
}, [channel, /* stable deps only */]);
```

Per-component cleanup only `unbind()`s its own handler. Subscribe/unsubscribe lifecycle moves into the hook, gated by the refcount. Three call sites converted in this PR (the two above plus `HiddenLivePill` if it grows a Pusher binding — currently it doesn't, so leave it alone).

We also remove the unstable callback dep from `ConnectionsSidebar`'s effect — once subscribe/unsubscribe is the hook's job, the effect that binds `CONNECTION_UPDATED` only depends on the channel and the handler, both of which we keep stable via `useEvent`-style ref or `useCallback` on the parent. (Memoizing the parent callback is still good hygiene; the refcount is the real correctness fix.)

### Diagnostic logging

Keep the `pusher:subscription_succeeded` / `pusher:subscription_error` console logs already present at `OrgCanvasBackground.tsx:587-594`. Add matching ones to the hook so we can prove in the field that subscribe/unsubscribe pair correctly. Strip `CANVAS_UPDATED received` console at the same time — it's noisy in the working state.

### Tests

Unit (Vitest):
- `usePusherChannel` — mounting two components on the same name only calls `pusher.subscribe` once and `pusher.unsubscribe` after the *second* unmount. (Mock `getPusherClient`; assert call counts.)
- Strict-mode double-mount of a single consumer still ends with one live subscription.

Integration (`__tests__/integration/`): out of scope for a hook unit, but worth a Playwright smoke later that asserts the canvas refetches after a server-emitted `CANVAS_UPDATED`. Not in this PR.

## Implementation plan

One PR. Build order below is the sequence I'd write the diff in — each step compiles and is independently sane to commit if we want intermediate checkpoints — but it ships as a single PR.

### Step 1 — `usePusherChannel` hook + convert both call sites

The Pusher fix. Do this first because the rest of the PR adds another consumer of the same channel and we want the refcount in place before that lands.

- New: `src/hooks/usePusherChannel.ts` (~40 lines) with a module-level refcount map keyed by channel name. Subscribe on first mount, unsubscribe only when refcount returns to zero. Returns the live `Channel` instance (or `null` when Pusher isn't configured).
- Edit: `ConnectionsSidebar.tsx:32-49` — use the hook, remove the direct `pusher.unsubscribe(channelName)` from cleanup, drop `onConnectionCreated` from the effect dep array (effect now depends only on the stable channel).
- Edit: `OrgCanvasBackground.tsx:576-651` — same treatment. Keep the diagnostic `pusher:subscription_succeeded` / `pusher:subscription_error` logs.
- Edit: `ConnectionsPage.tsx:165-167` — wrap `handleConnectionCreated` in `useCallback` (defensive; the refcount is the real fix but a stable callback is good hygiene).

### Step 2 — Layout shell + route segments

Pure refactor, no behavior change visible yet.

- New: `src/app/org/[githubLogin]/layout.tsx` (server) — fetches the org once, passes id/name/githubLogin into the shell.
- New: `src/app/org/[githubLogin]/OrgShell.tsx` (client) — three-column structure: rail (placeholder text strip for now) / route slot / right panel slot.
- New route segments: `initiatives/page.tsx`, `workspaces/page.tsx`, `members/page.tsx`, `schematic/page.tsx`, `graph/page.tsx`. Each a thin wrapper around the existing component lifted out of `OrgPageContent.tsx`.
- Edit: `OrgPageContent.tsx` — becomes the Canvas route's page. Tabs UI removed.

### Step 3 — Persistent canvas in the layout

- Edit: `OrgShell.tsx` — mount `<OrgCanvasBackground>` once in the layout behind the route slot. Use `usePathname()` to drive visibility: visible on `/org/[login]` (Canvas) and `/org/[login]/connections`; hidden on the other five.
- Edit: Canvas page — empty body, canvas shows through from the layout. Keep the `OrgChat` overlay (same mount as today's `/connections`).
- Edit: `connections/page.tsx` — drop its own `<OrgCanvasBackground>` mount; rely on the layout.
- Preserve the `pointer-events:none` cascade from `ConnectionsPage.tsx:213-222` so canvas drag still works through the chat column.

### Step 4 — Icon-only left rail

- Edit: `OrgShell.tsx` — replace the placeholder rail with the icon strip. shadcn `<Tooltip>` for hover labels. Active item via `usePathname()`. Width ~56px, right border, sticky to viewport top.
- Icons (lucide): Canvas → `Network`, Connections → `Link2`, Initiatives → `Target`, Workspaces → `LayoutGrid`, Members → `Users`, Schematic → `GitBranch`, Graph → `Workflow`.

### Step 5 — Right panel + node detail + detail endpoint

- New: `src/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route.ts` — given `initiative:abc123` etc., validates the entity belongs to the org (same `sourceControlOrgId` guard as the projectors, e.g. `projectors.ts:171`), returns `{ kind, name, description, …category-specific fields }`.
- New: `src/app/org/[githubLogin]/_components/NodeDetail.tsx` — fetches from the endpoint for live nodes; renders the per-category content from the table above. For `note` / `decision` nodes, no fetch needed (body is in `node.text`).
- New: `src/app/org/[githubLogin]/_components/OrgRightPanel.tsx` — chooses between `NodeDetail` (when a node is selected) and the connections doc list (default).
- Refactor: `ConnectionsSidebar.tsx` — split into the route page chrome and a `ConnectionsListBody` that `OrgRightPanel` embeds. The Pusher binding moves into `ConnectionsListBody` and uses `usePusherChannel` from Step 1.
- Wire: surface `selectedNodeId` from `OrgCanvasBackground` (via the existing handle ref or a new `onSelectionChange` callback — confirm which the library exposes during implementation; if neither, wrap `onNodeClick` and track selection ourselves). Clicking empty canvas clears selection.

## Acceptance criteria (whole PR)

- Default URL `/org/[githubLogin]` renders the canvas. No "Connections" button click required.
- Left rail: seven icon-only buttons with tooltips, active state reflects current route.
- Clicking an initiative node on the canvas shows its `description` + milestone counts in the right panel; clicking empty canvas reverts to the connections doc list.
- Live-entity detail endpoint rejects cross-org id guesses with 404.
- Agent emits `CANVAS_UPDATED` (e.g. via `patch_canvas`) → canvas refreshes without a page reload, repeatable 5+ times in a session. Console shows exactly one `[OrgCanvasBackground] subscribed to org-…` per page load.
- Existing URLs keep working: `/org/[login]/connections` (now powered by the layout's canvas), sub-canvas `?canvas=<ref>`, connection viewer `?c=<slug>`.
- Tests:
  - Unit: `usePusherChannel` — two consumers on the same name produce one subscribe/one unsubscribe across the pair; strict-mode double-mount of one consumer survives with a live subscription.
  - Integration: `GET /api/orgs/[githubLogin]/canvas/node/[liveId]` happy path + cross-org guard, per category.

## Risks and mitigations

- **`system-canvas-react` selection API may not exist.** If the library doesn't emit a selection event, we fall back to wrapping `onNodeClick` and tracking selection in `OrgCanvasBackground`. Ten-line change. Worth a 15-minute spike before PR 5 to confirm.
- **Pointer-events cascade.** The Connections page comment at `ConnectionsPage.tsx:213-222` is load-bearing — the chat column is `pointer-events:none` so the canvas underneath stays draggable. After moving the canvas into the layout, the new wrapper around the route slot must preserve that. Easy to test (try to drag the canvas through the chat column).
- **`DashboardChat` requires `useWorkspace()`.** It's mounted today on a page that has no current workspace; the existing code defends against `slug` being undefined (`DashboardChat/index.tsx:45`). Keep that defense intact when the chat moves into the layout.
- **Strict-mode double-mount of `usePusherChannel`.** The refcount handles it — first mount goes 0 → 1, the strict-mode second mount goes 1 → 2 → 1, never to 0, so the channel survives. The unit test should explicitly cover this case.
- **Existing bookmarks.** `/org/[login]/connections` keeps working. No redirects needed. Other tab states were never URL-addressable (`activeTab` was a `useState`, not a router param), so there's nothing to migrate.

## Open question

- The existing `OrgChat` mount lives only on the Connections page today. With the canvas as the default view, do we want the chat overlay on the Canvas view too? Default answer: **yes** — the canvas is where you'd want to ask the agent things and the chat already adapts to org context (`OrgChat.tsx:1-20`). If we leave it off Canvas, users will wonder where the chat went when they land on the default URL. Worth a sanity check during PR 3.
