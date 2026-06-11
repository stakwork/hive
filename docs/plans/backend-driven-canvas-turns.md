# Backend-Driven Canvas Chat Turns

Today the canvas chat's **user-initiated** turn only completes if the browser stays open: `/api/ask/quick` streams SSE, and the *client* (`useSendCanvasChatMessage`) assembles the assistant timeline while `useCanvasChatAutoSave` PUTs it back to `SharedConversation.messages`. Close the tab mid-stream and that turn is **lost** — the server streams into a dead socket and nothing persists it, because persistence is client-driven.

This plan makes the server author and persist the turn itself, so a user can send a message, close the tab, and re-open the conversation later to find the completed turn. The browser stream is demoted from *source of truth* to *live-preview optimization*.

Status: **implemented (Tier 1)** — server is the single writer for org-canvas turns; the browser stream is a live-preview. See "Implementation notes" at the bottom for what shipped.

> **Code-review finding that sharpens the problem.** It's worse than "the assistant turn is lost." `useCanvasChatAutoSave.flush()` early-returns `if (conv.isStreaming) return`, and `useSendCanvasChatMessage` sets `isStreaming = true` *before* the fetch and back to `false` only in its `finally`. So **nothing from a turn persists until the stream fully completes** — not even the user's own message. Close the tab mid-stream and the question itself is gone, not just the answer. The autosave POST/PUT only ever fires on the *settled* turn. This is why the fix has to move the *user message* write server-side too, not just the assistant turn.

> **The key realization: we already built this.** The fully backend-driven path exists and ships today for *autonomous* (planner-woken) turns:
> - `src/services/canvas-agent-autoturn.ts` runs `runCanvasAgent` server-side, drives generation to completion with `await result.text` / `await result.steps` (no browser socket), assembles rows with `messagesFromSteps`, persists them under a `SELECT … FOR UPDATE` lock (`appendAutoTurnMessages`), and fires a `CANVAS_CONVERSATION_UPDATED` Pusher nudge.
> - `useCanvasChatAutoSave` live-sync merges those rows by id (`mergeServerMessages`) into an open browser, with zero refresh.
>
> The "agent runs → DB row written → Pusher nudge → client merges" loop is real, unit-tested, and the source of truth for planner / auto-turn messages. **This plan generalizes that exact path to user-initiated turns.** No new transport, no new store slice, no new merge logic.

> **Companion docs — read first.**
> - `src/app/org/[githubLogin]/CANVAS_CHAT.md` — the chat subsystem: the Zustand store, identity-based autosave + live-sync (`canvasChatPersistence.ts`), the send/stream path. This plan changes the autosave contract described there.
> - `docs/plans/canvas-agent-manages-planners.md` — the backend-driven auto-turn (`canvas-agent-autoturn.ts`), the fan-out worker (`canvas-planner-fanout.ts`), the `CANVAS_CONVERSATION_UPDATED` nudge, the row-lock serialization. This plan reuses all of it.
> - `docs/plans/canvas-sidebar-chat.md` — `CanvasChatMessage` shape, `SharedConversation.messages` JSON round-trip, `?chat=<shareId>` share/fork.

## Goal

Three UX moments this unlocks:

1. **Send and leave.** User asks the canvas agent a question, then closes the tab before the answer finishes. They re-open the conversation 10 minutes later and the completed answer (including any tool calls / research) is there.
2. **Flaky connection, no loss.** A laptop sleeps or the network drops mid-stream. The turn still completes server-side and persists; the user's next visit shows it.
3. **Multi-device continuity.** User starts a turn on desktop, switches to the iOS app. The iOS app reads `SharedConversation.messages` and sees the completed turn — no per-surface streaming protocol.

## Non-goal (explicitly): no streaming regression

The live tab MUST keep streaming character-by-character exactly as today. This is achievable because `runCanvasAgent` returns the raw `streamText` handle, which is multi-consumer:

- The browser keeps receiving `result.toUIMessageStreamResponse()` — unchanged byte-for-byte (`runCanvasAgent.ts:850`, `route.ts:554`).
- Server-side persistence runs in `after()` off the **same generation** (`await result.steps`, as `canvas-agent-autoturn.ts:627` already does). It's a parallel sink — it does not gate, buffer, or delay bytes to the client.

The only seam is the end-of-turn handoff, solved by a shared `turnId` (see "Reconciliation" below).

