# Synchronous Canvas Agent — `POST /api/ask/sync`

A non-streaming, JSON-in/JSON-out endpoint that runs the canvas agent for a
single turn and returns the finished result in one response. Built for
**native mobile / agent-as-tool** callers that want the canvas agent as a
plain function — no SSE, no delta accumulation, no UI-message-stream parsing.

The streaming `/api/ask/quick` stays the source of truth for the web canvas
chat. This is a sibling that reuses the *same* engine (`runCanvasAgent`) and
the *same* persistence/helper modules, differing only in the transport: it
**awaits** the generation server-side and returns a structured blob instead
of streaming.

Status: **implemented.** See `src/app/api/ask/sync/route.ts`,
`fetchOrgCanvasConversationMessages` in
`src/services/org-canvas-conversation.ts`, and the tests
`src/__tests__/integration/api/ask/sync.test.ts` +
`src/__tests__/unit/middleware/config.test.ts`.

Two deltas from the original plan:

- **No `ROUTE_POLICIES` change.** `RoutePolicy.access` excludes
  `"protected"`, which is the middleware default — so a route is auth-only
  precisely by *not* being listed. `/api/ask/sync` therefore stays
  protected with zero config (a unit test pins this).
- **`x-api-token` auth was added** (not in the original plan) so external
  eval workflows can call the canvas agent headlessly. The middleware
  already lets `x-api-token` API requests through (`authStatus:
  "api-token"`); the handler validates the value with `validateApiToken`
  and, on success, acts as the **primary workspace owner** (mirroring
  `requireAuthOrApiToken`). Session callers keep the full
  `validateWorkspaceAccess` + `validateUserBelongsToOrg` IDOR checks;
  the trusted token skips them. `orgId` is derived from the primary
  workspace's `sourceControlOrgId` when not passed explicitly.

### Replay input mode + `dryRun` (eval harness)

Added for an automated eval harness that re-plays canvas-agent calls and
scores the result without mutating anything:

- **Replay input** — alongside the server-history shape (`{ message,
  conversationId? }`), the endpoint accepts a full verbatim transcript:
  `{ messages: ModelMessage[] }`, the same shape `/api/ask/quick` takes.
  Replay is **stateless** (no conversation read/written) and **requires
  `dryRun: true`** — a replayed transcript must never persist or mutate.

- **`dryRun: true`** runs the agent as a pure function and writes nothing:
  no row create/append, no prompt-cache write, no Pusher, no research
  dispatch, no `schedule_check` injection. Crucially it is **selective,
  not a blunt `readonly`**: the pure-output `propose_*` tools are KEPT
  (they emit a proposal card with *no DB write* — the row is only created
  later at approval time, see `initiativeTools.ts`), so an eval can read
  exactly what `propose_feature` produced from the returned rows'
  `toolCalls[].output`. Implemented as `readonly: true` +
  `keepWriteToolNames: [propose_initiative, propose_feature,
  propose_milestone]` + `capabilities: ["canvas"]` (drops the `planner`
  capability so `send_to_feature_planner`, a real Stakwork dispatch, is
  absent). Every genuinely-mutating tool (canvas/feature/research/
  connection writes) is stripped. Response carries `dryRun: true` and
  `conversationId: null`.

- **`maxTurns`** (positive integer, optional) caps the agentic loop by
  appending a `stepCountIs(maxTurns)` stop condition (ANY stop condition
  ends the loop — so the run halts at the model's `[END_OF_ANSWER]` or the
  cap, whichever is first). It counts the agent's **generated steps in
  this call**, NOT the input transcript — so `maxTurns: 1` with a
  100-message replay still returns exactly one step. Lets an evaluator
  score just the next single response/tool-call.

> **Companion docs — read first.**
> - `src/app/org/[githubLogin]/CANVAS_CHAT.md` — the chat subsystem; the org chat → toolset wiring (`runCanvasAgent`, `buildConnectionTools`/`buildCanvasTools`/`buildInitiativeTools`), the `<SubAgentRunCard>` async fan-out.
> - `docs/plans/backend-driven-canvas-turns.md` — the server-as-single-writer turn model this endpoint inherits (`messagesFromSteps` → `appendTurnMessages`, the `${turnId}-` idempotency prefix, the `CANVAS_CONVERSATION_UPDATED` nudge). The sync endpoint is that exact persistence path with the streaming response swapped for an awaited JSON one.

## Why

The mobile app already has its own agent loop with local (device) tools. We
want the canvas agent available to that loop as **one tool**: `ask_canvas`.
A tool is request → response. The streaming endpoint forces the caller to
consume an SSE stream and reassemble it — the worst place to put that logic.

The server already drives generation to completion regardless of the socket
(`result.consumeStream()` + `await result.steps`, see
`backend-driven-canvas-turns.md`), so a synchronous JSON response is
essentially free: await the same `result` we already await for persistence,
serialize it, return it.

