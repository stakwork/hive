# Canvas Sidebar Chat

Move the org-canvas chat from a bottom-anchored overlay into a third tab of the right sidebar, replace it with a purpose-built `SidebarChat` component, and lay groundwork for rich agent **artifacts** (live task/feature status, async deep-research, PR cards, canvas-change proposals, etc.) to be rendered inline in the chat.

Status: **proposed**.

## Goal

Today the org canvas page composes three layers (`OrgCanvasView.tsx:179-247`):

1. `OrgCanvasBackground` — full-bleed canvas (z-0).
2. A middle column rendering `OrgChat` → `DashboardChat` as a `pointer-events-none` overlay anchored to the bottom-right (z-20, with a `mr-80` so it leaves room for the right panel).
3. `OrgRightPanel` — a fixed `w-80` sidebar with two tabs: Details / Connections (z-20).

That overlay design is load-bearing for one specific UX trick: the user can drag/zoom the canvas through the empty space "behind" the chat, because every interactive widget inside `DashboardChat` re-enables pointer events on itself while the chat root stays `pointer-events-none` (`DashboardChat/index.tsx:775`). It works, but it's fragile — the comment at `OrgCanvasView.tsx:209-214` explicitly warns against wrapping the chat in `pointer-events-auto` because that would block clicks on the canvas FAB.

We're moving the chat out of that overlay and into the right sidebar as its own tab. The pointer-events gymnastics goes away (a real fixed-width container has clear bounds), the canvas gets the full left area to itself, and the chat lives next to the Details/Connections tabs the user already context-switches between.

We're **not** porting `DashboardChat` into the sidebar. Most of `DashboardChat`'s 917 lines are features that don't belong on the org canvas page: image upload/paste, multi-workspace pill management, provenance source trees, follow-up question bubbles, recent-chats popup, generate-plan + share + the `CreateFeatureModal` flow, read-only conversation loading, etc. The sidebar chat is a different product surface — it's the agent's home base on the canvas, not a workspace-question bar — and it should grow in a different direction (artifacts, see below). New component, fresh slate, reuses only the lower-level pieces (`ChatMessage`, `ToolCallIndicator`, `useStreamProcessor`).

The artifact system is the big long-term play. Today the agent can only reply with markdown text and tool calls. We want it to reply with **rich, interactive cards** — a live task status that updates as the task progresses, a PR list that refreshes via Pusher, a "propose canvas change" card the user can approve/reject, a deep-research handle that the user can fork-and-forget while continuing the conversation. Hive already has a Prisma `Artifact` model with 17 types (`schema.prisma:546-559, 1015-1033`) but it's currently scoped to task chat. This plan shapes the sidebar chat from day one to be the canvas-page artifact host, even though we ship it without artifacts in the first PR.

## Non-goals

- **Building any artifact type in the first PR.** The architecture seam is added but every artifact type beyond plain text/tool-call is deferred. First PR ships text + streaming + tool-call indicator only.
- **Touching `DashboardChat`.** It stays exactly as it is on `/w/[slug]/dashboard`. No shared hook extraction, no layout-neutral refactor — the two components will diverge.
- **A "recent chats" picker UI for browsing your own past auto-saves.** Auto-save happens silently (so a refresh-protection follow-up is cheap), but the sidebar doesn't surface a list of your past conversations. Recent-chats popup stays a `DashboardChat`-only feature for now. (Note: loading from a `?chat=<shareId>` link *does* work in PR 1 — see "Share & load" below. The non-goal is the Recent Chats *picker*, not loading itself.)
- **Resizable sidebar.** Width jumps from `w-80` (320px) to `w-96` (384px) statically. A drag handle is a follow-up.
- **Image upload / multi-workspace pills.** Out of scope; not appropriate for this surface.
- **Mobile / responsive behavior.** The org canvas is desktop-only.
- **Replacing the overlay chat on `/w/[slug]/dashboard`.** Different surface, different problem.