## The animating principle

**The server writes the turn; the browser stream is an optional live preview of a write that happens regardless.**

Corollaries:

- **One generation, two consumers.** Never re-run the agent for persistence. The HTTP response and the server-side persist both read the *same* `result` handle from a single `runCanvasAgent` call. (`runCanvasAgent`'s `streamText` passes **no `abortSignal`**, so a client disconnect does not cancel generation — confirmed in code review. `result.consumeStream()` in `after()` drives it to completion regardless of the socket.)
- **The server is the single writer for org-canvas turns.** The client stops POSTing/PUTting messages entirely (see "Resolved design decisions" #1 for why single-writer beats dual-writer here). This collapses to *one* persistence path for every agent turn — user-driven and autonomous — exactly the `canvas-agent-autoturn.ts` path, now shared.
- **The browser stream is a purely visual preview.** The client's live-rendered rows are ephemeral and need **not** share ids with the server's persisted rows (they can't — see the reconciliation section: client splits the timeline at tool boundaries, server splits per step). Dedup on the active tab is by `turnId` *prefix*, not by exact row id.

## What gets added vs. unchanged

| Layer | New | Unchanged |
| --- | --- | --- |
| `src/app/org/[githubLogin]/_state/useSendCanvasChatMessage.ts` | Generate a `turnId` per send; include it (plus the new user message and the existing `conversationId`) in the `/api/ask/quick` body. Register `turnId` in the store's `locallyAuthoredTurnIds` set. Read the new `X-Conversation-Id` response header and call `setServerConversationId` when the server just created the row. The live-rendered rows stay client-local/ephemeral. | The whole `useStreamProcessor` → timeline-split → `replaceAssistantStream` rendering path. The user still sees char-by-char streaming. |
| `src/app/api/ask/quick/route.ts` (orgId branch) | **(1) Synchronously, before streaming:** ensure the conversation row (create if no valid `conversationId`, generating title + `settings.extraWorkspaceSlugs` like the POST route does) and append the **user** message under the row lock, idempotent on `${turnId}-u`. Return the row id in an `X-Conversation-Id` header. **(2) In `after()`:** `await result.consumeStream()`, then `messagesFromSteps(steps, turnId)` → `appendTurnMessages` (row lock, idempotent on `${turnId}-` prefix) → `notifyCanvasConversationUpdated`. Stream to the browser as today. | The streaming response shape, token-attribution `onFinish`, prompt-cache load/persist. |
| `src/app/api/ask/quick/route.ts` (approval/rejection branch) | Persist the user approve/reject-click row **and** the synthetic assistant row (carrying `approvalResult` + summary) server-side under `${turnId}-`, then nudge. The client no longer stamps/persists `approvalResult`. | The `handleApproval`/`handleRejection` logic, the synthetic SSE stream, the `X-Approval-Result` header (kept for the live tab's immediate card flip). |
| `src/services/canvas-turn-persistence.ts` *(new)* | Extract `messagesFromSteps` + the row-locked, idempotent-by-id-prefix append + nudge out of `canvas-agent-autoturn.ts` into a shared writer (`appendTurnMessages(conversationId, rows, idPrefix)`). Both the user-turn path and the auto-turn path call it. | — |
| `src/services/canvas-agent-autoturn.ts` | Call the shared writer instead of its private `messagesFromSteps`/`appendAutoTurnMessages`. | The wake-message / advisory-lock / per-user-opt-in logic. |
| `src/app/org/[githubLogin]/_state/useCanvasChatAutoSave.ts` | **Remove the POST/PUT save path** for org-canvas; keep the Pusher subscription + live-sync merge. Add a `locallyAuthoredTurnIds` filter to the merge (drop incoming server rows whose id starts with a turn this tab authored — it's already showing them live). Idle gate simplifies to `!isStreaming`. | The Pusher subscription lifecycle, `mergeServerMessages`, `setConversationMessages`, the re-check-after-await idleness guard. |
| `src/app/org/[githubLogin]/_state/canvasChatStore.ts` | Add `locallyAuthoredTurnIds: Set<string>` + a `markTurnAuthored(turnId)` action. | Everything else. |
| `src/lib/ai/runCanvasAgent.ts` | None — `result` already exposes `.steps` / `.consumeStream()` / `.toUIMessageStreamResponse()`, and passes no abort signal. | Everything. |
| `prisma/schema.prisma` | None — `messages` is `Json`; `${turnId}-` ids are just strings. | Everything. |

## The flow

```
User sends in canvas chat
        │
        ▼
useSendCanvasChatMessage
  • turnId = uuid();  markTurnAuthored(turnId)
  • render ephemeral user + assistant rows locally (live, visual only)
  • POST /api/ask/quick { messages, conversationId?, turnId, workspaceSlugs, ... }
        │
        ▼
/api/ask/quick (orgId branch)
  • ensureRow + append USER msg  ── row lock, idempotent `${turnId}-u` ──┐  (SYNC, before stream)
  • respond header: X-Conversation-Id: <rowId>  ──► client setServerConversationId (if new)
  • result = runCanvasAgent(...)                                         │
  • return result.toUIMessageStreamResponse()  ──────────────► browser streams (live preview)
  • after(async () => {                                                  │
      await result.consumeStream()   // finishes even if client gone     │
      rows = messagesFromSteps(await result.steps, turnId)               ▼
      appendTurnMessages(convId, rows, `${turnId}-`)  ── row lock + prefix-idempotent ──
      notifyCanvasConversationUpdated(convId, "user-turn")  ── Pusher nudge ──┐
    })                                                                        │
        ┌─────────────────────────────────────────────────────────────────────┘
        ▼
useCanvasChatAutoSave live-sync (every viewer on the channel)
  • refetch conversation → mergeServerMessages(local, server, locallyAuthoredTurnIds)
  • THIS tab authored turnId → server `${turnId}-*` rows filtered out → keep live rows (no flicker)
  • OTHER tab / reopened tab → didn't author it → server rows merge in normally
```

## Reconciliation: why there's no flicker, no dup, no loss

The naive "share one id scheme between client and server so the merge dedups by id" does **not** work: the client splits an assistant turn at tool-call boundaries *inside* the stream timeline (`useSendCanvasChatMessage`), while the server splits *per agent step* (`messagesFromSteps`). The row counts and boundaries differ, so the ids can't be made to line up. Trying to force it would produce duplicate rows on the active tab.

Instead, dedup is by **`turnId` prefix**, and the client's live rows are never persisted:

- **The tab that sent the turn** records `turnId` in `locallyAuthoredTurnIds`. When the post-turn nudge fires, the merge filters out every server row whose id starts with `${turnId}-` — this tab is already showing its own visual version. Result: no append, no flicker, no dup. The client's live rows can have any ids; they never need to match the server's.
- **A different tab / device** (shared room) or **the same tab after reload** has an empty `locallyAuthoredTurnIds` for that turn → the server `${turnId}-*` rows merge in normally and render the authoritative copy.
- **Planner / auto-turn / other-user rows** carry `planner-` / `autoturn-` / other turn prefixes never in *this* tab's authored set, so they always merge in (unchanged behavior).
- **Never lost:** the user message is persisted server-side synchronously at turn start; the assistant turn is persisted in `after()` after `consumeStream()` finishes generation independent of the socket.

## Robustness tiers

**Decision: ship Tier 1.** It delivers the stated goal (close tab → reopen → see the completed turn) with zero streaming compromise.

- **Tier 1 — `after()` + `consumeStream` (this plan, CHOSEN).** The browser reads the LLM stream natively from its own request (full char-by-char). Persistence runs server-side off the same `result`, independent of the socket. Survives tab-close, sleep, network drop. **Set `maxDuration` explicitly on `/api/ask/quick`** (e.g. 300s) — that's the one real bound, since (a) `streamText` passes no abort signal so a client disconnect can't cancel generation, and (b) Vercel does **not** kill in-flight functions on deploy (running invocations finish on the old deployment; deploys only reroute *new* requests). So the only way an open-tab turn is lost is a turn exceeding `maxDuration`, which is far longer than a realistic canvas turn.
- **Tier 2 — Redis resumable streams (future seam, NOT now).** If we later want *reload-mid-turn keeps streaming live* or turns longer than `maxDuration`, the better path than a Pusher-delta worker is the AI-SDK `resumable-stream` pattern over the existing `ioredis`: generation publishes chunks to a Redis stream keyed by a `streamId`; a thin SSE relay route subscribes and replays buffered chunks on reconnect. Keeps native streaming, adds reload-resume, no new infra. The single-writer persistence in this plan is orthogonal and stays valid — Tier 2 only changes the *delivery* layer. (A Pusher-delta relay is the alternative but trades streaming smoothness for a model we don't need yet.)

## Resolved design decisions (from code review)

1. **Single writer = server; client save path removed (not "narrowed").** Considered dual-writer (keep client save for the open tab + server fallback for tab-close, deduped). Rejected: it requires *both* writers to dedup against each other, which only works if they emit identical row ids — impossible given the different client/server split (see Reconciliation). Forcing idempotent-by-id appends on top of mismatched ids is fragile. Single-writer collapses to one persistence path (the proven auto-turn path), no write race, no dual-dedup. **Trade-off accepted:** if the serverless function is killed mid-generation (deploy/timeout), the assistant turn can be lost *even with the tab open* — a narrow regression from today's "open tab always persists." Mitigated by (a) the synchronous user-message write (the question is never lost) and (b) Tier 2 as the durable fix. The window is seconds-wide and bounded by function max-duration.

2. **User message + row creation happen server-side, synchronously, before the stream.** Title generation and `settings.extraWorkspaceSlugs` already live in the POST/PUT routes — moving creation into `/api/ask/quick` reuses `generateTitle` / `getLastMessageTimestamp`. The new `X-Conversation-Id` response header returns the row id to the client (same pattern as `X-Approval-Result`). The client's `useCanvasChatAutoSave` POST/PUT is deleted, so there's no longer two creators racing.

3. **Reconciliation is by `turnId` prefix, not by row id.** The client's live rows are visual-only and never persisted; `locallyAuthoredTurnIds` filters the matching server rows out of the merge on the authoring tab. This is the decision that makes "no streaming regression" + "no end-of-turn flicker" + "no duplicate" all hold simultaneously.

4. **Approvals get the same server-write treatment.** The approval branch already runs server-side and resolves the conversation id (`resolveOrgConversationRowId`). It now also persists the click + synthetic assistant row (with `approvalResult`) under `${turnId}-`. The `X-Approval-Result` header stays so the live tab flips the card instantly; persistence no longer rides on the client autosave.

5. **`ephemeralSeedCount` / `persistedIdsRef` / `computeUnsaved` / `seedPersistedIds` become dead for org-canvas.** With no client save path, the attention-intro seed is simply never sent (the server only persists this turn's rows), and joined-share rows already exist in the adopted row. Plan: leave `canvasChatPersistence.ts` + its tests in place but stop wiring `computeUnsaved`/`seedPersistedIds` from the hook; keep `mergeServerMessages` (now extended with the prefix filter). Revisit deleting the dead helpers in a follow-up to keep this PR's blast radius contained.

## Remaining risks / edge cases

- **Reload between user-write and `after()`-write.** User sends, reloads immediately. The user message is already persisted (sync); the assistant `after()` write may land *after* the reload's GET. The reloaded tab is subscribed to the channel, so the post-turn nudge refetches it in — *unless* the nudge fires in the gap between GET and subscribe. Acceptable (same class as the existing planner-fan-out gap); a belt-and-suspenders "refetch once on subscribe" can close it later.
- **Mid-stream error.** `messagesFromSteps` must emit a trailing error row when `result` errored, so the persisted turn matches what the live viewer saw (the client already renders `${messageId}-error`). Pull the error off the finished `result` in `after()`.
- **Concurrency.** The new user-write and turn-write MUST use the same `SELECT … FOR UPDATE` lock as `appendAutoTurnMessages` / `fanOutPlannerMessageToCanvas` / the conversations PUT. The shared `canvas-turn-persistence.ts` writer owns that lock.
- **Id prefixes.** `${turnId}-u` / `${turnId}-N` must not collide with `planner-` / `autoturn-`. Use a uuid `turnId`; render-side filters in `SidebarChat` / `CanvasHistoryPopover` key on `source.kind`, not id shape, so they're unaffected.
- **Public-viewer / dashboard chat: out of scope.** Org-canvas only (`orgId` present, auth-required). Dashboard chat keeps client-driven autosave; public-viewer rows have no durable re-open identity.

## Testing

- Unit (`canvasChatPersistence.test.ts`): `mergeServerMessages` with the new prefix filter — a server `${turnId}-*` row is dropped when `turnId ∈ locallyAuthoredTurnIds` (no-flicker invariant), and merged when it isn't (reopen/other-tab).
- Unit (`canvas-turn-persistence`): shared `messagesFromSteps` + `appendTurnMessages` — idempotency on `${turnId}-` prefix (a retried `after()` never double-appends); a `stay_silent`-only / empty turn appends nothing.
- Unit: auto-turn still works after the writer extraction (its existing tests should pass unchanged).
- Integration: POST `/api/ask/quick` with `orgId` + no `conversationId` → row created, `X-Conversation-Id` returned, user message persisted before the stream body; after stream, assistant rows present + nudge fired.
- Integration: same, with the client aborting the stream early → assistant turn still lands (proves socket-independence).
- Manual: send + immediately close tab → reopen → completed turn present; send with tab open → no end-of-turn flicker; shared room second viewer sees the turn appear live.

## Implementation order

1. Extract `canvas-turn-persistence.ts` from `canvas-agent-autoturn.ts`; keep auto-turn green (pure refactor, no behavior change).
2. Server: `/api/ask/quick` orgId branch — sync ensure-row + user-message write + `X-Conversation-Id`; `after()` turn write + nudge. Behind a check so non-orgId paths are untouched.
3. Server: approval/rejection branch — persist click + synthetic row under `turnId`.
4. Client: `turnId` + `markTurnAuthored` in store; send `turnId` + read header in `useSendCanvasChatMessage`; remove save path + add prefix filter in `useCanvasChatAutoSave`.
5. Tests + manual verification.

## Implementation notes (shipped)

- **`src/services/canvas-turn-persistence.ts`** *(new)* — `messagesFromSteps(steps, idPrefix, stripToolNames?)` + `appendTurnMessages({conversationId, rows, idPrefix, reason})` (row-locked, idempotent on the id prefix, fires the nudge). `canvas-agent-autoturn.ts` now calls these (its private copies deleted); its 11 tests pass unchanged.
- **`src/app/api/ask/quick/route.ts`** — `export const maxDuration = 300`. Org-canvas turns (gated on `orgId && userId && turnId`): `persistCanvasUserMessage` writes the user row as `${turnId}-u` (creating the `SharedConversation` if `conversationId` is absent/invalid, titled via `generateTitle`, `settings.extraWorkspaceSlugs = slugs`) *before* the stream; `X-Conversation-Id` header returns the row id; an `after()` block does `result.consumeStream()` → `messagesFromSteps(steps, \`${turnId}-a\`)` → `appendTurnMessages(..., reason: "user-turn")`, with a trailing error row on failure. `currentCanvasConversationId` now also resolves from the org-canvas row (so `send_to_feature_planner`'s lazy claim works on the main path, not just approvals). The approval/rejection branch persists the click row + synthetic `approvalResult` row under `${turnId}-`.
- **`src/lib/pusher.ts`** — added the `"user-turn"` `CanvasConversationUpdateReason`.
- **Store (`canvasChatStore.ts`)** — `locallyAuthoredTurnIds: Set<string>` + `markTurnAuthored(turnId)`.
- **`useSendCanvasChatMessage.ts`** — generates a `crypto.randomUUID()` `turnId`, `markTurnAuthored`s it, sends it in the body, and adopts the `X-Conversation-Id` header on the first turn. Live-render path otherwise unchanged (full streaming preserved).
- **`useCanvasChatAutoSave.ts`** — **POST/PUT save path removed**; now live-sync only. The merge passes `${turnId}-` prefixes for `locallyAuthoredTurnIds`, so the authoring tab never double-renders its own turn; idle check simplified to `!isStreaming`; a mid-stream nudge is deferred and run when the stream settles.
- **`mergeServerMessages`** — added optional `skipServerIdPrefixes` (filters incoming server rows only; never local rows).
- **Tests** — new `canvas-turn-persistence.test.ts` (9); rewrote `useCanvasChatAutoSave.test.ts` for the live-sync-only contract (5); extended `canvasChatPersistence.test.ts` with the prefix-filter cases; fixed `useSendCanvasChatMessage.test.ts` mock to include the two new store actions. 40 tests across the affected files pass; touched source files typecheck clean.
- **Not done (deliberately):** `canvasChatPersistence.ts`'s `seedPersistedIds`/`computeUnsaved` and the store's `ephemeralSeedCounts` are now dead for the save path but left in place (still exported/tested) to keep the diff contained — a follow-up can delete them. Integration tests require a live Postgres (not run here); they exercise non-org workspace paths unaffected by the gated change.