This was the motivation for the `route.ts` extraction PR (#4437): the
conversation-row, image-resolution, and turn helpers are now importable
modules so this endpoint can reuse them verbatim instead of duplicating
~150 lines of IDOR-sensitive logic.

## Goal

A mobile/agent caller does:

```
POST /api/ask/sync
{ message, conversationId?, workspaceSlugs[] }
        │
        ▼
{ conversationId, messages: StoredMessage[], title? }
```

- `message` — the user's text for this turn (server-history shape; the
  server reconstructs prior turns from `conversationId`).
- `conversationId` — omit on the first turn (server creates the row and
  returns its id); pass it back on every subsequent turn for continuity.
- `workspaceSlugs[]` — the multi-workspace scope (1–20), same as quick.
- Response `messages` — the finished turn as `StoredMessage[]` (text rows +
  tool-call rows), exactly what `messagesFromSteps` produces and what the
  web store renders. The phone renders these as cards.

No streaming. One round trip per turn.

## The animating principle

**Same engine, same persistence, different transport.** Never fork the
agent. `/api/ask/sync` and `/api/ask/quick` both call one `runCanvasAgent`;
the only divergence is quick returns `result.toUIMessageStreamResponse()`
while sync returns `Response.json(...)` after `await result.steps`.

Corollaries:

- **Stateful, not stateless.** The "tool" is keyed by `conversationId`. The
  server owns history (server-history mode), so the phone never replays the
  transcript. Clarifying questions just round-trip the same `conversationId`.
- **The synchronous response carries only what finished synchronously.** The
  canvas agent's *own* async sub-agents (planner fan-out → `<SubAgentRunCard>`,
  research workers) arrive minutes later via webhook → Pusher. They are
  physically not in this response. The phone subscribes to the conversation's
  updates for those (see "Async tail" below). This is the one hard boundary.

## Scope

- **Authenticated only.** No public-viewer path (that's a streaming,
  workspace-scoped, rate-limited concern). `validateUserBelongsToOrg` +
  per-workspace `validateWorkspaceAccess`.
- **Org-canvas, multi-workspace** is the primary target (the canvas agent
  with `buildCanvasTools`/`buildInitiativeTools`/`buildConnectionTools`).
  Single-workspace works too; it just doesn't merge the org toolset.
- **No enrichments.** `skipEnrichments` is implicit: no follow-up questions,
  no provenance broadcast. The tool caller renders neither.
- **Approvals: out of scope for v1.** Approve/Reject is a web-card
  interaction; `runProposalIntent` returns a synthetic SSE today. A JSON
  variant is a clean follow-up (it already persists + returns a structured
  outcome), not v1.

## What gets added vs. reused

| Layer | New | Reused (unchanged) |
| --- | --- | --- |
| `src/app/api/ask/sync/route.ts` *(new)* | The `POST` handler: parse `{ message, conversationId?, workspaceSlugs[] }`, auth, build messages, run the agent, **await** completion, persist, return JSON. | — |
| auth | — | `validateUserBelongsToOrg`, `validateWorkspaceAccess` |
| message build | — | `fetchStoredConversationMessages` + `toModelMessages` (server-history mode, already in `quick`), then append the new user turn |
| image attachments | — | `resolveMessageImageUrls` (lib/ai/resolveMessageImages.ts) |
| conversation row | — | `loadOrgCanvasPromptCache`, `persistCanvasUserMessage`, `resolveOrgConversationRowId` (services/org-canvas-conversation.ts) |
| agent | — | `runCanvasAgent` (with `silentPusher: false` so open web tabs still animate; `skipEnrichments` effectively true by not running the enrichment `after()`) |
| turn → rows | — | `messagesFromSteps` + `appendTurnMessages` (services/canvas-turn-persistence.ts) |
| prompt cache | — | `persistOrgCanvasPromptCache` + `hasConcepts` |
| middleware | Add `/api/ask/sync` to `ROUTE_POLICIES` in `src/config/middleware.ts` (auth-required). | — |
| `prisma/schema.prisma` | None. | — |

The point of the extraction PR: this column of "reused" is almost the whole
endpoint. The new file is mostly orchestration glue.

## The flow

```
POST /api/ask/sync  { message, conversationId?, workspaceSlugs[] }
  • authenticate (session required)  → userId
  • validateUserBelongsToOrg(orgId) + validateWorkspaceAccess(each slug)
  • turnId = uuid()
  • promptCache = loadOrgCanvasPromptCache({ conversationId, userId, orgId })
  • messages = serverHistory(conversationId) + { role:"user", content:message }
  • resolveMessageImageUrls(messages)
  • rowId = persistCanvasUserMessage({ ... existingRowId: promptCache?.rowId, turnId })  (SYNC)
  • result = runCanvasAgent({ messages, ..., silentPusher:false, currentCanvasConversationId: rowId })
  • await result.consumeStream(); steps = await result.steps          ◄── the only difference vs quick
  • rows = messagesFromSteps(steps, `${turnId}-a`)
  • appendTurnMessages({ conversationId: rowId, rows, idPrefix:`${turnId}-a`, reason:"user-turn" })
  • (best-effort) persistOrgCanvasPromptCache(...) when cache miss + non-empty
  • return Response.json({ conversationId: rowId, messages: rows, title })
```