## The chrome we're building

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◢◣ stakwork  @stakwork  ↗                                              │
├──┬─────────────────────────────────────────────┬──────────────────────┤
│▣ │                                             │ Chat | Details | Conn│
│  │                                             ├──────────────────────┤
│⌬ │                                             │ ┌──────────────────┐ │
│  │                                             │ │ Agent message    │ │
│✦ │            SYSTEM CANVAS                    │ └──────────────────┘ │
│  │            (full-bleed)                     │ ┌──────────────────┐ │
│⊞ │                                             │ │ ▶ Reading canvas │ │
│  │                                             │ └──────────────────┘ │
│♟ │                                             │ ┌──────────────────┐ │
│  │                                             │ │ [PR #142 card]   │ │
│↯ │                                             │ └──────────────────┘ │
│  │                                             │      …               │
│⤳ │                                             │ ┌──────────────────┐ │
│  │                                             │ │ Ask the agent…   │ │
│  │                                             │ └──────────────────┘ │
└──┴─────────────────────────────────────────────┴──────────────────────┘
```

- **Left rail** — unchanged from today.
- **Center column** — `OrgCanvasBackground` only. No chat overlay layer. `rightInset` widens from `320` → `384` to match the new sidebar width.
- **Right sidebar** — three tabs:
  - **Chat** *(default landing tab; new)* — `<SidebarChat />`.
  - **Details** *(unchanged)* — auto-opens when the user clicks a canvas node.
  - **Connections** *(unchanged)* — connection-doc list.
  - Tabs are panel-local state. Auto-flip rule: clicking a node flips to **Details**; the user can flip back to Chat or Connections manually until the next selection change. The default-on-mount tab becomes Chat (was Connections).

## Routing

Unchanged. This is a chrome change inside the existing `/org/[githubLogin]` route. `?canvas=<ref>` and `?c=<slug>` deep links continue to work.

## Files changed

| File | Change |
| ---- | ------ |
| `src/app/org/[githubLogin]/_components/SidebarChat.tsx` | **New.** ~220 lines. The sidebar chat component (incl. inline `SidebarChatInput` and Share/Clear header). |
| `src/app/org/[githubLogin]/_components/OrgRightPanel.tsx` | Add `Tab = "chat" \| "details" \| "connections"`. Default tab `"chat"`. New chat tab button (leftmost). New chat tab body renders `<SidebarChat />`. Container width `w-80` → `w-96`. |
| `src/app/org/[githubLogin]/_components/OrgCanvasView.tsx` | Delete the entire middle z-20 chat overlay column (lines `~195-232`). Add `?chat=<shareId>` preload effect. Pass chat-related props (`orgId`, `chatWorkspaceSlugs`, `currentCanvasRef`, `currentCanvasBreadcrumb`, `selectedNodeId`, `chatReady`, `chatInitialMessages`) into `<OrgRightPanel />`. Update `<OrgCanvasBackground rightInset={384} />`. |
| `src/app/org/[githubLogin]/OrgChat.tsx` | **Delete.** Single-callsite wrapper around `DashboardChat`; no longer used. |
| `src/app/org/[githubLogin]/CANVAS.md` | Update line 14's "three-layer composition" description to reflect the new two-layer model (canvas + tabbed right panel) and document the chat tab + the `?chat=<shareId>` deep link. |
| `src/app/api/ask/quick/route.ts` | Add `skipEnrichments` body flag; short-circuit the `after()` block when set. ~3 lines. |
| `src/app/api/org/[githubLogin]/chat/shared/[shareId]/route.ts` | **New.** GET endpoint: reads `SharedConversation` by id, returns `{ messages, title }` after auth check (mirrors the existing `/api/workspaces/[slug]/chat/shared/[shareId]/route.ts`). ~50 lines. |

No DB migrations. The existing `SharedConversation` model and the existing `POST /api/org/[githubLogin]/chat/share` endpoint are reused as-is.

## `SidebarChat` — the new component

Lives at `src/app/org/[githubLogin]/_components/SidebarChat.tsx`. Scoped to the org canvas page; not a general-purpose chat.

### Props

```ts
interface SidebarChatProps {
  /** Slug of the org (the `[githubLogin]` route param). */
  githubLogin: string;
  /** Canvas org id, used to scope agent tool calls and auto-save. */
  orgId: string;
  /**
   * Workspace slugs the agent should be allowed to read from. Derived
   * by `OrgCanvasView` from the (non-hidden) workspaces on the canvas
   * — same value that `OrgChat` receives today as
   * `defaultExtraWorkspaceSlugs`. The user cannot edit this from the
   * sidebar; hidden state is controlled by the canvas's `HiddenLivePill`.
   */
  workspaceSlugs: string[];
  /**
   * Current canvas scope (`""` for root, `"initiative:<id>"` /
   * `"ws:<id>"` for sub-canvases). Threaded into `/api/ask/quick` so
   * tool calls default to the right ref.
   */
  currentCanvasRef: string;
  /** Human-readable breadcrumb for the current scope. */
  currentCanvasBreadcrumb: string;
  /** Selected canvas node id, or null. Lets the agent resolve "this". */
  selectedNodeId: string | null;
  /**
   * Optional preloaded message history (e.g. from a `?chat=<shareId>`
   * deep link). When set, used as the initial value of `messages`.
   * No "loaded from share" tracking — the user just continues from
   * here; auto-save creates a fresh `isShared: false` `SharedConversation`
   * row on their first message.
   */
  initialMessages?: SidebarMessage[];
}
```

### Layout (root → leaves)

```
<div className="flex h-full flex-col min-h-0">
  {/* Header: agent label + Share + Clear. ~36px tall. */}
  <div className="flex items-center justify-between px-3 py-2 border-b">
    <span className="text-xs font-medium text-muted-foreground">Agent</span>
    <div className="flex items-center gap-1">
      <button onClick={handleShare} disabled={!hasMessages} title="Share">
        <Share2 className="w-4 h-4" />
      </button>
      <button onClick={handleClear} disabled={!hasMessages} title="Clear">
        <X className="w-4 h-4" />
      </button>
    </div>
  </div>

  {/* Message list — flex-1 min-h-0 overflow-y-auto. */}
  <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
    {messages.map((m) => <ChatMessage key={m.id} message={m} ... />)}
    {activeToolCalls.length > 0 && <ToolCallIndicator toolCalls={activeToolCalls} />}
    <div ref={endRef} />
  </div>

  {/* Input — pinned at bottom. */}
  <div className="border-t p-2">
    <SidebarChatInput onSend={handleSend} disabled={isLoading} />
  </div>
</div>
```

No `pointer-events-none` anywhere. No `max-h-[85vh]`. No provenance sidebar. No workspace pills. No image upload. No `pointer-events-auto` re-enables on individual children.

### Reused dependencies

- `ChatMessage` from `@/components/dashboard/DashboardChat/ChatMessage` — drop-in. Note: it has internal `flex justify-center w-full` and bubbles `max-w-[600px]`. In a 384px sidebar that means bubbles fill the column with some side padding from the parent. Verify visually in PR; if the centering looks weird, fork `ChatMessage` into a `SidebarChatMessage` (cheap, ~60 lines).
- `ToolCallIndicator` from same — drop-in, same caveat.
- `useStreamProcessor` from `@/lib/streaming` — same usage pattern as `DashboardChat`.
- `useWorkspace`, `useSession` — same as `DashboardChat`. The auto-save endpoint is keyed on the *current workspace* `slug` (not org), matching `DashboardChat`'s behavior.

### New: `SidebarChatInput`

Inline in the same file (or a sibling — judgment call). ~50 lines. A `<textarea>` (`rows={1}`, auto-grow up to 6 rows max, `resize-none`), Enter-to-send (Shift+Enter for newline), a small "send" icon button. **No** image attach, **no** workspace pills, **no** "+ workspace" button. Mirrors the visual style of `DashboardChat/ChatInput.tsx` but is its own file because the prop surface is too divergent to share without ugly conditionals.

### State

Mirrors `DashboardChat`'s relevant state, minus the dropped features:

```ts
const [messages, setMessages] = useState<SidebarMessage[]>(initialMessages ?? []);
const [isLoading, setIsLoading] = useState(false);
const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
const conversationIdRef = useRef<string | null>(null);
const hasReceivedContentRef = useRef(false);
const endRef = useRef<HTMLDivElement>(null);
const assistantMsgsRef = useRef<SidebarMessage[]>([]);
const { processStream } = useStreamProcessor();
```

Dropped: `isReadOnly`, `followUpQuestions`, `provenanceData`, `isProvenanceSidebarOpen`, `extraWorkspaceSlugs`, `showFeatureModal`, `extractedData`, `isExtracting`, `extractError`, `isLaunching`, `currentImageData`.

`SidebarMessage` is the same shape as `DashboardChat`'s `Message` minus `imageData`, plus an optional `artifacts?: unknown[]` field for forward-compat (see "Long-term: rich artifacts" below):

```ts
interface SidebarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  artifacts?: unknown[];  // typed when first artifact ships; PR 1 just passes through
}
```

### `handleSend`

Copy from `DashboardChat.handleSend` (`DashboardChat/index.tsx:168-466`), strip:

- Image-message branching (lines 178-204) — collapse to the simple "create new user message" path.
- The conditional `workspaceSlug` vs `workspaceSlugs` (lines 302-304) — always send `workspaceSlugs: [slug, ...workspaceSlugs].filter(Boolean)` when `workspaceSlugs.length > 0`, else `workspaceSlug: slug`.
- Read-only guard (line 170) — drop.
- The follow-up / provenance state resets (lines 173-175) — drop.

Add: `skipEnrichments: true` to the request body (see "Skipping enrichments" below) so the server doesn't waste tokens computing follow-ups + provenance for a surface that doesn't render them.

Keep:

- The full timeline → `Message[]` reduction (lines 327-441) — that's how streaming + tool calls get rendered. Identical logic.
- The auto-save calls (`autoSaveCreate` / `autoSaveAppend`) at lines 138-166 / 211-217 / 458-462. Use `source: "org-canvas"` instead of `"dashboard"` so we can distinguish in the conversations API later. The endpoint accepts arbitrary strings (`conversations/route.ts:256` does `source: body.source || null` — no enum check) ✓.
- The console-log gate at lines 371-388 (already keyed on `/^\/org\/[^/]+$/`); it'll continue to work and remains useful while bringing this up.
- Canvas-scope hint passthrough at lines 305-316 (`orgId`, `currentCanvasRef`, `currentCanvasBreadcrumb`, `selectedNodeId`).

### `handleClear`

```ts
const handleClear = () => {
  setMessages([]);
  conversationIdRef.current = null;
  assistantMsgsRef.current = [];
  setActiveToolCalls([]);
};
```

### Auto-scroll

```ts
useEffect(() => {
  endRef.current?.scrollIntoView({ behavior: "smooth" });
}, [messages, activeToolCalls]);
```

Same as `DashboardChat`. Note: `scrollIntoView` on the inner anchor will scroll the *page* if the chat container isn't the nearest scrollable ancestor. Test in the sidebar (the `flex-1 min-h-0 overflow-y-auto` ancestor should make it the right one); if it bubbles, switch to `scrollTop = scrollHeight` on `scrollRef.current`.

### What's intentionally missing in PR 1

- **No "Sources" toggle / provenance UI.** The server doesn't even compute provenance for this surface (see "Skipping enrichments" below) so there's nothing to render.
- **No follow-up questions bubbles.** Same — server skips them for the sidebar.
- **No "Generate Plan" / "+ workspace" / image upload / Recent Chats popup.** Drop entirely.
- **No read-only mode.** Loading a shared conversation produces an editable, fork-able conversation (see "Share & load" below) — not a read-only viewer.

### Skipping enrichments — `skipEnrichments` flag

The sidebar chat doesn't render follow-up questions or provenance, so we shouldn't pay to compute them. The current `/api/ask/quick` route does both in an `after()` block (`src/app/api/ask/quick/route.ts:250-314`) regardless of the calling surface — burning tokens on a `generateObject` call to invent follow-ups, and hitting `${swarmUrl}/gitree/provenance` for any concept the agent learned, even when no client is listening.

Add a body flag `skipEnrichments: boolean` (default `false`):

```diff
 const {
   messages,
   workspaceSlug,
   workspaceSlugs,
   orgId,
   currentCanvasRef,
   currentCanvasBreadcrumb,
   selectedNodeId,
+  skipEnrichments,
 } = body;
