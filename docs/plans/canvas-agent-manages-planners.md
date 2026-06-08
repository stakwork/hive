# Canvas Agent Manages Planners

The canvas agent's relationship with the per-feature planner agents becomes a first-class, persistent, conversational hierarchy. Every message a planner emits — clarifying-question FORM, plan summary, intermediate update, "ready for architecture?" — lands in the parent canvas conversation as a sub-conversation thread. The canvas agent triages those threads according to the user's standing policy in this conversation: auto-respond when it can, escalate when the user must decide, stay silent on noise.

The user's window into all of this is a single **collapsible per-feature card** in the canvas chat — one card per feature the canvas agent is managing, persistent for the lifetime of the conversation, moved to the bottom whenever it has new activity, default-collapsed (just `feature name · workspace · status`) and click-to-expand for the full thread. FORM artifacts override the collapse and surface directly because they're the explicit "user must answer" signal.

Status: **in progress** (Phases 1–3 shipped; Phase 4 not started).

> **Progress at a glance**
> - ✅ **Phase 1** — collapse-by-default `SubAgentRunCard` with one-line headline. Shipped.
> - ✅ **Phase 2** — `Feature.parentCanvasConversationId` schema + ownership claims (eager on approval, lazy on `send_to_feature_planner`), fan-out worker (`src/services/canvas-planner-fanout.ts`), `SELECT ... FOR UPDATE` serialization on the autosave PUT, `CanvasMessageSource` discriminated union on `CanvasChatMessage`, inbound thread entries in the card, render-side filter in `SidebarChat`. Shipped.
> - ✅ **Phase 3** — `invokeCanvasAgentOnPlannerMessage` (`src/services/canvas-agent-autoturn.ts`) + `stay_silent` tool + `additionalTools` plumbing in `runCanvasAgent` + actionable-detection wire-in (`actionableWakeReason`) in the fan-out worker + prompt paragraph in `getCanvasPromptSuffix` + `CANVAS_AUTONOMOUS_TURNS_ENABLED` env gate + kill-switch/classifier unit tests. Shipped (env defaults off). See **Phase 3 implementation notes** below for deviations.
> - ⬜ **Phase 4** — `PlannerFormSlot` + `POST /api/orgs/[githubLogin]/planner-forms/answer` endpoint. Not started.
>
> Phase 2's fan-out is unconditional — planner ASSISTANT messages always land in the parent canvas conversation. Phase 3's autonomous-response layer sits on top, gated by `CANVAS_AUTONOMOUS_TURNS_ENABLED` (default `"false"`): until the env is flipped on, the user still prompts the canvas agent manually to handle anything they see in the cards.

> **Companion docs — read first.**
> - `docs/plans/cross-workspace-initiatives.md` — the manager-of-planners framing this builds on, the `send_to_feature_planner` tool, the prompt vocabulary, the `<slug>__read_feature` chat-history-read primitive.
> - `docs/plans/canvas-feature-node-chat.md` — the per-feature plan chat surface (`FeaturePlanChat.tsx` and `FeaturePlanChatMessage.tsx`) and the `ClarifyingQuestionsPreview` renderer. Everything FORM-related below reuses these.
> - `docs/plans/canvas-sidebar-chat.md` — `CanvasChatMessage` shape, `SharedConversation.messages` JSON round-trip, autosave write semantics, `?chat=<shareId>` share/fork mechanics. The fan-out in this doc has to coexist with that autosave path.
> - `src/app/org/[githubLogin]/CANVAS.md` — proposal lifecycle, `approvalResult` on canvas messages, the `AttentionList` synthetic intro, "side-channel DB writes from canvas interactions" gotcha. The fan-out is exactly that gotcha applied to planner-driven writes.
>
> **Out of scope (deliberately):** an autonomous-invocation cron of any kind (we're event-driven on planner writes, not time-driven); cross-org bubble-up (a feature only escalates into canvas conversations within its own org); editing planner messages or plan text from the canvas chat (canvas agent never writes to a planner's chat history except via `send_to_feature_planner`); a "running planner" presence indicator beyond the card's headline pill; multi-tenant ownership beyond singular (`Feature.parentCanvasConversationId` is one-to-one in v1 — see "Future seams" for why); cancel/abort of an in-flight planner from the canvas card; replaying old planner FORMs into a fresh canvas conversation forked from `?chat=<shareId>` (forks start fresh; their planners are no longer "managed by" the fork).

## Goal

Three concrete UX moments this plan unlocks:

1. **Spin up, walk away, come back.** *"Propose three features for billing v2."* User approves. Walks away. Comes back 20 minutes later. Each card in the canvas chat shows the latest status: one *waiting for your input* (the planner asked a non-procedural FORM), one *plan ready* (the canvas agent auto-said "proceed to architecture" and the planner completed), one *still working* (planner mid-run). User clicks the *waiting for you* card, answers the FORM in place, moves on.

2. **Cross-feature alignment without context-switching.** *"The backend just picked `userId` — tell the other two planners to align."* User types this in canvas chat. Canvas agent calls `send_to_feature_planner` against the two siblings. Each appears as a new outbound entry in the respective cards' threads. Their planners reply; replies land as inbound entries in the same cards. User watches the cards update without ever opening a feature page.

3. **Voice / iOS at data parity.** User in Carplay says *"any feature need my input?"* The voice surface reads the canvas chat aloud. The chat is just messages with `source`-marked rows — same data the browser shows — and iOS reads `SharedConversation.messages` already. No new transport, no new endpoint, no per-surface protocol work. iOS does need to add a `SubAgentRunCard` renderer for the new `source.kind` rows to render *visually* (text-only iOS surfaces work transparently); that's a parallel iOS-side task on top of this plan's web work.

## The animating principle

**The chat IS the inbox; the agent's transcript IS the audit trail; the card IS the sub-conversation.**

Three corollaries that drive every design decision below:

- **No new transport.** Whatever the planner writes ends up as a row in the canvas conversation's `messages` JSON via a server-side fan-out. The browser/iOS reads `SharedConversation.messages` like it always has; cards render off message metadata. No Pusher subscription on the canvas chat side, no event-stream protocol, no reconnection logic. *The trigger for the fan-out is the planner's chat-message write, not a polling loop.*
- **The canvas agent's autonomous turn is event-driven, not time-driven.** When a planner message lands in a canvas conversation AND the message contains a signal worth acting on (FORM artifact, question, workflow-state transition), the fan-out worker invokes the canvas agent on that conversation server-side. Pure prose status updates fan out but don't wake the agent. **The fan-out is dumb; the agent's invocation is selectively triggered; the agent's prompt is what decides what to do.**
- **Cards are pure projections of the conversation, like proposals.** No new store slice in `canvasChatStore`. The card extractor reads `message.toolCalls[]` (for outbound `send_to_feature_planner`) AND a new `message.source` marker (for inbound planner messages) and groups by `featureId`. Identical pattern to `getProposalsFromMessage` and the existing `getSubAgentRunsFromMessages`. The store stays unaware; the UI is a function of the transcript.

## What gets added vs. unchanged

Status legend: ✅ shipped (Phase 2 cut) · 🟡 partially shipped · ⬜ not started.