The persistence half is byte-for-byte the backend-driven turn from
`backend-driven-canvas-turns.md` — just inline-awaited instead of deferred to
`after()`, since there's no stream to return first.

## Async tail (the one thing a tool can't return)

When the agent files a feature under an initiative, the **planner** runs
asynchronously: its reply comes back via the `/api/chat/response` webhook →
`fanOutPlannerMessageToCanvas` → `CANVAS_CONVERSATION_UPDATED` Pusher nudge,
*minutes* after `/api/ask/sync` already returned. The synchronous response
cannot contain it.

The phone handles it the same way the web `useCanvasChatAutoSave` live-sync
does — pick one:

1. **Poll** the conversation read endpoint
   (`GET /api/orgs/[githubLogin]/chat/conversations` / the conversation GET)
   and merge new `${...}` rows by id. Simplest; fine for a mobile cadence.
2. **Subscribe** to the workspace/conversation Pusher channel and refetch on
   the nudge. Lower latency; more client wiring.

Either way the contract is: the sync call returns the *immediate* turn;
later sub-agent rows (clarifying-question FORMs, task breakdowns, plan posts)
land on the conversation and are fetched out-of-band. Document this clearly
in the tool's description so the phone's outer agent knows a feature-filing
turn is "accepted, results follow" rather than "complete."

## Clarifying questions

These work cleanly *because* the endpoint is `conversationId`-stateful:

- The agent asks → the question is in the returned `messages` (a text row, or
  a tool-call/FORM artifact row).
- The phone surfaces it to the user (or its outer agent answers from context).
- The user's answer → another `POST /api/ask/sync` with the **same**
  `conversationId`. The server rehydrates history and continues.

No transcript replay, no lost state. Forward the user's text verbatim where
possible — paraphrasing through the phone's outer LLM degrades the thread.

## Resolved design decisions

1. **Reuse server-history mode, don't invent a payload.** `/api/ask/quick`
   already accepts `{ message, conversationId, workspaceSlugs[] }`
   (`isServerHistoryMode`). `/api/ask/sync` uses the identical shape so the
   two share the message-build path; the only response difference is JSON vs
   SSE. (Consider extracting the shared "build ModelMessage[] from
   server-history" step into a helper if the duplication is non-trivial.)

2. **Return `StoredMessage[]`, not a bespoke artifact schema.** That's
   already the persisted/rendered shape (`messagesFromSteps`), it carries
   tool calls (the artifact source), and it means the phone and web render
   from the same contract. No translation layer.

3. **Still set `maxDuration`.** The handler awaits the full generation
   in-request (no `after()` deferral), so the request itself is as long as the
   turn. Set `maxDuration` generously (match quick's headroom). A turn longer
   than that is the only failure mode, same as quick.

4. **Separate route file, shared helpers — not a flag on quick.** `quick`'s
   `POST` is already large with streaming-specific machinery (the enrichment
   `after()`, Pusher follow-ups, public-viewer budget gate). A dedicated
   `sync` route that imports the same helpers stays readable and lets it skip
   all the streaming/public concerns outright.

5. **`silentPusher: false`.** A sync turn from the phone should still animate
   any open web canvas tab (HIGHLIGHT_NODES etc.), exactly like a quick turn —
   it's the same conversation.

## Testing

- Unit: the new route's message-build (server-history + appended user turn)
  and the `messagesFromSteps` → JSON serialization (reuse existing
  `canvas-turn-persistence` coverage for the row shaping).
- Integration: `POST /api/ask/sync` with no `conversationId` → row created,
  `conversationId` returned, user row persisted, assistant rows present in the
  response **and** in `SharedConversation.messages`.
- Integration: second `POST` with the returned `conversationId` → history
  continuity (the agent sees the prior turn).
- Integration: non-member / cross-org `conversationId` → IDOR-safe (creates a
  fresh row owned by the caller, never reads the other's; mirrors
  `persistCanvasUserMessage`).
- Integration: feature-filing turn → response returns immediately; the
  planner row lands on the conversation later (assert via the conversation
  GET after the webhook fires) — proves the async-tail contract.
- Middleware: `/api/ask/sync` rejects unauthenticated requests (401).

## Implementation order

1. Add `/api/ask/sync` to `ROUTE_POLICIES` (auth-required).
2. New `src/app/api/ask/sync/route.ts`: auth + server-history message build +
   `resolveMessageImageUrls` + `persistCanvasUserMessage` +
   `runCanvasAgent` + `await steps` + `messagesFromSteps` +
   `appendTurnMessages` + prompt-cache persist; return JSON. Reuse every
   helper from the extraction PR.
3. Tests (unit + integration) per above.
4. (Follow-up, separate PR) JSON variant of `runProposalIntent` for
   Approve/Reject from the phone.
5. (Phone side, out of this repo's scope) the `ask_canvas` tool + the
   async-tail subscription/poll.