```

Then short-circuit the `after()` block:

```diff
 after(async () => {
+  if (skipEnrichments) return;
   // Generate follow-up questions
   …
 });
```

`SidebarChat` always sends `skipEnrichments: true`. `DashboardChat` doesn't send the flag (so undefined → false → existing behavior preserved). One flag, two lines of server code, zero risk to the dashboard surface.

Why one flag instead of `skipFollowUps` + `skipProvenance` separately? Because there's no surface that wants exactly one of them — it's all-or-nothing per UI. If that ever changes, splitting the flag is a cheap follow-up.

### Share & load — fork-the-conversation

Two-way: every chat can be **shared** (produces a URL); opening that URL **preloads** the messages into a fresh conversation that the new user can immediately continue. No read-only viewer, no shared session — each loader gets their own forked conversation. The CEO shares `?chat=<shareId>` in Slack; three devs click it; each ends up in their own continuable conversation, seeded with the same prefix.

#### Two write paths, one table

Heads-up before reading the next bits: today's chat persistence is **one Prisma model — `SharedConversation` (`schema.prisma:492-515`, table `shared_conversations`) — with two write paths distinguished by an `isShared` boolean.** Both already exist; both are reused as-is.

| | Auto-save (`isShared: false`) | Share button (`isShared: true`) |
|---|---|---|
| Trigger | Silently on every message | Explicit button click |
| Endpoint (workspace) | `POST /api/workspaces/[slug]/chat/conversations` (create) + `PUT /api/workspaces/[slug]/chat/conversations/[conversationId]` (append) | `POST /api/workspaces/[slug]/chat/share` |
| Endpoint (org) | *(reuses workspace endpoint, keyed on the user's current workspace `slug`)* | `POST /api/org/[githubLogin]/chat/share` |
| Visibility | Private to the author | Anyone with org access can read |
| After creation | Updated in place (PUT appends each new message) | Frozen snapshot — never updated |
| Surfaces back into UI? | Yes, via `RecentChatsPopup` (in `DashboardChat` only — sidebar chat doesn't surface it in PR 1) | Yes, via the `?chat=<shareId>` URL preload |

Auto-save is `DashboardChat`'s existing fire-and-forget refresh-protection (`DashboardChat/index.tsx:138-166`). `SidebarChat` inherits it unchanged. **There is no Save button.** Saving happens silently on every message, full stop.

Share is new behavior at the UX level (the endpoint exists; the button surface on the canvas page is new). It snapshots `messages` into a fresh `SharedConversation` row at click time, returns a `shareId`, and we paste a forking URL onto the user's clipboard.

The two paths don't talk to each other. A user's auto-save row and any share rows they've created are independent records pointing at different snapshots in time. That independence is what makes forking trivial:

1. CEO chats. Each message → silent PUT to CEO's `isShared: false` row (id `auto-A`).
2. CEO clicks Share. → fresh `isShared: true` row created (id `share-X`), messages frozen at click time. URL `?chat=share-X` copied to clipboard.
3. Three devs open `?chat=share-X`. Page fetches `share-X`'s messages, seeds each `SidebarChat` with them. Each dev's `conversationIdRef` is **null**.
4. Each dev sends their first message. Each one's silent auto-save sees `null` → creates a fresh `isShared: false` row (`auto-B`, `auto-C`, `auto-D`), private to each dev, containing the preloaded messages + their new one.
5. Result: one `share-X` (frozen, public), four private `auto-*` rows (CEO's plus three devs'). Nothing knows about anything else; the fork semantics emerge from each user's auto-save starting fresh.

#### Share button

Reuse the existing endpoint `POST /api/org/[githubLogin]/chat/share` (`src/app/api/org/[githubLogin]/chat/share/route.ts`). It already creates a `SharedConversation` row and returns `{ shareId, url }`. We bypass the existing `url` (which points at the standalone viewer page `/org/[githubLogin]/chat/shared/[shareId]`) and use our own URL shape:

```
/org/[githubLogin]?chat=<shareId>
```

Same param family as the existing `?canvas=<ref>` and `?c=<slug>` deep links. They coexist.

The share button lives in the sidebar header (small icon button next to Clear). On click:

```ts
const handleShare = async () => {
  const res = await fetch(`/api/org/${githubLogin}/chat/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      title: deriveTitleFromFirstUserMessage(messages),
      followUpQuestions: [],   // required by the endpoint; we don't have any
      provenanceData: null,
      source: "org-canvas",
    }),
  });
  const { shareId } = await res.json();
  const url = `${window.location.origin}/org/${githubLogin}?chat=${shareId}`;
  await navigator.clipboard.writeText(url);
  toast.success("Share link copied");
};
```

The endpoint requires `followUpQuestions` to be present (`share/route.ts:86-91`); pass `[]` (passes the falsy guard since `[]` is truthy in JS). Don't bother sending `provenanceData`. Set `source: "org-canvas"` so we can tell forks-from-canvas apart from forks-from-dashboard later — `share/route.ts:106` does `source: body.source || null` and accepts arbitrary strings ✓.

#### Load

When `OrgCanvasView` mounts and detects `?chat=<shareId>`, it fetches the shared row server-side (or via a small client `useEffect`) and hands the messages array to `<SidebarChat initialMessages={...} />`. `SidebarChat` accepts an optional `initialMessages?: SidebarMessage[]` prop; when present, it seeds `useState(initialMessages)` and that's it. **No tracking of the source `shareId`, no read-only flag, no special mode.** The user sends their next message and the existing auto-save logic creates a fresh `isShared: false` row for them. Each loader gets a different `conversationIdRef` because each is a fresh auto-save chain seeded with preloaded context. CEO shared one; three devs each got their own private auto-save row when they typed their first message. Done.

Implementation:

```tsx
// In OrgCanvasView:
const [initialMessages, setInitialMessages] = useState<SidebarMessage[] | null>(null);
const [chatLoadComplete, setChatLoadComplete] = useState(false);
const sharedChatId = searchParams.get("chat");

useEffect(() => {
  if (!sharedChatId) {
    setChatLoadComplete(true);
    return;
  }
  fetch(`/api/org/${githubLogin}/chat/shared/${sharedChatId}`)
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      if (data?.messages) setInitialMessages(data.messages);
    })
    .catch(() => {})
    .finally(() => setChatLoadComplete(true));
}, [sharedChatId, githubLogin]);
```

Pass `initialMessages` through `<OrgRightPanel chatInitialMessages={initialMessages} />` → `<SidebarChat initialMessages={initialMessages ?? undefined} />`. Pass `chatReady = !loadingWorkspaces && hiddenInitialized && chatLoadComplete` so we don't mount with a half-loaded preload.

After preload, optionally clear `?chat` from the URL so a refresh doesn't re-seed the same forked starting point on top of any new messages the user has already sent. Use `router.replace(pathname, { scroll: false })` after the messages are seeded; or leave it (small UX call — leaving means the user can re-fork from scratch by reloading, which is arguably useful).

#### New endpoint: `GET /api/org/[githubLogin]/chat/shared/[shareId]`

Doesn't exist yet (only the workspace-scoped variant at `/api/workspaces/[slug]/chat/shared/[shareId]/route.ts` does). Mirror that file in the org-scoped path. The standalone viewer page at `src/app/org/[githubLogin]/chat/shared/[shareId]/page.tsx` already calls `db.sharedConversation.findUnique` directly server-side (it's a Server Component); extract that into a client-callable GET route. ~40 lines.

Auth: same check as the share POST — verify the caller has a `SourceControlToken` for the org (`route.ts:66-75`). Return only the fields `SidebarChat` needs (`messages`, `title`).

#### Existing standalone viewer page

`src/app/org/[githubLogin]/chat/shared/[shareId]/page.tsx` — keep it. It's the read-only "see what was shared without joining the canvas" view, useful for stakeholders who don't want to engage. Anyone landing on the new `?chat=<shareId>` URL gets the live forkable canvas; anyone landing on `/chat/shared/<shareId>` gets the read-only viewer. Two surfaces, two URL shapes, both useful. The Share button copies the *forking* URL by default; a "Copy view-only link" affordance can come later if needed.

#### What `SidebarChat` needs

- New prop: `initialMessages?: SidebarMessage[]`. Used as the initial value of `useState(messages)`. Don't track an "originated from share" flag; there's nothing to do with it.
- Existing auto-save logic doesn't change — `conversationIdRef` starts null, the first user message POSTs to `/api/workspaces/{slug}/chat/conversations` (creating a fresh `isShared: false` `SharedConversation` row with the full message array). Every subsequent message PUTs to `[conversationId]` with **only the new delta** — the server reads the existing `messages` JSON array, concatenates, writes the merged array back (`route.ts:184-186`). One row per conversation, updated repeatedly; PUT bodies stay small. Don't re-upload the full message array on each PUT; the server expects a delta. Each forker ends up with their own private row.
- Share button in the header (one icon, `Share2` from lucide). Wire to `handleShare` above.

## Right panel changes — `OrgRightPanel.tsx`

Three tabs instead of two. Wider container.

### Diff sketch

```diff
-type Tab = "details" | "connections";
+type Tab = "chat" | "details" | "connections";

 interface OrgRightPanelProps {
   githubLogin: string;
+  orgId: string;
   selectedNode: CanvasNode | null;
+  // Chat tab inputs — passed straight to <SidebarChat />.
+  chatWorkspaceSlugs: string[];
+  currentCanvasRef: string;
+  currentCanvasBreadcrumb: string;
+  /** True once workspaces + initial hidden list have loaded AND the
+   * optional `?chat=<shareId>` preload has resolved (success or fail).
+   * While false, the chat tab renders a spinner. */
+  chatReady: boolean;
+  /** Preloaded messages from a `?chat=<shareId>` deep link, or undefined. */
+  chatInitialMessages?: SidebarMessage[];
   connections: ConnectionData[];
   activeConnectionId: string | null;
   onConnectionClick: (connection: ConnectionData) => void;
   onConnectionCreated: () => void;
   onConnectionDeleted: (connectionId: string) => void;
   isLoading: boolean;
 }

-  const [tab, setTab] = useState<Tab>("connections");
+  const [tab, setTab] = useState<Tab>("chat");
   useEffect(() => {
     if (selectedNode) setTab("details");
   }, [selectedNode]);

   return (
-    <div className="fixed right-0 top-0 bottom-0 w-80 border-l bg-background flex flex-col">
+    <div className="fixed right-0 top-0 bottom-0 w-96 border-l bg-background flex flex-col">
       <div className="flex items-stretch border-b text-sm">
+        <TabButton label="Chat" isActive={tab === "chat"} onClick={() => setTab("chat")} />
         <TabButton label="Details" isActive={tab === "details"} ... />
         <TabButton label="Connections" isActive={tab === "connections"} ... />
       </div>
       <div className="flex-1 min-h-0">
+        {tab === "chat" ? (
+          chatReady ? (
+            <SidebarChat
+              githubLogin={githubLogin}
+              orgId={orgId}
+              workspaceSlugs={chatWorkspaceSlugs}
+              currentCanvasRef={currentCanvasRef}
+              currentCanvasBreadcrumb={currentCanvasBreadcrumb}
+              selectedNodeId={selectedNode?.id ?? null}
+              initialMessages={chatInitialMessages}
+            />
+          ) : (
+            <ChatLoadingState />
+          )
+        ) : tab === "details" ? (
           selectedNode ? <NodeDetail .../> : <EmptyDetailsHint />
         ) : (
           <ConnectionsListBody .../>
         )}
       </div>
     </div>
   );
```

### Why a `chatReady` gate

`OrgCanvasView` already guards the chat overlay on `loadingWorkspaces || !hiddenInitialized` (`OrgCanvasView.tsx:200-207`). The gate matters: `SidebarChat`'s `workspaceSlugs` prop drives which workspaces the agent reads from, and the comment at `CANVAS.md:29` documents that the chat must not mount before the hidden list is initialized — otherwise the agent runs against the full workspace list before the user's hidden filter arrives. We preserve that gate, plus a third clause for the optional share preload: `chatReady = !loadingWorkspaces && hiddenInitialized && chatLoadComplete`. Computed in `OrgCanvasView` and passed through.

### Tab order rationale

`Chat | Details | Connections`, left to right. Chat first because it's the default landing tab. Details second because it's the one that auto-opens on selection (closest to the cause). Connections last (was previously the default; demoted because chat is more important on this surface).

## Canvas view changes — `OrgCanvasView.tsx`

### Delete

Remove lines `~190-232` — the entire middle z-20 chat overlay column, including the `loadingWorkspaces || !hiddenInitialized` spinner branch and the `workspaces.length === 0` empty-state branch. Remove the `OrgChat` import.

### Replace

```tsx
return (
  <div className="relative flex h-full w-full overflow-hidden">
    <OrgCanvasBackground
      githubLogin={githubLogin}
-     rightInset={320}
+     rightInset={384}
      orgName={orgName}
      onHiddenChange={handleHiddenChange}
      onNodeSelect={handleNodeSelect}
      onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
    />

    {activeConnection && (
      <div className="absolute inset-0 bg-background z-10" aria-hidden />
    )}

    {activeConnection && (
-     /* connection viewer column moves out of the chat container into its own layer */
+     <div className="relative z-20 flex flex-1 mr-96 flex-col h-full">
+       <ConnectionViewer connection={activeConnection} onBack={handleBack} />
+     </div>
    )}

    <div className="relative z-20">
      <OrgRightPanel
        githubLogin={githubLogin}
+       orgId={orgId}
        selectedNode={selectedNode}
+       chatWorkspaceSlugs={chatWorkspaceSlugs}
+       currentCanvasRef={searchParams.get("canvas") ?? ""}
+       currentCanvasBreadcrumb={currentCanvasBreadcrumb}
+       chatReady={!loadingWorkspaces && hiddenInitialized && chatLoadComplete}
+       chatInitialMessages={chatInitialMessages ?? undefined}
        connections={connections}
        activeConnectionId={activeConnection?.id ?? null}
        onConnectionClick={handleConnectionClick}
        onConnectionCreated={handleConnectionCreated}
        onConnectionDeleted={handleConnectionDeleted}
        isLoading={loadingConnections}
      />
    </div>
  </div>
);
```

The `mr-80` on the chat column becomes `mr-96` on the connection-viewer column. The `pointer-events-none` wrapper that used to wrap the chat is gone — `ConnectionViewer` was already getting `pointer-events-auto` reapplied as an inner div, so collapsing one layer of nesting is fine.

### Add: `?chat=<shareId>` preload effect

```tsx
const sharedChatId = searchParams.get("chat");
const [chatInitialMessages, setChatInitialMessages] = useState<SidebarMessage[] | null>(null);
const [chatLoadComplete, setChatLoadComplete] = useState(false);

useEffect(() => {
  if (!sharedChatId) {
    setChatLoadComplete(true);
    return;
  }
  let cancelled = false;
  fetch(`/api/org/${githubLogin}/chat/shared/${sharedChatId}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (cancelled) return;
      if (data?.messages) setChatInitialMessages(data.messages);
    })
    .catch(() => {})
    .finally(() => {
      if (!cancelled) setChatLoadComplete(true);
    });
  return () => { cancelled = true; };
}, [sharedChatId, githubLogin]);
```

Mount-only effect (deps stable). On failure, falls through to an empty conversation — failure of a share link shouldn't gate chat usability.

### Keep

- All workspace / hidden / connection state and effects.
- `currentCanvasBreadcrumb` plumbing.
- `setUrlSlug`, `handleConnectionClick`, `handleBack`, `handleConnectionCreated`, `handleConnectionDeleted`, `handleNodeSelect`, `handleCanvasBreadcrumbChange`, `handleHiddenChange` — all unchanged.
- `chatWorkspaceSlugs` memo (`OrgCanvasView.tsx:106-112`) — still needed; it now feeds the panel instead of the overlay.

## Delete — `OrgChat.tsx`

`src/app/org/[githubLogin]/OrgChat.tsx` is a 48-line wrapper around `DashboardChat`. After PR 1 it has zero callers. Delete the file.

Confirm with `rg "OrgChat"` before deleting; only `OrgCanvasView` references it today.

## `CANVAS.md` update

Line 14 currently reads:

> `src/app/org/[githubLogin]/page.tsx` + `_components/OrgCanvasView.tsx` — default route. `OrgCanvasView` is the three-layer composition: canvas in the back (`OrgCanvasBackground`), `OrgChat` overlay column (pointer-events-none so the canvas stays draggable through it), and a fixed-width right panel (`OrgRightPanel`) with Details / Connections tabs.

Replace with:

> `src/app/org/[githubLogin]/page.tsx` + `_components/OrgCanvasView.tsx` — default route. `OrgCanvasView` is the two-layer composition: full-bleed canvas (`OrgCanvasBackground`) on the left, fixed-width right panel (`OrgRightPanel`) on the right with three tabs — **Chat** (`SidebarChat`, the default landing tab), **Details**, and **Connections**.

Also update line 30's "Right panel is tabbed" gotcha to mention the third tab and the new auto-flip rule (chat is the default; details auto-opens on node click; manual tab clicks override until next selection).

## Tests

Light. The first PR is mostly chrome.

### Unit (Vitest, `src/__tests__/unit/`)

- `SidebarChat.test.tsx`:
  - Renders empty state when `messages` is empty.
  - Renders preloaded messages when `initialMessages` is provided.
  - Sends a message via the input, fires `fetch("/api/ask/quick")` with the right body shape (`workspaceSlugs`, `orgId`, `currentCanvasRef`, `skipEnrichments: true`).
  - Renders streamed assistant messages.
  - Tool-call indicator appears when the stream emits a tool call without trailing text.
  - Clear button resets state.
  - Share button POSTs to `/api/org/.../chat/share` with `messages` + empty `followUpQuestions`, and copies the `?chat=<shareId>` URL to the clipboard.
  - When `initialMessages` is set and the user sends a message, auto-save POSTs (creating a fresh `isShared: false` row) rather than PUTting. No `conversationIdRef` carryover from the share source.
  - Mock `/api/workspaces/.../chat/conversations` to assert auto-save fires once on first message and PUTs on subsequent.
- `OrgRightPanel.test.tsx` (extend existing if present, else new):
  - Default tab is Chat.
  - Clicking a node flips to Details.
  - Manual tab click overrides auto-flip until next selection change.
  - Chat tab body shows spinner when `chatReady=false`.

Mock the `DashboardChat`-style children (`ChatMessage`, `ToolCallIndicator`, `useStreamProcessor`) the same way `DashboardChat.test.tsx:43-80` does.

### Integration

Out of scope. The existing canvas integration tests don't cover the chat overlay; we'll add Playwright coverage for the sidebar chat in a follow-up.

## Implementation plan

One PR. Build order is the sequence the agent should write the diff in; each step compiles and is independently sane to commit if we want intermediate checkpoints, but it ships as one PR.

### Step 1 — Backend: `skipEnrichments` flag + share GET endpoint

Backend first because the frontend depends on both.

- Edit `src/app/api/ask/quick/route.ts` lines 250-314: read `skipEnrichments` from `body`; early-`return` from the `after()` callback when truthy. Three-line change.
- New `src/app/api/org/[githubLogin]/chat/shared/[shareId]/route.ts`: GET handler that fetches `SharedConversation` by id, verifies the caller has a `SourceControlToken` for the org (mirror lines 66-75 of the share POST), returns `{ messages, title }`. ~50 lines, drop-in copy of the workspace-scoped variant at `src/app/api/workspaces/[slug]/chat/shared/[shareId]/route.ts` adapted to the org scope.

### Step 2 — Build `SidebarChat` in isolation

- New: `src/app/org/[githubLogin]/_components/SidebarChat.tsx`. Adapt `handleSend` from `DashboardChat/index.tsx:168-466` per the strip list above. Add `skipEnrichments: true` to the request body. Inline `SidebarChatInput`. Wire `initialMessages` prop. Implement `handleShare` (POST to `/api/org/${githubLogin}/chat/share`, copy `?chat=<shareId>` URL).
- Don't wire it up yet. At this point you can drop it into a Storybook page or temporarily render it in `OrgCanvasView` next to the existing chat to verify it works.

### Step 3 — Wire it into `OrgRightPanel`

- Add `Tab = "chat" | ...`, default `"chat"`, third `TabButton`.
- New props (`orgId`, `chatWorkspaceSlugs`, `currentCanvasRef`, `currentCanvasBreadcrumb`, `chatReady`, `chatInitialMessages`).
- Render `<SidebarChat />` in the chat tab body, gated on `chatReady`. Pass `initialMessages={chatInitialMessages}`.
- Width: `w-80` → `w-96`.

### Step 4 — Update `OrgCanvasView`

- Add the `?chat=<shareId>` preload effect (see "Add: `?chat=<shareId>` preload effect" above).
- Pass new props into `<OrgRightPanel />` (including `chatInitialMessages` and `chatLoadComplete`-aware `chatReady`).
- `rightInset={320}` → `rightInset={384}`.
- Delete the middle z-20 chat overlay column.
- Move the `<ConnectionViewer />` branch to its own z-20 layer with `mr-96` (it used to live inside the chat column).
- Remove the `OrgChat` import.

### Step 5 — Cleanup

- Delete `src/app/org/[githubLogin]/OrgChat.tsx`.
- Update `CANVAS.md` lines 14 and 30 (mention the chat tab and the `?chat=<shareId>` deep link).
- Run `npm run lint` + `npx tsc --noEmit` + `npm run test:unit` and fix any fallout.

### Step 6 — Manual QA

On `/org/[githubLogin]`:

- Sidebar opens with Chat tab active, empty.
- Send a message; streams response, tool-call indicator appears for `read_canvas` etc.
- Server logs show no follow-up generation and no provenance fetch (verify via console — those were chatty logs at lines 294 / 309 of the route).
- Click a canvas node — tab flips to Details. Switch back to Chat manually; conversation is preserved.
- Click the canvas; verify drag/zoom works with no obstruction.
- Drill into a sub-canvas via `?canvas=<ref>` — `currentCanvasRef` updates and the agent's next reply uses the right scope.
- Drill into an initiative; verify hidden-workspace filter still applies.
- **Share flow:** Send a few messages. Click Share. URL `/org/<login>?chat=<shareId>` is copied. Open it in a new tab (or as a different user that has org access).
- **Load flow:** New tab loads with the prior conversation visible in the sidebar. Send a new message — verify it appends and auto-saves to a *new* `isShared: false` row (different id than the source `share-X`; the source is untouched).
- **Fork test:** Open the same share URL in three different browser windows (or three users). Each sends a different next message. Verify three separate `isShared: false` rows exist in `shared_conversations` table, all seeded from the same starting point, plus the original `isShared: true` snapshot row, plus the original author's own auto-save row. Five rows total. Nothing references anything else.

## Long-term: rich artifacts

This is the "why we're not just porting `DashboardChat`" answer. The sidebar chat is the canvas-page agent's home, and we want it to render **rich artifacts** alongside text. Below is the architecture seam we add in PR 1 (even though no artifact types ship in PR 1) and a sketch of the first four artifact types we'd build.

### Why this matters

The agent's current vocabulary on the canvas is poor:

1. Markdown text (`ChatMessage`).
2. Tool-call indicators (`ToolCallIndicator`).

That's enough for "answer my question about the codebase." It's not enough for the canvas's actual job, which is **work in progress made visible**. The agent should be able to:

- Hand the user a *live* feature/task status card that updates as work progresses (Pusher-driven, not a one-shot snapshot).
- Show a recent-PR list that re-fetches when a PR's status changes.
- Show recent team-member contributions as a digest the user can ack.
- Fork a deep-research sub-agent that runs async and posts its result back into the chat when ready — *without* blocking the conversation.
- Propose a canvas change (move a node, add a milestone, edit a description) as a card with **Approve** / **Reject** buttons. On approve → the agent's `update_canvas` tool runs; on reject → agent gets a tool-result indicating user declined.

Each of these is far richer than markdown can express. Some are interactive (approve/reject buttons). Some are stateful (live updates from Pusher). Some are async (deep-research). All of them should feel native to the chat scroll, not pop-out modals.

### Reuse the existing `Artifact` model? Or roll our own?

Hive already has a Prisma `Artifact` model (`schema.prisma:546-559`) with 17 enum types (`schema.prisma:1015-1033`: `FORM`, `CODE`, `BROWSER`, `IDE`, `MEDIA`, `STREAM`, `LONGFORM`, `BUG_REPORT`, `GRAPH`, `WORKFLOW`, `PULL_REQUEST`, `DIFF`, `PUBLISH_WORKFLOW`, `BOUNTY`, `PLAN`, `TASKS`, `VERIFY`). It's currently scoped to task chat (`Artifact.messageId → ChatMessage.id`, where `ChatMessage` is a task chat message). Reusing the type system is appealing — it's already wired to the agent's tool layer and the task UI knows how to render some of these.

Three options:

1. **Reuse `Artifact` directly.** Sidebar chat persists messages as `ChatMessage` rows with attached `Artifact` rows. Pro: one source of truth, agent reuses existing schemas. Con: `ChatMessage` requires a `taskId` (`schema.prisma`, see line 539 `@@index([taskId])` and the `task` relation at 536) — sidebar chat isn't task-scoped. Either we make `taskId` nullable (already is — line 536's relation is optional) and introduce an "org chat" message variant, or we don't use `ChatMessage` at all.
2. **New `OrgChatMessage` + `OrgArtifact` models.** Clean separation, no impedance mismatch with task chat. Cost: parallel infrastructure (rendering, storing, retrieving). Bigger surface area.
3. **Lightweight: artifacts as a typed payload field on stream chunks, persisted in the existing `chat_conversations` JSON blob.** No new schema. Agent emits an `artifact` chunk in the stream, sidebar renders it inline, the auto-save endpoint stores it as part of the message JSON. Pro: tiny. Con: not queryable by type, not reusable across surfaces.

**Recommendation for the seam in PR 1:** option 3, with a clear path to (1) when we need durability + queryability. Specifically:

- Add a `kind` discriminator on the message shape that the stream processor produces. Today messages have `role`, `content`, `imageData`, `toolCalls`. Add an optional `artifacts?: ArtifactPayload[]` where `ArtifactPayload = { id, type, data }` and `type` is a string constant (not yet a Prisma enum on this surface). Render-time switch: `<SidebarChatArtifact artifact={a} />` dispatching on `a.type`.
- The agent's stream emits these via a new chunk shape; `useStreamProcessor` already has a typed timeline (`item.type === "text" | "toolCall"`); add `"artifact"` as a third case. (Touches `src/lib/streaming/useStreamProcessor.ts` — check the timeline type and whether the AI SDK supports custom chunks here. If not, ride on top of `tool-result`s and treat certain tool names — e.g. `propose_canvas_change` — as artifact-emitters, with the timeline reducer pulling them into a separate bucket.)
- Auto-save serializes artifacts as part of the message JSON in `chat_conversations`. No new tables.

When we need durability (e.g. a "live status" artifact that needs to survive a page reload and keep updating), promote that artifact type to a real DB row — either reusing `Artifact` (if we port the org chat onto `ChatMessage`) or a new model. That's a future PR; flagging it here so the seam doesn't paint us into a corner.

### Four artifact types we'd build first

In rough priority order. Each is its own follow-up PR.

#### 1. `task-status` — live task progress card

- Agent calls a tool like `pin_task_status({ taskId })` → tool result emits an artifact `{ type: "task-status", data: { taskId } }`.
- Renderer (`SidebarChatArtifact` switch on `task-status`) mounts a small card that subscribes to `getTaskChannelName(taskId)` via Pusher and renders the current status, latest agent log, and a "Open task" link.
- Updates inline as the task progresses; user can keep chatting without losing the card.
- Pusher events to bind: `WORKFLOW_STATUS_UPDATE`, `STAKWORK_RUN_UPDATE` — both already emit on the task channel.
- Schema impact: none, if we ride on top of `chat_conversations` JSON. The card re-fetches its data on mount; the artifact payload only stores the `taskId` reference.

#### 2. `pr-list` — recent PRs digest

- Agent calls `list_recent_prs({ workspaceSlug, limit })` → returns a PR list as a `pr-list` artifact.
- Renderer fetches `/api/workspaces/{slug}/prs` (or whatever the existing endpoint is — `pr-metrics-widget` already shows PRs on the dashboard; reuse its hook), subscribes to `PR_STATUS_CHANGE` on the workspace channel, updates inline.
- Bonus: each PR row links to a per-PR detail panel (could itself become a sub-artifact).

#### 3. `propose-canvas-change` — approve / reject card

- Agent suggests a canvas mutation (e.g. "I think we should mark milestone X as done"). Instead of calling `update_canvas` directly, it emits a `propose-canvas-change` artifact with the proposed `patch` and a human-readable rationale.
- Renderer shows the diff (or a textual summary) + Approve / Reject buttons.
- On Approve: the renderer calls a new endpoint `POST /api/orgs/{githubLogin}/canvas/proposals/{id}/approve` which actually executes the patch (the same call path the agent's `update_canvas` tool would have made). On Reject: posts a tool-result back into the conversation indicating decline.
- Pattern: artifact as a *gate* on the agent's effectful tools. The agent never mutates canvas state without explicit user confirmation in the sidebar.
- Schema impact: probably wants a real DB row (a `CanvasProposal` model, or reuse `Artifact` once we port). Otherwise approval is fragile to page reloads.

#### 4. `deep-research` — async fork-and-forget handle

- User: "research the auth refactor's open questions, come back when ready."
- Agent calls `start_deep_research({ prompt })` → kicks off a background job (Stakwork run, or a long-running LLM call), returns a `deep-research` artifact `{ runId, status: "running" }`.
- Renderer shows a small card: "Researching… [Cancel]". Subscribes to `STAKWORK_RUN_UPDATE` on the appropriate channel.
- When the run completes, the artifact transitions to `status: "ready"` and the user can click "View result" to expand the research report inline (markdown) or as a `LONGFORM` artifact.
- Critically, **the conversation is not blocked.** The user keeps chatting; the agent keeps responding to other prompts; the deep-research card updates in the background.
- Schema impact: leverage existing `StakworkRun` model. Artifact stores `stakworkRunId` + last-known status; renderer re-fetches + subscribes.

### What this means for PR 1

Concretely, even though we're not building any of these in the first PR, two design choices in PR 1 keep the door open:

1. **The `SidebarChat` message shape** must be extensible — don't hardcode `{ role, content, toolCalls }`. Use `interface SidebarMessage { id, role, content, timestamp, toolCalls?, artifacts? }` from day 1. `artifacts?` is `unknown[]` for now; we tighten the type when we ship the first artifact.
2. **The renderer** (where we map `messages.map(m => <ChatMessage m={m}/>)`) should pass through `m.artifacts` to a `<MessageArtifacts artifacts={m.artifacts}/>` component that renders nothing in PR 1 but is the single dispatch point we'll grow. That way every artifact addition is one switch arm and one renderer file, not a fork through `ChatMessage`.
3. **The stream processor seam** — confirm in PR 1 (read-only investigation) that `useStreamProcessor`'s timeline can be extended with new item types without forking the hook. Document findings in a comment in `SidebarChat.tsx`. If it can't, that's the first thing to fix in PR 2 before any artifact work.

That's the entire artifact dependency footprint of PR 1. No speculative code, no premature schemas — just naming and the message-shape extensibility.

## Risks

- **`ChatMessage` centering looks weird in 384px.** Already flagged. Mitigation: visual QA in PR 1; fork into `SidebarChatMessage` if needed (~60 lines, no logic).
- **`scrollIntoView` scrolling the page.** Tested-in-the-wild risk; mitigation in spec above (switch to `scrollTop = scrollHeight`).
- **Tab state persistence.** When the user clicks a canvas node, then clicks back to Chat, then clicks the same node again, today's auto-flip rule reactivates Details — which is the right behavior (user wants details on the most recent click). Confirm: the existing `useEffect(() => { if (selectedNode) setTab("details") }, [selectedNode])` re-fires only when `selectedNode` *identity* changes. If the canvas re-emits the same node object on reselect, the effect won't fire and the user stays in Chat. Test this; if broken, key the effect on `selectedNode?.id` + a click-counter from the canvas.
- **Drag-through-chat UX loss.** Today users can drag the canvas through empty chat space. After this change, the entire 384px sidebar is opaque — that real estate is gone for canvas interaction. This is a deliberate trade: the sidebar gets more useful, the canvas gets a smaller usable area. If users complain, the resizable-sidebar follow-up is the relief valve.
- **Share endpoint requires `followUpQuestions`.** Lines 86-91 of `src/app/api/org/[githubLogin]/chat/share/route.ts` 400 if `followUpQuestions` is missing from the body — even though we have nothing to send. Sending `[]` should pass the `if (!body.followUpQuestions)` check. Confirm: `[]` is truthy in JS so the falsy guard accepts it. ✓
- **`?chat=<shareId>` collisions with the existing `/chat/shared/[shareId]` viewer.** Two URL shapes pointing at the same `SharedConversation` row, two different UX outcomes (forking canvas vs read-only viewer). The Share button copies the forking shape; the viewer is reachable only by hand-typed URL. Future risk: if we send share links elsewhere (email, Slack notifications), we have to be careful which shape we use. Document this in the share button's title/tooltip.
- **`skipEnrichments` flag is server-side opt-in.** If a future client surface forgets to set it, they get expensive enrichments by default. Acceptable for now (matches the principle of least surprise — old behavior is the default). Could flip later by checking referer / `orgId` presence as a heuristic if it becomes a cost concern.
- **Stale `?chat` param after first message.** Optional: clear `?chat` from the URL after seeding to prevent a refresh from re-seeding on top of an in-progress conversation. The spec leaves this as a judgment call; if not cleared, refresh = re-fork from the original starting point, which is arguably useful and arguably surprising. Recommend clearing it after `chatLoadComplete && initialMessages` are committed.

## Open questions

- **Should the chat tab have an unread badge** when the agent finishes streaming while the user is on a different tab? (Probably yes; tiny dot in the corner. Easy follow-up.)
- **Should `currentCanvasRef` change reset the conversation,** or is the agent expected to handle scope changes mid-conversation? (Today: doesn't reset, agent gets the new scope on the next message. Probably correct — feels weird to lose context just because you drilled into a sub-canvas. Confirm with product.)
- **Do we want the full-canvas FAB at all?** The current `+` FAB on the canvas (referenced at `OrgCanvasView.tsx:213-214` as the reason for the pointer-events gymnastics) lives in the bottom-right. After this change, the FAB is alone in the bottom-right of the canvas area (no chat there). Verify it's still positioned correctly relative to the new sidebar edge.
- **Should sharing also include the `currentCanvasRef` / scope at the time of sharing?** A CEO drilling into "Auth Refactor" and sharing the chat probably wants forkers to land in the same scope. Today the share URL only encodes the conversation; the canvas opens at root. Could extend to `?chat=<shareId>&canvas=<ref>` (both params already coexist). Out of scope for PR 1, easy follow-up.
- **Share titles.** The endpoint auto-generates a title from the first user message (`route.ts:7-27`) when none is provided. We pass nothing → it auto-generates. Probably fine; surfaces in the existing standalone viewer page header. If we want explicit titles ("Q4 planning convo"), add a title input to the Share button as a popover.
