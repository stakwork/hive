# Graph Agent Chat

Chat with a swarm `repo/agent` (in `mode: "graph"`) from the Graph Explorer page (`/w/[slug]/context/graph`), using the existing `AgentRun` table + webhook fan-back. Optionally let the agent file Concept change proposals (`propose_concept_change`), surfaced in the chat as read-only cards that deep-link to the review UI on `/learn`.

## Goals

- **Chat button** on the graph page opens a right sidebar with past chat threads and a thread view.
- **New button** opens a modal: a prompt textarea plus a **"Allow concept change proposals" checkbox** decided at chat creation. The checkbox is a per-thread setting — it controls whether `propose_concept_change` / `list_concept_proposals` are enabled in the agent's `toolsConfig` for every message in that thread.
- Each message is a one-shot `POST /repo/agent` dispatch with a `webhookUrl`; the terminal result lands via webhook, is stored on the `AgentRun` row, and a Pusher nudge refreshes the UI.
- When a completed run filed proposals, show compact proposal cards (action badge, concept, rationale, read-only diff) linking to `/w/{slug}/learn` for review. **No approve/reject in this surface** — deciding lives on `/learn` (separate work in progress; see [Coordination](#coordination-with-the-learn-proposals-ui)).

## Why this shape

- `repo/agent` already supports everything server-side: `mode: "graph"` is a declared param (`parseAgentBody`, stakgraph `mcp/src/repo/index.ts:159`), `webhookUrl` gets a terminal POST of `{ request_id, status: "completed", result }` / `{ ..., status: "failed", error, retryable }` with retries and an orphan sweep after restarts.
- The webhook path is **one-shot, not streaming** — so the sidebar is a run thread that *feels* like chat. Session continuity is server-side: `repo/agent` persists session history keyed by `sessionId`, so follow-up messages just re-POST with the same `sessionId`. Hive stores only prompt/result pairs for display.
- Proposals filed by the agent carry `sessionIds` (see `stakgraph/mcp/src/gitree/PROPOSALS_API.md`), so the chat can correlate "this thread filed these proposals" with a filtered list call — no new plumbing.

## Current state (what we reuse, what's missing)

**Reuse as-is:**
- `AgentRun` row + 256-bit callback token pattern (`prisma/schema.prisma` `AgentRun`, producer in `src/lib/ai/workflowExplorerTools.ts` `setupFanBack()`).
- `/api/agent-runs/webhook` hardening: middleware allowlist (`src/config/middleware.ts`), per-run+IP rate limit, SHA-256 + `timingSafeEqual` token check with dummy compare on 404, atomic `updateMany` PENDING→terminal claim, 128KB `hardenContent` cap, 500-on-unexpected-error so the swarm retries.
- Dispatch helper `dispatchRepoAgent` (`src/lib/ai/askTools.ts`) and the `mode?: "graph" | "workflow"` request type — nothing passes `"graph"` yet; this is the first caller.

**Gaps to close:**
1. Result content is never stored on the row — the webhook fans out into a canvas `SharedConversation` and **warns-and-drops when `conversationId` is null**. Graph runs have no canvas conversation.
2. No `workspaceId`, no run-type discriminator (`agentKind: "workflow_explorer"` is hardcoded in the webhook fan-out), no stored prompt, no `sessionId`.

## Schema changes

Migration: `npx prisma migrate dev --name agent_run_graph_chat`.

```prisma
model AgentRun {
  // existing: id, tokenHash, conversationId?, orgId, userId, title,
  //           requestId?, status, error?, createdAt, updatedAt

  agentKind   String  @default("workflow_explorer") @map("agent_kind") // "workflow_explorer" | "graph_chat"
  workspaceId String? @map("workspace_id")   // set for graph_chat runs; null for canvas runs
  sessionId   String? @map("session_id")     // repo/agent session — groups runs into a thread
  prompt      String? @db.Text               // the user message for this run (display only)
  result      String? @db.Text               // terminal content, capped at 128KB by hardenContent
  proposalsEnabled Boolean @default(false) @map("proposals_enabled") // checkbox snapshot for this run

  @@index([workspaceId, sessionId])
}
```

Notes:
- **No new thread table.** A thread *is* a `sessionId`: thread list = `AgentRun` rows for the workspace grouped by `sessionId` (title from the first run's `title`, which we set from the prompt's first line). The per-thread checkbox is snapshotted onto every run (`proposalsEnabled`); on reload the client derives the thread setting from the latest run in the session. If threads later need renaming/archiving, promote to a `GraphChatThread` model then — not now.
- Keep `conversationId`, `orgId` nullable-string semantics as today (no FKs on this table currently; stay consistent).
- `status` enum unchanged: `PENDING | DELIVERED_INLINE | DELIVERED_WEBHOOK | FAILED`. Graph runs terminal at `DELIVERED_WEBHOOK`/`FAILED`.

## API

### `POST /api/workspaces/[slug]/graph/agent`

Body: `{ prompt: string, sessionId?: string, proposalsEnabled?: boolean }`.

- Auth: `validateWorkspaceAccess(slug, userId, true)` + **`canAdmin`** — same gate as the existing graph query route (`src/app/api/workspaces/[slug]/graph/query/route.ts`) and the page itself.
- New thread: no `sessionId` → mint `randomUUID()`; `proposalsEnabled` comes from the modal checkbox. Follow-up: client passes the thread's `sessionId` and its stored `proposalsEnabled` (server re-snapshots it onto the run row; server does **not** trust the client to flip it mid-thread — reject if it differs from the latest run in the session).
- Flow (mirrors `setupFanBack()` in `workflowExplorerTools.ts`):
  1. Mint 256-bit token, `tokenHash = sha256(token)`.
  2. `db.agentRun.create({ agentKind: "graph_chat", workspaceId, orgId, userId, sessionId, prompt, proposalsEnabled, title, status: PENDING })`.
  3. Resolve the **workspace's own swarm** via `getSwarmConfig(workspaceId)` (the `learnings/utils.ts` helper) — *not* the hardcoded Stakwork workflow-library swarm the explorer tool uses.
  4. `dispatchRepoAgent(swarmUrl, swarmApiKey, { prompt, mode: "graph", sessionId, toolsConfig: proposalsEnabled ? { propose_concept_change: true, list_concept_proposals: true } : undefined, webhookUrl })` where `webhookUrl = ${publicBaseUrl}/api/agent-runs/webhook?id=${run.id}&token=${rawToken}`.
  5. Best-effort `update({ requestId })`; on dispatch throw, `markAgentRunFailed()` (guarded `updateMany` on PENDING, as today).
- Response: `{ runId, sessionId }`. UI renders the pending bubble optimistically.
- `USE_MOCKS`: short-circuit dispatch to a mock endpoint (see [Mocks & tests](#mocks--tests)).

### `GET /api/workspaces/[slug]/graph/agent/runs`

- `?sessionId=` → runs in that thread, oldest first: `{ runs: [{ id, prompt, result, status, error, createdAt }] }`.
- No `sessionId` → thread list: latest run per `sessionId` (`{ sessionId, title, proposalsEnabled, lastStatus, updatedAt }`), newest first.
- Same admin gate. Scope every query by `workspaceId` **and** `agentKind: "graph_chat"`.

### Webhook: branch in `/api/agent-runs/webhook`

Token check, rate limit, payload parse, and the atomic claim are unchanged. After the claim, branch on the row:

- `agentKind === "graph_chat"` (or simply `workspaceId != null`): store `result` (success) / `error` (failure) on the row in the same `updateMany` that claims it, then Pusher-nudge (below). No canvas fan-out.
- Else: existing canvas fan-out path, untouched.

This also fixes the current warn-and-drop for null-conversation runs by giving them a real destination.

### Pusher

Add to `src/lib/pusher.ts`:

- Event: `PUSHER_EVENTS.GRAPH_AGENT_RUN_UPDATED = "graph-agent-run-updated"` (hyphenated, matching existing convention).
- Channel: reuse `getWorkspaceChannelName(slug)` — no new channel type. Payload is a nudge only: `{ runId, sessionId, status, at }`; the client refetches the thread. (Requires the webhook handler to resolve the workspace slug from `workspaceId` — one indexed lookup; alternatively store `workspaceSlug` on the run row at create time to keep the webhook handler DB-light. Prefer storing the slug: the webhook path should stay cheap and retry-safe.)

## UI

All new components under `src/components/graph-explorer/chat/` (directory with `index.tsx`, per project convention). Follow the **`LogsChat` / `DashboardChat` precedent: local component state (or a small dedicated Zustand store), NOT the org canvas chat store** — `CANVAS_CHAT.md` explicitly says not to unify with it, and this surface is workspace-scoped while the canvas is org-scoped.

### Entry points on `GraphExplorer`

- Header gains two buttons next to the existing controls:
  - **Chat** — toggles the right sidebar (thread list → thread view). Implement as a fixed right panel (like `LearnSidebar`) rather than a `Sheet`, so it can stay open while interacting with the graph; the node-properties `Sheet` already occupies the overlay pattern.
  - **New** — opens `NewGraphChatModal`.

### `NewGraphChatModal`

- Prompt `Textarea` (autofocus, Cmd+Enter submits).
- Checkbox: **"Allow concept change proposals"** — helper text: "The agent may propose edits, merges, or deletions of Concept nodes. Proposals are reviewed on the Learn page before anything changes." Default **off**.
- Submit → `POST .../graph/agent` (no `sessionId`) → open the sidebar on the new thread with the pending run showing.

### `GraphChatSidebar`

- **Thread list**: title, relative time, status dot; a small icon/badge on threads created with proposals enabled. Click → thread view.
- **Thread view**: alternating user prompt / agent result bubbles from `GET .../runs?sessionId=`. States:
  - `PENDING` → spinner bubble ("Agent is working…"). Subscribe to `workspace-${slug}` / `graph-agent-run-updated`, refetch on matching `sessionId`. Also poll-fallback every ~20s while any run is PENDING (webhooks can be delayed).
  - `DELIVERED_WEBHOOK` → render `result` as markdown.
  - `FAILED` → error bubble with `error`; if the webhook payload said `retryable: true`, offer a "Retry" that re-POSTs the same prompt (same `sessionId`).
- **Composer** at the bottom for follow-ups (`POST` with the thread's `sessionId`). Disable while a run in the thread is PENDING — `repo/agent` sessions are serial.
- The thread header shows the proposals setting as a read-only badge ("Proposals on/off") — it is not editable after creation.

### Proposal cards in the thread

After a completed run in a proposals-enabled thread:

1. Fetch `GET /api/learnings/concepts/proposals?workspace={slug}&status=pending` (the proxy added on branch `feature/CMSTAKT2-add-concept-proposals-proxy-and-mocks-*`).
2. Filter to proposals whose `sessionIds` includes the thread's `sessionId`.
3. Render `ConceptProposalChip` per match, appended under the run bubble:
   - Action badge (`create` / `update` / `delete` / `merge`), concept name/id, `rationale`.
   - "View diff" expands a **read-only** unified diff: `computeUnifiedDiff` (`src/lib/diff/unifiedLineDiff.ts`) with `oldStr = baseDocs`, `newStr = documentation` (per `PROPOSALS_API.md`); for `merge` also show `absorbedDocs` as removed. Reuse the `UnifiedDiffView` rendering from `ProposalCard.tsx`.
   - **"Review on Learn →"** linking to `/w/{slug}/learn?proposal={id}` (see Coordination). No approve/reject buttons here in v1.
4. Also fetch with `status=accepted|rejected` filtered by session on subsequent views so decided proposals show their outcome instead of vanishing.

## Coordination with the /learn proposals UI

A parallel effort is building the review queue on `/learn` on top of the same proxies. Two contracts to agree on:

1. **Deep link**: `/w/{slug}/learn?proposal={id}` should open that proposal in the review UI (the page already deep-links via `?concept=` / `?doc=`; add `?proposal=`). Until it exists, link to plain `/w/{slug}/learn`.
2. **Shared types**: promote the proposal interface out of `src/app/api/mock/stakgraph/gitree/proposals/fixtures.ts` (current de-facto source) into e.g. `src/types/concept-proposals.ts` — `ProposalAction`, `ProposalStatus`, `ConceptProposal`. Both UIs import it. Do **not** reuse the canvas `ProposalOutput` union (`src/lib/proposals/types.ts`) — that's the older, separate `conceptCreate`/`conceptUpdate` pipeline with different semantics (direct-apply on approve, no delete/merge, no `stale_base`).

## Security notes

- Page + all new routes gated `canAdmin` (matches existing graph query route). Proposal *listing* via the proxy is `requireReadAccess`, which admin satisfies.
- Webhook token flow unchanged (query-string token, hash-only at rest, constant-time compare, atomic single-claim). The new branch stores content on the row — keep the existing `hardenContent` 128KB cap and the demote-to-FAILED-on-oversize behavior.
- Swarm credentials (`swarmApiKey`) stay server-side; the client only ever sees run rows.
- `proposalsEnabled` is enforced server-side per dispatch (`toolsConfig` omitted unless true) and immutable per thread; the checkbox is not a client-trusted flag at message time.
- The agent can only *file* proposals — accept/reject is human-only upstream (agents never get those tools) and DEVELOPER-role-gated in the Hive proxy.

## Mocks & tests

- **Mock dispatch**: under `USE_MOCKS`, `POST .../graph/agent` skips the swarm and schedules a fake webhook: a mock route (e.g. `/api/mock/stakgraph/repo/agent`) that immediately (or after a short delay) POSTs a canned terminal payload to the run's `webhookUrl`. Add a canned proposals-enabled variant that also inserts a `MockProposal` with the run's `sessionId` into the existing stateful mock fixtures so the chip flow is testable end-to-end.
- **Integration tests** (`src/__tests__/integration/api/`):
  - `graph/agent` route: admin gate, thread creation, follow-up sessionId reuse, `proposalsEnabled` immutability, dispatch-failure → FAILED.
  - Webhook branch: graph_chat run stores `result` on row + no canvas fan-out; canvas run behavior unchanged (extend `agent-runs/webhook.test.ts`).
- **Unit tests**: thread grouping in the runs GET; proposal `sessionIds` filtering; `ConceptProposalChip` diff rendering states (create/update/delete/merge).
- **E2E** (optional v1): mock-auth flow — new chat with checkbox on → pending → mock webhook → response + proposal chip → link href check. Add `data-testid`s via `selectors.ts` first per E2E guidelines.

## Implementation order

1. **Migration** — new `AgentRun` columns.
2. **Webhook branch** — store-on-row path + Pusher event (safe: dead code until a graph_chat run exists).
3. **Dispatch + runs routes** — `POST/GET /api/workspaces/[slug]/graph/agent[...]`, with mocks.
4. **Sidebar + modal UI** — threads, pending/complete/failed states, composer.
5. **Proposal chips** — list proxy + `sessionIds` filter + read-only diff + Learn link.
6. **Tests** throughout; E2E last.

Steps 1–3 are shippable without UI (curl-testable). Step 5 depends on the proposals proxy branch landing (or its mocks).

## Open questions

- Does the graph agent need repo context (`repo_url`/`pat`) for graph mode, or is the swarm graph alone sufficient? The workflow explorer sends neither; assume none until proven otherwise.
- `DELIVERED_INLINE` status remains unused by this flow — fine, but worth a cleanup note.
- Thread deletion/archival: out of scope v1 (threads are cheap rows); revisit if the list gets noisy.