| Layer | New | Unchanged |
| --- | --- | --- |
| `prisma/schema.prisma` | ✅ One column on `Feature`: `parentCanvasConversationId String? @map("parent_canvas_conversation_id")` plus an index. ✅ One column on `CanvasChatMessage`'s JSON shape (`source?: CanvasMessageSource`) — no migration, just a TS type addition since `messages` is `Json`. | Everything else. No new model, no new relation table (singular ownership in v1 — see "Future seams" for the join-table promotion path). |
| `src/lib/proposals/types.ts` | No change. `CanvasMessageSource` lives next to `CanvasChatMessage` in `canvasChatStore.ts` (it's a property of the message shape, not a proposal type). Ownership lookup is a server-side indexed read of `Feature.parentCanvasConversationId`, not a client-side message-scan helper. | All proposal types; `ApprovalResult.kind === "feature"` + `createdEntityId` is already what `handleApproval` uses to set ownership at create time. |
| `src/lib/proposals/handleApproval.ts` | ✅ Optional `conversationId?` added to `HandleApprovalArgs` and threaded into `approveFeature`. On feature approval, populates `Feature.parentCanvasConversationId = conversationId` (non-fatal — caught + logged). | Everything else. |
| `src/app/api/ask/quick/route.ts` | ✅ Validates body `conversationId` via the existing `resolveTokenAttributionRowId` *before* forwarding it on both the approval path (→ `handleApproval`) and the canvas-agent path (→ `runCanvasAgent.currentCanvasConversationId`). Prevents a malicious caller laundering ownership into someone else's conversation. | The route's overall shape, the streaming SSE assembly, the token-attribution `onFinish` hook. |
| `src/lib/ai/runCanvasAgent.ts` | ✅ Added `currentCanvasConversationId?` to `RunCanvasAgentOptions`. Forwarded into both `buildInitiativeTools(orgId, userId, currentCanvasConversationId)` call sites (multi-WS + single-WS branches). | Everything else; tool assembly, prefix-message composition, streamText loop. |
| `src/lib/ai/initiativeTools.ts` | ✅ Optional third arg on `buildInitiativeTools`. `send_to_feature_planner` selects `parentCanvasConversationId` from the feature row and lazy-claims ownership when null + a current id is present. Never steals an existing claim. Non-fatal on update failure. | The tool's signature for callers (third arg defaults to `undefined`, backwards-compat with existing test callers). |
| `src/services/roadmap/feature-chat.ts` | No change — `sendFeatureChatMessage` only writes USER messages (the kick-off prompt). The planner's ASSISTANT reply lands via the Stakwork webhook write path; that's the only fan-out site. | Everything; the per-feature chat experience is untouched. |
| `src/app/api/chat/response/route.ts` | ✅ After the existing `featureId` Pusher trigger and before the notification dispatcher, loads `{ id, parentCanvasConversationId, workspaceId }` and calls `fanOutPlannerMessageToCanvas(feature, chatMessage)`. Wrapped in try/catch — never blocks the webhook response. | The webhook's primary control flow (artifact processing, PLAN-XML parsing, Pusher fan-out, notifications). |
| `src/services/canvas-planner-fanout.ts` | ✅ **New.** ~265 lines. Owns the fan-out worker: short-circuits when no parent; opens `db.$transaction` with `SELECT ... FOR UPDATE` on `shared_conversations`; idempotency-checks via `source.plannerMessageId`; appends a `planner`-source `CanvasChatMessage` row to `messages` JSON; bumps `lastMessageAt`. Failure-tolerant (caught + logged at top level). ✅ Phase 3 hook wired: after a fresh append, `actionableWakeReason(feature, plannerMessage)` classifies the message (FORM → `form`; terminal `workflowStatus` → `completed`/`failed`/`halted`; trailing-`?` → `question`; else `null`) and, when non-null, lazily `import()`s + calls `invokeCanvasAgentOnPlannerMessage`. The lazy import keeps `runCanvasAgent`'s heavy module graph out of the webhook route's static import chain. | — |
| `src/services/canvas-agent-autoturn.ts` | ✅ **New.** ~520 lines. Server-side entry point for invoking the canvas agent without an HTTP user: env-gated, takes a best-effort per-conversation advisory lock, rebuilds the canvas-chat context from `SharedConversation` (owner `userId`, `sourceControlOrgId`, primary slug + `settings.extraWorkspaceSlugs` + the feature's slug), prepends a synthetic `system` wake message describing *why* the agent was woken, calls `runCanvasAgent` (with the `stay_silent` tool via `additionalTools`), reconstructs `CanvasChatMessage` rows from the finished stream's `steps`, and appends them under the same `SELECT ... FOR UPDATE` lock. Reuses the existing `runCanvasAgent` loop end-to-end — no new agent logic. | The existing `/api/ask/quick` user-driven path; this is a parallel entry point with the same target. |
| `src/app/org/[githubLogin]/_components/SubAgentRunCard.tsx` | ✅ Phase 1 — collapsed-by-default with one-line headline. ✅ Phase 2 — extractor reads inbound `source.kind === "planner"` messages and threads them with `direction: "in"`, anchor advances to the freshest entry, render alternates `→` / `←`, headline says `"Replied"` when latest entry is inbound, status icon switches to a green check. ⬜ Phase 3 — meaningful status pill (`running` / `waiting for you` / `failed`) once auto-turns ship. ⬜ Phase 4 — FORM artifacts on the most recent inbound entry render OUTSIDE the collapse via `PlannerFormSlot`. | The rendering primitives — the card's visual idiom is established; remaining phases extend it without rewriting. |
| `src/app/org/[githubLogin]/_components/SidebarChat.tsx` | ✅ Filter `message.source?.kind === "planner"` AND `"user-answered-planner-form"` rows out of the main scroll (forward-compat for Phase 4). Card-per-feature placement: anchor advances to the most recent activity message for each feature (extractor side). | The main message-render loop and proposal-card render arm. |
| `src/app/org/[githubLogin]/_components/PlannerFormSlot.tsx` | ⬜ **Not started.** ~80 lines. Renders the planner's most recent unanswered FORM artifact as an inline answer-this-now card, sitting just outside the collapsed `SubAgentRunCard`. Reuses `ClarifyingQuestionsPreview` verbatim. On submit, calls a new `POST /api/orgs/[githubLogin]/planner-forms/answer` endpoint that both forwards to `sendFeatureChatMessage` and appends a `source: { kind: "user-answered-planner-form", ... }` message to the canvas conversation. | — |
| `src/app/api/workspaces/[slug]/chat/conversations/[conversationId]/route.ts` | ✅ PUT's read-modify-write wrapped in `db.$transaction` with `SELECT messages FROM shared_conversations WHERE id = ? FOR UPDATE`. Ownership check stays outside the transaction; lock + re-read + append + write run inside. Matches the lock in `fanOutPlannerMessageToCanvas` so both writers serialize on the same Postgres row. **No 409s, no client-visible conflict.** | The endpoint contract; existing callers see no shape change. |
| `src/lib/constants/prompt.ts` | ✅ **Phase 3.** New `#### When a planner wakes you (not the user)` subsection in `getCanvasPromptSuffix()` teaching the agent that auto-invocation exists and how to pick between respond-to-planner / escalate / `stay_silent`, with the FORM-is-escalation-only rule called out. | All other prompt sections, including the existing manager-of-planners loop and the brevity rules. |
| `src/lib/ai/runCanvasAgent.ts` | ✅ **Phase 3.** Added `additionalTools?: ToolSet` to `RunCanvasAgentOptions`, merged into the toolset *after* the `readonly` strip so injected tools (the auto-turn's `stay_silent`) always survive. | Everything else; tool assembly, prefix composition, streamText loop. |

## The animating diagram

```
                  ┌─────────────────────────────────────────┐
                  │            CANVAS CONVERSATION          │
                  │                                         │
                  │  user: "build feature X, manage it"     │
                  │  assistant: "Proposed!"  [propose card] │
                  │  user: [Approve]                        │
                  │  assistant: "Created feature X. ..."    │
                  │  ┌─────────────────────────────────┐    │   ← SubAgentRunCard
                  │  │ ↻ Feature X · web · running     │    │     (collapsed)
                  │  └─────────────────────────────────┘    │
                  │  user: "anything urgent?"               │
                  │  assistant: "Two replied, one waiting." │
                  │  ┌─────────────────────────────────┐    │   ← FORM artifact
                  │  │ Feature Y · web · WAITING ►     │    │     surfaces outside
                  │  │ ┌─────────────────────────────┐ │    │     collapse
                  │  │ │ Should we use Stripe or...? │ │    │
                  │  │ │ [Stripe]  [Adyen]  [Other]  │ │    │
                  │  │ └─────────────────────────────┘ │    │
                  │  └─────────────────────────────────┘    │
                  │  ┌─────────────────────────────────┐    │
                  │  │ ✓ Feature Z · infra · replied   │    │
                  │  └─────────────────────────────────┘    │
                  └─────────────────────────────────────────┘
                          ▲                    ▲
                          │ fan-out            │ user response routed
                          │ on every           │ to planner via
                          │ planner            │ POST /features/.../chat
                          │ ASSISTANT          │ + recorded in canvas
                          │ message            │
                          │                    │
        ┌─────────────────┴────┐    ┌──────────┴──────────┐
        │  PLANNER (Feature X) │    │ PLANNER (Feature Y) │  ...
        │  ASSISTANT messages  │    │ ASSISTANT messages  │
        │  emitted into the    │    │ emitted into the    │
        │  feature's own chat  │    │ feature's own chat  │
        └──────────────────────┘    └─────────────────────┘
```

**The fan-out is one-directional and write-only.** Planners don't read the canvas conversation; they just write to their own chat and a worker echoes that write into the parent canvas. The canvas agent — when woken by an actionable echo — can reply by calling `send_to_feature_planner`, which writes a USER message to the planner's chat. **No bidirectional sync, no event bus, no shared state.** Two strict writers, both writing the same message into two places: their own chat and the parent canvas conversation.

## Phase 1 — Card upgrade (UI-only, zero new server) ✅ SHIPPED

Highest-leverage shippable step. Validates the visual idiom before any infrastructure exists. **No fan-out, no inbound messages yet** — the card still only reflects outbound `send_to_feature_planner` calls, but with the new collapsed-by-default chrome.

### What's already in the current branch

`canvas-agent-planner-ui` ships `SubAgentRunCard` with the outbound-only extractor + thread renderer + status icon, plus the prompt + FORM-artifact + tool-output-extension work. Phase 1 is the **collapse / expand** upgrade on top of what already exists. Do not rewrite the extractor or the per-tool-call data shape; just add the collapse state and the headline rendering.

### `SubAgentRunCard.tsx` changes

Add a `collapsed: boolean` local state, default `true`. When collapsed: one line — `<icon> Feature title · workspace · headline status`. When expanded: the existing thread view. Click the header (anywhere except the "Open feature" link) to toggle.

The headline status today says *"Sent · waiting for reply"* for a single outbound call. After Phase 1 it should still say that — the meaningful status-pill states (`replied`, `waiting for you`) materialize once Phase 2 brings inbound messages into the extractor. Phase 1's job is just **shape: collapse + headline placeholder + click-to-toggle**.

The card already moves down with the latest send (`anchorMessageId = message.id` on the most recent matching tool call — see `SubAgentRunCard.tsx:150` and the surrounding `existing` branch). Phase 1 inherits this for free.

### Validation

Open a feature's planner from the canvas chat, send 2-3 messages to it via `send_to_feature_planner` (manually if needed), confirm the single card sits collapsed under the most recent send showing one line, click to expand and see all three sends, click to collapse again. Visual review only — no tests beyond `npm run test:unit` not breaking.

### What ships at end of Phase 1

A noticeably cleaner canvas chat. The "agent did 3 things on my behalf" noise collapses into one line until the user clicks. Functionally equivalent to today otherwise. ~3 hours of work.

## Phase 2 — Fan-out + inbound thread (server, makes planner messages visible) ✅ SHIPPED

The real foundation. Planners post a message → it appears as an inbound thread entry in the parent card. No autonomous canvas-agent invocation yet — the user manually prompts the canvas agent to handle anything they see.

> **Implementation notes (post-ship).**
> - One deviation from the plan as written: the original Phase 2 text said the fan-out call should be wired into both `sendFeatureChatMessage` *and* the Stakwork webhook. In practice `sendFeatureChatMessage` only commits USER messages (the kick-off prompt). The single ASSISTANT-write path for planner replies is the Stakwork webhook at `src/app/api/chat/response/route.ts`, so the fan-out call lives only there. Open question #2 ("webhook write path coverage") is resolved by inspection: no other `featureId`-scoped ASSISTANT writes exist in the codebase as of the Phase 2 ship.
> - Ownership-claim flow has a security wrinkle the plan only hinted at: `conversationId` from the request body must be validated against the caller before being stamped onto `Feature.parentCanvasConversationId`, otherwise a malicious client could launder ownership into someone else's conversation. `/api/ask/quick/route.ts` reuses the existing `resolveTokenAttributionRowId` helper for this — both in the approval path (before forwarding to `handleApproval`) and in the canvas-agent path (the validated id becomes `currentCanvasConversationId` passed into `runCanvasAgent` → `buildInitiativeTools`). See `src/app/api/ask/quick/route.ts` and `src/lib/proposals/handleApproval.ts:HandleApprovalArgs.conversationId` for the contract.
> - Migration: `prisma/migrations/20260529000000_add_feature_parent_canvas_conversation_id/migration.sql`.

### Schema: `Feature.parentCanvasConversationId`

```prisma
model Feature {
  // …existing fields…

  /**
   * The canvas conversation (`SharedConversation.id`) that "owns" this
   * feature — typically the one where the user approved the
   * `propose_feature` proposal that created the row. Populated by
   * `handleApproval.approveFeature` at create time; also populated
   * lazily by `send_to_feature_planner` if a canvas conversation
   * messages a planner for a feature that wasn't proposed here.
   *
   * Fan-out: when this feature's planner writes an ASSISTANT
   * message, the worker appends a `CanvasChatMessage`-shaped row
   * to the owning conversation's `messages` JSON.
   *
   * **Singular in v1.** If multiple canvas conversations both message
   * this planner, only the first to claim ownership wins; subsequent
   * sends still go through (the canvas agent can message any
   * feature) but their planner replies fan out only to the original
   * owner. See "Future seams" for the join-table promotion path.
   *
   * Null = unowned (created from the per-feature plan page, or from
   * any non-canvas surface). No fan-out happens.
   */
  parentCanvasConversationId String?  @map("parent_canvas_conversation_id")

  @@index([parentCanvasConversationId])
}
```

No FK to `SharedConversation` for now — conversations can be deleted (user clears chat) and we don't want a cascade or a hard error blocking deletion. Soft reference; the fan-out worker treats a missing conversation as "no-op."

### `handleApproval.approveFeature` — populate on create

In `src/lib/proposals/handleApproval.ts:approveFeature`, after `createFeature` returns the new row, persist the ownership:

```ts
await db.feature.update({
  where: { id: created.id },
  data: { parentCanvasConversationId: conversationId },
});
```

`conversationId` is the `SharedConversation.id` the route's pre-LLM `handleApproval` step is operating on — already available in the surrounding closure. ~3 lines.

### `send_to_feature_planner` — claim ownership lazily

In `src/lib/ai/initiativeTools.ts:send_to_feature_planner`'s execute body, after the auth/IN_PROGRESS checks pass and before delegating to `sendFeatureChatMessage`, claim ownership if absent:

```ts
if (!feature.parentCanvasConversationId && currentCanvasConversationId) {
  await db.feature.update({
    where: { id: featureId },
    data: { parentCanvasConversationId: currentCanvasConversationId },
  });
}
```

This requires plumbing `currentCanvasConversationId` into `buildInitiativeTools(orgId, userId)` from the `/api/ask/quick` route — one more arg. The route already knows the conversation id; today it just doesn't pass it down. ~5 lines including the plumbing.

**Why claim lazily.** Without this, a canvas agent operating in a fresh conversation that messages a pre-existing feature (e.g. one created from the per-feature plan page) would never see replies in its chat. Claiming ownership on first `send_to_feature_planner` is symmetric with claiming on first `propose_feature` approval — both mean "this canvas conversation is now actively managing this feature."

### Fan-out worker: `src/services/canvas-planner-fanout.ts`

```ts
/**
 * Append a planner's chat message into its parent canvas
 * conversation, if any. Idempotent on (conversationId, plannerMessageId).
 *
 * Called immediately after a planner ASSISTANT message is committed
 * (the only USER messages a planner's chat sees come from the
 * canvas agent's `send_to_feature_planner` or the user's plan-page
 * chat, neither of which we mirror back upward — those are
 * already in the canvas conversation as their original source).
 *
 * Failure-tolerant: any error is logged but never blocks the
 * planner's own write. The planner's chat history is the source
 * of truth for plans; the canvas conversation is a derived
 * surface. A missed fan-out leaves the canvas conversation
 * incomplete for one message — the user can prompt the canvas
 * agent to `read_feature` to recover the missing context, and
 * any subsequent planner message will fan out successfully.
 */
export async function fanOutPlannerMessageToCanvas(
  feature: { id: string; parentCanvasConversationId: string | null; workspaceId: string },
  plannerMessage: ChatMessage & { artifacts: Artifact[] },
): Promise<void>;
```

Implementation outline:

1. If `feature.parentCanvasConversationId` is null → return.
2. Fetch the canvas conversation. If missing → return.
3. Compose a `CanvasChatMessage`-shaped object: `role: "assistant"`, `content: plannerMessage.message`, plus `source: { kind: "planner", featureId, plannerMessageId: plannerMessage.id }` and any FORM artifacts on the planner message attached as an `artifactIds[]` entry (registered in the same shape `attention-list` uses).
4. Inside a transaction: read `messages` JSON, check if any existing entry has `source.plannerMessageId === plannerMessage.id` (idempotency); if not, append + write back; bump `lastMessageAt`.
5. After the write: if the message is "actionable" (FORM artifact present, OR the text ends with `?`, OR the planner's `workflowStatus` transitioned to `COMPLETED`/`FAILED`/`HALTED`), call `invokeCanvasAgentOnPlannerMessage(conversationId, plannerMessage)`. **Phase 2 deliberately stubs this call to a no-op** — Phase 3 implements the function body, gated by `CANVAS_AUTONOMOUS_TURNS_ENABLED` so it stays effectively a no-op in production until explicitly flipped on.

### `CanvasChatMessage.source` — the marker

New optional field on the TS type in `canvasChatStore.ts`. Round-trips through `SharedConversation.messages` JSON for free (it's just a Zod-untyped object). Schema-side: nothing — the column is already `Json`.

Defined as a discriminated union so Phase 4's `user-answered-planner-form` variant can be added without breaking Phase 2 consumers:

```ts
export type CanvasMessageSource =
  | { kind: "planner"; featureId: string; plannerMessageId: string }
  // Added in Phase 4 — kept here to make the union exhaustive from
  // the start. Render-side filters use `source.kind` directly.
  | { kind: "user-answered-planner-form"; featureId: string; plannerMessageId: string };

export interface CanvasChatMessage {
  // …existing fields…
  source?: CanvasMessageSource;
}
```

Filter in `SidebarChat.tsx`'s main render loop:

```ts
// Planner-sourced messages are rendered inside SubAgentRunCard
// (their feature's card), not as top-level chat bubbles. They
// stay in the messages array so the extractor can find them and
// so they round-trip through autosave / share.
if (message.source?.kind === "planner") return null;
```

Mirrors how today's render suppresses user messages bearing `approval`/`rejection` intents (`SidebarChat.tsx:204-211` — the `if (message.role === "user" && (message.approval || message.rejection))` early-return).

### Card extractor: read inbound entries

`SubAgentRunCard.tsx:getSubAgentRunsFromMessages` extends its walk: in addition to `tc.toolName === SEND_TO_FEATURE_PLANNER_TOOL`, it also reads `message.source?.kind === "planner"` rows. Each becomes an inbound thread entry — direction `"in"` instead of `"out"`. The `featureId` discriminator is `message.source.featureId`.

Thread entries get a direction:

```ts
interface RunMessage {
  direction: "out" | "in";  // out = canvas agent → planner; in = planner → canvas
  // …rest unchanged
}
```

Sort by `messageIndex` (chronological). The card's render walks the list and alternates direction marker (`→` outbound, `←` inbound).

### Serialized appends to the conversation row

The canvas chat's autosave is a client-driven append-only PUT (`useCanvasChatAutoSave.ts`). The fan-out worker is a server-side append-only write to the same `messages` JSON. **Both can race.** Today the PUT is read-modify-write with no row-level lock (`route.ts:202-219`); a concurrent fan-out can be silently overwritten.

Fix: wrap both write paths in `db.$transaction` with a row-level lock on the conversation row.

```ts
await db.$transaction(async (tx) => {
  const row = await tx.$queryRaw<{ messages: unknown }[]>`
    SELECT messages FROM shared_conversations WHERE id = ${id} FOR UPDATE
  `;
  const merged = [...(row[0].messages as any[]), ...newMessages];
  await tx.sharedConversation.update({
    where: { id },
    data: { messages: merged, lastMessageAt: new Date() },
  });
});
```

Both writers append (never reorder), so the only "conflict" is arrival order — the row-level lock serializes them and both appends land in arrival order. **No 409s, no client retries.** Net cost: a couple ms per write while the lock is held. Worth it; the alternative (losing planner messages) is unacceptable.

### What ships at end of Phase 2

Planners are now visible in the canvas chat. A user who proposed three features and walked away comes back to three cards, each showing the full back-and-forth (one card per feature, threads collapsed). No FORM rendering yet (Phase 4) and no autonomous canvas-agent responses (Phase 3) — the user still has to manually prompt the canvas agent to handle anything they see. But the **data foundation is real**: every planner action is in the parent canvas transcript, share/fork preserves it, and any client (browser, iOS, future surfaces) reading `SharedConversation.messages` sees the same `source`-marked rows.

## Phase 3 — Canvas agent autonomous invocation ✅ SHIPPED

The triage layer. Wakes the canvas agent server-side on actionable planner messages. The agent reads the conversation and decides what to do — exactly like it does on user-driven turns. **No policy extractor, no classification step.** The user's standing instructions are already in the conversation; the agent already reads the conversation; the prompt teaches it how to behave when the wakeup was machine-driven instead of user-driven.

> **Phase 3 implementation notes (post-ship).** Deviations from the plan as written below:
> - **Advisory lock is best-effort, not the full TTL-watchdog described under "Per-conversation locking."** `invokeCanvasAgentOnPlannerMessage` uses `pg_try_advisory_lock(hashtext("canvas-autoturn:" + conversationId))` / `pg_advisory_unlock` around the turn, with the lock *never* held across the LLM call inside a DB transaction (that would pin a connection for the whole turn). Because Postgres session advisory locks are connection-scoped and Prisma pools connections, the lock/unlock may land on different pooled connections — so this is best-effort, not a hard mutex. Accepted for v1: gated behind the kill switch, worst case is one redundant auto-turn (the agent reads the full conversation and can `stay_silent`). The watchdog-TTL hardening is a future seam. Idempotency on the `autoturn-<plannerMessageId>-` id prefix (checked both before the LLM call and inside the final append transaction) is the real double-fire guard.
> - **Synthetic wake context is a prepended `system` `ModelMessage`**, not an addition threaded through `getMultiWorkspacePrefixMessages`. `runAutoTurn` builds `[buildWakeMessage(...), ...toModelMessages(storedMessages)]` and passes it as `messages`; `runCanvasAgent` prepends its normal prefix in front of that, so the agent sees `[full canvas system prompt] + [wake system message] + [conversation]`.
> - **`stay_silent` is injected via the new `runCanvasAgent` `additionalTools` option** (merged after the `readonly` strip), not baked into `buildInitiativeTools`. Keeps it scoped to auto-turns only.
> - **No `.env.example` file** exists in the repo (all `.env*` are gitignored). The env var is read directly via `process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED` and documented in the autoturn file header + the kill-switch code comment. Operators set it in their own env.
> - **No tiered/cheaper model for auto-turns** (the "Cost shape" mitigation knob) — auto-turns use the same model as user-driven canvas turns. Deferred until cost is measured.
> - **The Phase-3 `SubAgentRunCard` status pill** (`running` / `waiting for you` / `failed`) was **not** added. The card's headline already advances when the auto-turn appends outbound `send_to_feature_planner` entries or the inbound planner message, so the existing Phase-2 headline logic covers the common cases; the dedicated pill is folded into Phase 4 (it needs the FORM-awareness `PlannerFormSlot` brings anyway).
> - **Actionable classification also treats `ERROR`** (not just `COMPLETED`/`FAILED`/`HALTED`) as a terminal wake reason, mapped to `"failed"` — `ERROR` is a real terminal `WorkflowStatus` value and would otherwise be silently dropped.

### Why no policy extractor

The instinct to write a regex (or a small LLM call) that classifies the user's intent into a typed `AutonomyPolicy` object before invoking the agent is wrong: the agent itself is the classifier. It reads the conversation on every turn already; whatever the user said about autonomy is sitting in those messages. Adding a deterministic preprocessor just adds a place to mis-interpret. The prompt addition below is enough.

### `src/services/canvas-agent-autoturn.ts`

A server-side entry point parallel to `/api/ask/quick`. Skeleton:

```ts
export async function invokeCanvasAgentOnPlannerMessage({
  conversationId,
  featureId,
  plannerMessageId,
  wakeReason,  // "form" | "question" | "completed" | "halted"
}: AutoTurnArgs): Promise<void> {
  // 1. Per-conversation lock (Postgres advisory lock keyed on
  //    conversationId) with TTL 60s. Bail if held — another auto-turn
  //    for this conversation is already running. The new planner
  //    message is already in the conversation; the other turn will
  //    see it.
  // 2. Compose a tiny synthetic system addition naming the wake
  //    context (see below). NO policy extraction.
  // 3. Re-build the same prompt the user-driven path uses
  //    (`getMultiWorkspacePrefixMessages` or single-WS variant), plus
  //    the synthetic addition.
  // 4. Call `runCanvasAgent`. The agent reads the conversation —
  //    including the user's standing instructions, if any — and emits
  //    either a `send_to_feature_planner` tool call (auto-respond),
  //    a chat message to the user (escalate), or nothing (silent).
  // 5. Save resulting assistant message(s) via the same fan-out write
  //    path (transaction-protected append).
  // 6. Release the lock.
}
```

The synthetic system addition is short and context-only:

> You were invoked because the planner for feature **{featureTitle}** just posted a message ({wakeReason}). The planner's message is the most recent assistant entry in this conversation, marked with `source.kind === "planner"`.
>
> Follow the user's standing instructions in this conversation. Decide one of:
> - **Auto-respond:** call `send_to_feature_planner` with your answer. Don't write a separate chat message.
> - **Escalate:** write one short paragraph to the user framing what the planner needs.
> - **Stay silent:** emit no output. Do this when the planner's message is a pure status update, or when the user has clearly delegated this kind of decision and a `send_to_feature_planner` reply would be redundant noise in their inbox.

That's it. The prompt **does not tell the agent what the user's policy is** — the agent reads it from the conversation. The brevity rules and manager-of-planners section already in `getCanvasPromptSuffix` cover the rest of the behavior.

`getCanvasPromptSuffix` gets one new paragraph teaching the agent that auto-invocation exists at all:

> Sometimes you'll be invoked not because the user typed a message, but because a planner you're managing just posted one. A synthetic system message at the start of your context will tell you when this is the case (it'll name the feature and the wake reason). In those cases, your job is the same as always: read the conversation, follow the user's standing instructions, and either respond to the planner (`send_to_feature_planner`), write a brief note to the user, or do nothing — whichever the user's instructions and the planner's message warrant.

The agent's reply is committed to the canvas conversation. The card's headline status updates the next time the user opens the chat: it sees a new outbound entry (auto-respond), an assistant message to the user (escalate), or nothing (silent — but the card still shows the inbound planner message that woke the agent, so the user can see what happened).

### "Stay silent" needs to be a real option

The agent has to be able to produce no output without feeling compelled to say "OK, nothing to do here" as a chat message. Two implementations are plausible:

- **Convention:** an empty / whitespace-only assistant reply is dropped before commit. Cheap; relies on the agent producing exactly empty content rather than `"(no action needed)"`. Fragile in practice.
- **Tool:** a `stay_silent` tool the agent calls as a terminal action with an optional one-line `reason` argument (logged for debugging, not surfaced in UI). Explicit; harder for the agent to accidentally produce visible noise. Recommended.

The tool's execute body is trivial (just logs the reason and returns). Its existence in the toolset on auto-turns gives the agent a syntactically-clean way to do nothing.

### What "actionable" means precisely

The fan-out worker (Phase 2) calls `invokeCanvasAgentOnPlannerMessage` only when:

1. The planner message has a `PLAN` artifact with `tool_use === "ask_clarifying_questions"` (FORM), OR
2. The planner message's `feature.workflowStatus` just transitioned to `COMPLETED` / `FAILED` / `HALTED`, OR
3. The planner message text ends with `?` (heuristic for "asked a question without using a FORM")

Cases 1 and 2 are deterministic. Case 3 is a heuristic — fragile but cheap. The cost of a false positive is one extra LLM invocation on a planner message that didn't really need one; the agent can decide to stay silent. The cost of a false negative is the user has to manually prompt the canvas agent to handle the planner message later.

**FORM artifacts are escalation-only, never auto-response.** A FORM is the planner's explicit "I can't decide this; a human must pick" signal — auto-answering it would defeat the planner's own escalation. When the wake reason is `"form"`, the agent picks between **escalate** (write a one-paragraph note to the user pointing at the FORM) and **stay silent** (the `PlannerFormSlot` will surface the FORM directly anyway, so the agent doesn't need to also write a note). The FORM itself renders via `PlannerFormSlot` next to the card (Phase 4); the user clicks an option and the answer flows back through `send_to_feature_planner`.

### Per-conversation locking

A second planner replying while the first auto-turn is running would race. Postgres advisory lock (`pg_try_advisory_lock(hashtext(conversationId))`) inside a short-lived transaction at the top of `invokeCanvasAgentOnPlannerMessage`:

- Acquire → proceed.
- Don't acquire → log and return. The other auto-turn will see this new planner message at the top of its next `read_feature` or its synthetic prefix already includes it.

TTL via `pg_advisory_unlock` on completion + a watchdog timer in case the auto-turn crashes (~60s; canvas-agent turns are typically <30s).

### Shipping behind a kill switch

Phase 3 ships with `invokeCanvasAgentOnPlannerMessage` gated by `CANVAS_AUTONOMOUS_TURNS_ENABLED` (default `"false"`). Checked at the top of the function:

```ts
if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED !== "true") {
  console.log(
    "[canvas-autoturn] skipped (disabled via env)",
    { conversationId, featureId, wakeReason },
  );
  return;
}
```

**Phase 2 fan-out is not gated.** Planner messages still copy into owning canvas conversations and surface as inbound thread entries in their cards regardless of the env. The audit trail is real either way; the gate only controls whether the agent autonomously *acts* on those messages. This is what makes the off-state safe to ship — no functionality is hidden, the user can still manually prompt the canvas agent to handle anything they see.

Rollout intent: deploy with the env **off**, watch the fan-out logs for a few days to confirm trigger conditions fire at the expected rate (one log line per actionable planner message), then flip on. If autonomous behaviour misbehaves (cost spike, bad agent decisions, runaway loop), flip off without redeploying.

Add to `.env.example`:

```sh
# Enable the canvas agent to autonomously respond to planner messages
# (FORM artifacts, workflow completions, planner questions). Off by
# default; flip to "true" only after monitoring the fan-out logs
# confirms the trigger rate is reasonable for your workspace volume.
CANVAS_AUTONOMOUS_TURNS_ENABLED=false
```

One unit test confirms the short-circuit: mock the env, call `invokeCanvasAgentOnPlannerMessage`, assert no `runCanvasAgent` invocation occurred. Kill-switch regressions are silent in prod; the test is cheap insurance.

### Cost shape

Per planner ASSISTANT message in fan-out scope, at most one canvas-agent auto-turn fires. For a feature whose plan takes 5 plan-mode runs and 2 FORM rounds, that's ~3 auto-turns over the feature's lifetime per owning canvas conversation. Strictly bounded by **planner decision points, not by clock ticks**.

Mitigation knobs if cost grows:

- **Tiered model for autoturns.** Default to a cheaper model than user-driven turns (Haiku-equivalent). The work is "read the conversation, decide to call `send_to_feature_planner` or `stay_silent` or write 1-2 sentences" — well within the cheap tier.
- **Conservative default in the prompt.** The new prompt paragraph defaults toward escalation / silence rather than auto-respond when the user hasn't given an autonomy directive. The agent doesn't volunteer autonomy it wasn't granted; explicit user instructions opt it in.

### What ships at end of Phase 3

The system is autonomously triaging. User says "manage this feature for me, only escalate decisions I have to make." Canvas agent does. Cards show the cumulative back-and-forth, the user comes back to a clean inbox: cards in red headline ("waiting for you"), cards in green ("plan ready"), cards in muted gray ("running silently"). They click the red one, answer, move on.

## Phase 4 — `PlannerFormSlot` (FORMs render inline, user answers in canvas chat) ⬜ NOT STARTED

The last piece. FORMs from the planner currently force a navigation to `/w/<slug>/plan/<featureId>` to answer. After Phase 4 they're answerable in canvas chat.

> **Already wired (forward-compat).** `CanvasMessageSource` ships with the `user-answered-planner-form` variant declared in Phase 2; `SidebarChat.tsx` already filters that source kind out of the main scroll. Phase 4 just adds the renderer (`PlannerFormSlot`), the answer endpoint, and the extractor branch in `SubAgentRunCard.tsx` that treats `user-answered-planner-form` rows as a third thread-entry class (alongside outbound canvas-agent sends and inbound planner messages).

### Component

`src/app/org/[githubLogin]/_components/PlannerFormSlot.tsx`. Sits visually next to (or above) the `SubAgentRunCard` whenever the card's most recent inbound entry has an unanswered FORM artifact.

Skeleton:

```tsx
interface PlannerFormSlotProps {
  featureId: string;
  workspaceSlug: string;
  plannerMessageId: string;
  artifactContent: ClarifyingQuestionsArtifactContent;  // verbatim from planner
}

export function PlannerFormSlot({ featureId, workspaceSlug, plannerMessageId, artifactContent }) {
  const handleSubmit = async (answer: string) => {
    // Two writes, one user action:
    // 1. POST to /api/features/[featureId]/chat with the answer +
    //    replyId: plannerMessageId. This is exactly what the
    //    per-feature plan page does today.
    // 2. Append a synthetic user message to the canvas conversation
    //    with `source: "user-answered-planner-form"` so the canvas
    //    agent (on its next turn) and the audit trail both see what
    //    was answered.
    //
    // Both writes are server-side; the client calls a single new
    // endpoint POST /api/orgs/[githubLogin]/planner-forms/answer
    // that does both atomically.
  };
  // Props match the existing per-feature plan-page usage in
  // FeaturePlanChatMessage.tsx — review that call site for the
  // exact prop names before wiring up. The `artifactContent`
  // unpacks into questions/options identically.
  return <ClarifyingQuestionsPreview content={artifactContent} onSubmit={handleSubmit} />;
}
```

`ClarifyingQuestionsPreview` is the same renderer the per-feature plan page uses (`src/components/features/ClarifyingQuestionsPreview/index.tsx`). Reused verbatim. The iOS app already knows how to render `ClarifyingQuestionsPreview`-shaped artifacts in plan chats — we're just adding canvas chat as a second valid surface.

### New endpoint: `POST /api/orgs/[githubLogin]/planner-forms/answer`

Single atomic operation:

1. Authorize: user is a member of the feature's workspace.
2. POST to the per-feature chat endpoint internally (or call `sendFeatureChatMessage` directly) — same path the plan page uses.
3. Append a synthetic USER message to the canvas conversation: `{ role: "user", content: "Answered: <summary>", source: { kind: "user-answered-planner-form", featureId, plannerMessageId } }`. **Critically: this is appended through the same transaction-protected fan-out path** as planner-originated writes. Same concurrency story.
4. Does **not** invoke the canvas agent. The user's answer is purely transcript + planner-routing; the agent will see it on its next user-driven turn.

### The `source: "user-answered-planner-form"` marker

Filtered out of the main chat render the same way `source.kind === "planner"` is. Rendered inside the card thread as an outbound entry (`direction: "out"`, but distinguished from canvas-agent sends by the source). The card thread now shows three classes: agent-to-planner (`→ "Proceed to architecture"`), planner-to-canvas (`← "Plan ready for review"`), user-to-planner-via-form (`✓ Answered: Stripe`).

### What ships at end of Phase 4

The user never has to leave canvas chat unless they want to. The feature plan page is now the **deep dive surface** — full plan, all artifacts, all logs — but the day-to-day "answer the planner's question and move on" is fully in canvas chat. Voice surfaces inherit this because they read the canvas conversation as text. iOS inherits the **data** (the `source`-marked messages round-trip through `SharedConversation.messages` JSON), but iOS will likely need its own `SubAgentRunCard` + `PlannerFormSlot` equivalents — those are renderers, not protocol. Phase 4's iOS rollout is a parallel task to confirm with the iOS team.

## Open questions

Resolve in order — each is tagged with the earliest phase that needs an answer.

1. **[Phase 2] Ownership singularity.** Singular `Feature.parentCanvasConversationId` covers the 95% case but loses fan-out when a second canvas conversation messages a planner first claimed elsewhere. Are we OK with that for v1? (Recommended: yes; promote to a join table if cross-conversation feature management becomes a real workflow.)

YES! `Feature.parentCanvasConversationId` is fine

2. **[Phase 2] Webhook write path coverage.** `sendFeatureChatMessage` writes USER messages from the per-feature UI. Planner ASSISTANT messages land via the Stakwork callback at `src/app/api/chat/response/route.ts`. Both write paths need to call `fanOutPlannerMessageToCanvas`. Are there other write paths for ASSISTANT messages we're missing? (Action: grep `role: "ASSISTANT"` writes in `src/services/` + `src/app/api/`; confirm coverage before starting the fan-out worker.)

3. **[Phase 2] Race: fan-out vs autosave PUT (client-side staleness).** The `SELECT ... FOR UPDATE` wrap handles the *database* race — concurrent appends serialize correctly, no message is lost. But the *client's local store* can still be momentarily stale: a fan-out lands while the user is mid-conversation; the client's next autosave PUT appends the user's new message on top, server-side both are preserved in the right order, but the client doesn't have the fan-out's planner message in its store until the next refresh. Result: the user sees their own message but not the planner's until they refresh or change tabs. Acceptable? (Recommended: yes; the race window is small and self-healing. A future fix is one Pusher broadcast per conversation-update that nudges the client to refetch — out of scope for v1.)

4. **[Phase 3] Stay-silent implementation.** Convention (drop empty replies) vs explicit `stay_silent` tool. Recommended: tool, because the agent will be tempted to narrate its non-action ("Nothing to do here.") otherwise. Tool body is ~10 lines.

good idea on the tool

## Future seams

- **Join-table ownership.** Promote `Feature.parentCanvasConversationId` to `FeatureCanvasOwnership` (`featureId`, `conversationId`, `claimedAt`, `claimedReason`). Fan-out becomes "for each owner of this feature, append." No change to the rest of the design. The trigger to promote is the first real user request to "manage this feature from two conversations" — until then, singular ownership is the simpler write.

- **Pusher push (optional optimization).** Phase 4 mentions the fan-out → client-refetch race. A Pusher single-event-per-conversation broadcast on every server-side append fixes it. **Not added in v1 because the canvas page already polls on focus and refetches on tab switch** — the race is small and self-healing. Adding Pusher only when measured user pain emerges.

- **Explicit autonomy controls in the UI.** If the prompt-only approach turns out to misread the user's intent in practice — common pattern: user said "manage this for me" three days ago, forgot they said it, gets surprised by auto-responses now — a small UI affordance (a per-conversation toggle in the chat header: `agent autonomy: ask everything / decisions only / manage everything`) could surface and edit the policy explicitly. Until that's observed in real use, the conversation itself is enough.

- **Multiple sub-agent kinds.** Today the only sub-agent the canvas agent manages is `feature-planner`. The same primitive (parent-canvas ownership + fan-out + auto-turn on actionable messages) extends to task agents, janitor agents, etc. Each new sub-agent kind adds: a `SubAgentRunCard` discriminator, a `source.kind` value, a fan-out hook in its write path. The card render code branches by kind.

- **"Stop managing" surface.** A user instruction *"stop managing the auth feature"* should null out `parentCanvasConversationId` for that feature. Either an agent tool (`stop_managing_feature(featureId)`) or a UI affordance on the card header (`×` icon). Out of v1 to avoid a one-off UX before the rest stabilizes.

- **Sub-card threads for plan-mode artifacts.** Today the canvas chat doesn't render any of the planner's structured artifacts (`PLAN` body, `TASKS`, etc.) except `ask_clarifying_questions`. A follow-up could add inline rendering of `PLAN`-content (the actual brief / requirements / architecture) inside the expanded card view — same shape as `FeaturePlanChat.tsx` does on the per-feature page. Mostly a matter of plumbing existing renderers into the card's expanded body.

## Order of operations (TL;DR)

1. ✅ **Phase 1** — collapse-by-default `SubAgentRunCard` with one-line headline. UI-only. ~3 hours. **Shipped.**
2. ✅ **Phase 2** — `Feature.parentCanvasConversationId` + fan-out worker + `SELECT ... FOR UPDATE` serialization on the autosave endpoint. Inbound thread entries become visible. ~1 day. **Shipped.**
3. ⬜ **Phase 3** — `invokeCanvasAgentOnPlannerMessage` + `stay_silent` tool + per-conversation lock + prompt paragraph teaching auto-invocation. Auto-turn fires on actionable planner messages; the agent reads the conversation and triages per the user's standing instructions. **Gated by `CANVAS_AUTONOMOUS_TURNS_ENABLED` — ships off, flip on after deploy.** ~1 day. **Not started.**
4. ⬜ **Phase 4** — `PlannerFormSlot` + answer endpoint. Users answer FORMs in canvas chat. ~half a day. **Not started.**

Each phase ships independently and is reversible (delete the new file + the small diffs; restore prior behaviour). No phase blocks the user from doing anything they can do today.
