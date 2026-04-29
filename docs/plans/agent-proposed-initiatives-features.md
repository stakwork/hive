# Agent-Proposed Initiatives & Features

Let the org canvas chat agent **propose** new `Initiative` and `Feature` rows directly in chat. The user explicitly approves each proposal before any DB write happens. The chat is an ephemeral scratchpad where the user and agent draft and refine; only on approval does a real `Initiative` / `Feature` row appear and project onto the canvas.

> **Companion docs — read first.**
> - `src/app/org/[githubLogin]/CANVAS.md` — org canvas + chat orientation. The "agent does NOT create initiatives or milestones" invariant this plan preserves; the projector contract; the canvas chat persistence model (`SharedConversation.messages` JSON blob).
> - `docs/plans/org-initiatives.md` — design of the live initiative/milestone projection. The DB-creating-categories pattern is what we're extending.
> - `src/lib/ai/initiativeTools.ts` — the existing "organize, don't create" agent tool (`assign_feature_to_initiative`). The new tools live alongside it and follow the same org-ownership validation pattern.
>
> **Out of scope (deliberately):** proposing milestones, proposing edges, drag-from-chat-onto-canvas, ghost nodes on the canvas, multi-user approval workflows. Each is reachable from this design without rewrites — see "Future seams."

## Goal

The canonical scenario: a user opens the org canvas chat and says *"I'm spinning up an Onboarding Revamp initiative — propose 3-5 features we should ship for it."* Today the agent has no way to do that without writing to the DB, which violates the human-only-creates rule.

With this plan the agent calls `propose_initiative` / `propose_feature` tools that **don't write to the DB** — they just validate and emit a structured tool result that lands in the conversation. The user approves (or rejects) each proposal by clicking a button that appends a normal user message carrying the approval intent. The `/api/ask/quick` route detects that intent and creates the row server-side before the LLM runs (or instead of it). On approval, the new node projects onto the canvas via the existing Pusher path.

## The animating principle

**The chat is the source of truth.** Proposals are just tool-call outputs in the conversation transcript. Approvals/rejections are user messages carrying structured intent. Nothing gets stored "as a proposal" in the database — the conversation IS the database for proposal lifecycle.

This means:
- No new tables, no new columns, no schema migration.
- No notion of "artifact" or "proposal record" — there's just messages and tool calls, which the canvas chat already round-trips through `SharedConversation.messages` as JSON.
- Status is **derived**, not stored. To answer "is proposal X approved?" you scan the conversation's messages.
- Forking a chat (per CANVAS.md's share-fork flow) automatically forks the proposal trail — the fork's transcript is self-describing.
- Idempotency is bounded by the conversation's append-only nature: re-clicking Approve appends another approval message; the server's idempotency scan finds the prior approval's `createdEntityId` and short-circuits.

## What's authored vs. projected vs. proposed

| Concept | Source | Where data lives | Lifecycle |
| --- | --- | --- | --- |
| `note`, `decision`, free `text` | authored | `Canvas.data` blob | Manual edit / delete |
| `workspace`, `repository` | DB-projected | DB tables | Existing flows |
| `initiative`, `milestone`, `feature` | DB-projected | DB tables | Human creates via `+` menu dialog (`docs/plans/org-initiatives.md`) **OR** human approves an agent proposal (this doc) |
| Pending proposals | agent tool output | `SharedConversation.messages` JSON (inside `message.toolCalls[]`) | Pending → Approved (creates DB row) / Rejected (terminal). Status derived from later messages in the same conversation. |

The agent's tool surface gains two **non-creating** tools — `propose_initiative` and `propose_feature`. The agent still cannot write to the `Initiative` / `Feature` tables directly. The human approval click is the only path from chat to DB.

## How chat persistence already works (re-cap)

This is the foundation; the design only works because of it.

- The canvas chat persists conversations to `SharedConversation.messages` as a single opaque JSON blob (`schema.prisma:498`). It does **not** use the `ChatMessage` / `Artifact` Prisma models — those are for tasks/features.
- `useCanvasChatAutoSave.ts` POSTs / PUTs message deltas; the PUT endpoint blindly concatenates (`[conversationId]/route.ts:186`).
- `useSendCanvasChatMessage.ts:185-208` already lifts every tool call (id, toolName, input, output, status) into `CanvasChatMessage.toolCalls[]`.
- `processStream` in `useStreamProcessor.ts` already populates `toolCall.output` from `tool-result` events (line 329+).

Therefore: **whatever a tool returns from `execute(...)` is already in the message; whatever fields we add to `CanvasChatMessage` already round-trip through the DB.** No new persistence path needed.

## The proposal shape (= tool output shape)

Just the return value of the propose tools. Lives at `message.toolCalls[i].output` for free.

```ts
type ProposalOutput =
  | { kind: "initiative"; proposalId: string; payload: InitiativePayload; rationale?: string }
  | { kind: "feature";    proposalId: string; payload: FeaturePayload;    rationale?: string };

type InitiativePayload = {
  name: string;
  description?: string;
  status?: "DRAFT" | "ACTIVE";
  assigneeId?: string;
  startDate?: string;
  targetDate?: string;
};

type FeaturePayload = {
  title: string;
  description?: string;
  workspaceId: string;
  initiativeId?: string;       // existing initiative
  milestoneId?: string;        // existing milestone
  parentProposalId?: string;   // sibling proposal_initiative in this conversation
};
```

`payload` matches the create-API input shape. Approval reads it back verbatim and feeds it to `Initiative.create` / `createFeature(...)`. Inline-edit overrides ride along on the approval intent (see below) and never mutate the original tool call's output — chat history shows what the agent actually proposed.

`parentProposalId` lets the agent group features under a not-yet-approved initiative. At approval time the server resolves it by scanning the conversation for the parent's approval; if the parent is still pending → 409.

## The approval intent (= structured field on a user message)

Extend `CanvasChatMessage` (`canvasChatStore.ts:73-84`) with two optional fields. They round-trip through `SharedConversation.messages` for free.

```ts
export interface CanvasChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];

  /** User clicked Approve on a proposal. Set on user messages only. */
  approval?: {
    proposalId: string;
    payload?: Partial<InitiativePayload | FeaturePayload>; // inline-edit overrides
    currentRef?: string;                                   // canvas the user is on
    viewport?: { x: number; y: number };                   // placement hint
  };

  /** User clicked Reject on a proposal. Set on user messages only. */
  rejection?: { proposalId: string };

  /** Synthetic assistant message describing an approval outcome. Set by the API route. */
  approvalResult?: {
    proposalId: string;
    kind: "initiative" | "feature";
    createdEntityId: string;
    landedOn: string;            // canvas ref the new node landed on
  };
}
```

The card's UI sends a user message carrying `approval` (no special API endpoint, no new fetch path — uses the existing send pipeline). The API route detects it, runs the side effect, and writes a synthetic assistant message back carrying `approvalResult`.

## Status derivation (the load-bearing scan)

The card's UI never asks "is this approved?" by hitting an endpoint. It scans the conversation:

```ts
function getProposalStatus(
  conversation: CanvasChatMessage[],
  proposalId: string,
): { status: "pending" | "approved" | "rejected"; result?: CanvasChatMessage["approvalResult"] } {
  for (const msg of conversation) {
    if (msg.rejection?.proposalId === proposalId) return { status: "rejected" };
    if (msg.approvalResult?.proposalId === proposalId) {
      return { status: "approved", result: msg.approvalResult };
    }
    // Note: an `approval` without a matching `approvalResult` later means
    // "approve was clicked but server hasn't written the confirmation yet" —
    // treat as pending in flight; UI shows a spinner.
  }
  return { status: "pending" };
}
```

This is the entire state machine. No DB lookup, no store-side bookkeeping, no rehydration logic. Loading a conversation re-runs the scan against the loaded JSON.

For multi-row "Approve all" the same scan answers everything in one O(n) pass keyed by `proposalId`.

## The agent tools

Add to `src/lib/ai/initiativeTools.ts`. Same `buildInitiativeTools(orgId, userId)` factory. Already wired into `/api/ask/quick:181`.

### `propose_initiative`

```
description:
  "Propose a new initiative for this org. Does NOT create the
   initiative — the user must approve in chat. Use when the user
   asks you to suggest, draft, or sketch initiatives."

inputSchema:
  proposalId: string         // agent-generated; format: cuid-ish; stable
  name: string
  description?: string
  status?: "DRAFT" | "ACTIVE"
  assigneeId?: string
  startDate?: string
  targetDate?: string
  rationale?: string

execute:
  // No DB writes. Just validate + return the structured proposal.
  return { kind: "initiative", proposalId, payload: { ... }, rationale };
```

### `propose_feature`

```
description:
  "Propose a new feature in a specific workspace, optionally under
   an existing or proposed initiative/milestone. Does NOT create
   the feature — the user must approve. To group features under
   a proposed (not-yet-approved) initiative, set parentProposalId
   to that initiative proposal's id."

inputSchema:
  proposalId: string
  title: string
  description?: string
  workspaceId: string
  initiativeId?: string
  milestoneId?: string
  parentProposalId?: string
  rationale?: string

execute:
  // Validate org ownership of workspace + (if set) initiativeId,
  // milestoneId. parentProposalId is NOT validated here — the
  // conversation isn't visible to the tool. Approval-time validates it.
```

**Validation in `execute`** (cheap; same `sourceControlOrgId` pattern as `assign_feature_to_initiative`):
- Workspace exists and belongs to this org.
- If `initiativeId` is supplied, it belongs to this org.
- If `milestoneId` is supplied, it belongs to that initiative (transitive via `updateFeature`'s invariant).

If validation fails the tool returns `{ error }` and the agent retries — same pattern as `assign_feature_to_initiative`. No tool call result lands in the conversation as a "proposal" until validation passes.

**Prompt update** in `src/lib/constants/prompt.ts` `getCanvasPromptSuffix()`:

> "When the user asks you to suggest, draft, or sketch new initiatives or features, use `propose_initiative` and `propose_feature`. These do NOT create anything — they emit proposals the user reviews. When the user has already created an initiative and asks you to file existing features under it, use `assign_feature_to_initiative` instead. Never use `update_canvas` to author live nodes."

## The approval handler (lives in `/api/ask/quick`)

Why in `/api/ask/quick` and not a new endpoint: the chat is the source of truth, and that route already owns the conversation, auth, org gating, and tool routing. Bolting on a parallel REST path would split that ownership.

Pre-LLM step in the route handler. Pseudocode:

```ts
// Inside POST /api/ask/quick, after auth + org validation, BEFORE LLM stream.
const lastMessage = messages[messages.length - 1];

if (lastMessage.role === "user" && lastMessage.approval) {
  const result = await handleApproval({
    orgId,
    userId,
    conversation: messages,                  // full message list for scans
    intent: lastMessage.approval,
  });
  // Stream a synthetic assistant message and return — skip the LLM entirely.
  return streamSyntheticAssistantMessage({
    approvalResult: result,
    text: formatApprovalText(result),       // "Created initiative Onboarding Revamp ↗"
  });
}

if (lastMessage.role === "user" && lastMessage.rejection) {
  // No DB side effect. Just stream a brief acknowledgment.
  // (We don't even need the LLM for this — keep it deterministic.)
  return streamSyntheticAssistantMessage({
    text: "Got it — I won't create that.",
  });
}

// Otherwise: normal LLM flow with the existing toolset.
```

`handleApproval` does:

1. **Find the proposal in the conversation.** Scan `messages` backward for an assistant message with a `toolCalls[]` entry whose `toolName` is `propose_initiative` or `propose_feature` and whose `output.proposalId === intent.proposalId`. If not found → 404.
2. **Idempotency scan.** Scan forward for any prior assistant message with `approvalResult.proposalId === intent.proposalId`. If found, return its `{ createdEntityId, landedOn, kind }` immediately. Re-clicking Approve is now a no-op that produces the same confirmation.
3. **Resolve `parentProposalId`** if the proposal has one:
   - Find the parent's `approvalResult`. If found → use `parent.createdEntityId` as `initiativeId`.
   - If the parent has been rejected (rejection message exists) → 409 "parent was rejected."
   - If the parent is still pending → 409 "approve the parent initiative first." UI surfaces a "Approve initiative + this feature" combo button (which sends two approvals in sequence).
4. **Merge inline-edit overrides.** Effective payload = `{ ...proposal.output.payload, ...intent.payload }`. Edits never touch the original proposal.
5. **Validate the effective payload.** Workspace belongs to org; initiative belongs to org; milestone belongs to initiative. Same checks as the propose tool, re-run in case the override changed anything.
6. **Create the row inside a transaction:**
   - `kind === "initiative"` → `prisma.initiative.create({ data: { ...payload, orgId } })`.
   - `kind === "feature"` → `createFeature(...)` from the existing roadmap service (preserves the `feature.initiativeId === milestone.initiativeId` invariant).
7. **Place on the user's current canvas, when legal** (features only — initiatives only project on root, where the projector auto-lays-out):
   - Compute `landedOn`:
     - If `intent.currentRef` is supplied AND `featureProjectsOn(intent.currentRef, payload)` is true → `landedOn = intent.currentRef`. Read the current canvas's `Canvas.data` blob, write `positions[<feature liveId>] = intent.viewport ?? autoCascade(currentRef)`, save in the same transaction.
     - Else → `landedOn = mostSpecificRef(payload)` (milestone if set, else initiative, else workspace). No position overlay; the projector's auto-layout handles it.
   - This is the same side-channel `Canvas.data` write the `+` button does (CANVAS.md gotchas: side-channel DB writes from canvas interactions).
8. **Fan out `CANVAS_UPDATED`.** For features, `notifyFeatureReassignmentRefresh` covers root, both initiatives, both milestones, the workspace; if `landedOn === currentRef` and the position overlay was written, that ref is in the fan-out so the position update goes out without an extra emit. For initiatives, `notifyCanvasUpdatedByLogin` on the root ref.
9. **Return** `{ proposalId, kind, createdEntityId, landedOn }`. The route writes this into the synthetic assistant message's `approvalResult` field; the autosave path persists it as part of the message; the card UI's status scan picks it up and flips to "approved."

The synthetic assistant message also has a brief `content` string ("Created initiative *Onboarding Revamp* on the root canvas. ↗") so the chat scroll reads naturally, but the structured `approvalResult` is what the card consumes.

## Shared helper: `featureProjectsOn`

The "place on current canvas if legal" rule must match the projector's logic exactly, or the position overlay becomes dead weight written to a canvas where the feature doesn't render. Single source of truth in `src/lib/canvas/feature-projection.ts`.

```ts
// src/lib/canvas/feature-projection.ts

export function featureProjectsOn(
  ref: string,
  payload: { workspaceId: string; initiativeId?: string | null; milestoneId?: string | null },
): boolean {
  if (ref === "") return false;                          // root never shows features

  if (ref.startsWith("milestone:")) {
    return payload.milestoneId === ref.slice("milestone:".length);
  }
  if (ref.startsWith("initiative:")) {
    return (
      payload.initiativeId === ref.slice("initiative:".length) &&
      !payload.milestoneId
    );
  }
  if (ref.startsWith("ws:")) {
    return (
      payload.workspaceId === ref.slice("ws:".length) &&
      !payload.initiativeId &&
      !payload.milestoneId
    );
  }
  return false;
}

export function mostSpecificRef(
  payload: { workspaceId: string; initiativeId?: string | null; milestoneId?: string | null },
): string {
  if (payload.milestoneId) return `milestone:${payload.milestoneId}`;
  if (payload.initiativeId) return `initiative:${payload.initiativeId}`;
  return `ws:${payload.workspaceId}`;
}
```

Tests live with the helper.

## The chat UX (v1: simple list)

Render a `<ProposalCard>` per proposal tool call, inside the assistant message that produced it. Multiple proposals in one message render as a small group with a header.

```
┌─ Proposed: 1 initiative, 3 features ──────────── [Approve all] ─┐
│                                                                   │
│  ▸ Initiative: Onboarding Revamp                       [✓]  [✗]  │
│      Reduce time-to-first-value for new orgs                      │
│                                                                   │
│      └ Feature: Guided setup wizard          [✓]  [✗]            │
│         (in workspace: hive-app)                                  │
│      └ Feature: Sample data seeding          [✓]  [✗]            │
│         (in workspace: hive-app)                                  │
│      └ Feature: First-run analytics          [✓]  [✗]            │
│         (in workspace: hive-app)                                  │
└───────────────────────────────────────────────────────────────────┘
```

**Data source:** the card receives the proposal output (`message.toolCalls[i].output`) plus the result of `getProposalStatus(allMessages, proposalId)`. No store lookup. Pure derivation.

**States:**
- `pending`: full color, both buttons enabled.
- `pending in flight` (`approval` message exists but no `approvalResult` yet): buttons disabled, spinner.
- `approved`: dimmed-with-checkmark. Subtext from `approvalResult`:
  - If `landedOn === currentRef` → "Created on this canvas ✓".
  - Else → "Created on **<initiative or workspace name>** ↗" — clicking navigates via `?canvas=<landedOn>` (CANVAS.md deep-link gotcha).
- `rejected`: faded out, "Rejected" subtext, expandable to see what was proposed.

**Approve action:** appends a user message via the existing `useSendCanvasChatMessage` path with content like `"Approved: <name>"` and the `approval` field set. The send pipeline POSTs to `/api/ask/quick`, the route detects the approval intent, runs the handler, streams the synthetic assistant message back, autosave persists it. The card's status scan now finds the `approvalResult` and re-renders as approved.

**Reject action:** same, but with `rejection` set. The route streams a deterministic acknowledgment ("Got it — I won't create that.") with no DB write.

**"Approve all" button:** sends approvals sequentially — parent first if any, then children in `parentProposalId` order. Per-row error display if any single approval 409s or 500s.

**Inline edit:** click any field in a pending proposal to edit before approving. Edits are local UI state; they're sent in the `approval.payload` overrides field. **Edits don't mutate the original tool call** — chat history shows what the agent actually proposed.

**No drag, no auto-approve, no auto-dismiss.** The agent will be wrong sometimes; the click is the safety rail. The agent's job is to make the proposal *good*, not to make approval *invisible*.

## Streaming flow (end-to-end)

1. User: *"propose 3 features for billing v2"*.
2. `useSendCanvasChatMessage` POSTs to `/api/ask/quick` with the conversation, `orgId`, `currentCanvasRef`, etc. `buildInitiativeTools` is in the toolset (already wired at `quick/route.ts:181`).
3. Agent text-streams a brief framing message ("Here are three I'd suggest:"), then calls `propose_feature` three times. Each tool's `execute` validates and returns a `ProposalOutput`.
4. The streaming reducer (already exists, no changes) lifts each tool call's output onto `message.toolCalls[i].output`.
5. `<ProposalCard>` renders inline as the tool calls arrive (the chat already iterates `message.toolCalls` to render `ToolCallIndicator`; we extend that to render proposal cards instead when `toolName` matches).
6. `useCanvasChatAutoSave` persists the message + tool calls to `SharedConversation.messages` JSON.
7. User clicks Approve on one row → the card calls `useSendCanvasChatMessage` with `{ content: "Approved", approval: { proposalId, currentRef, viewport } }` → POST to `/api/ask/quick` → route's pre-LLM check sees `approval` → runs `handleApproval` → DB row created → canvas position written (if legal) → Pusher fan-out → synthetic assistant message streamed back with `approvalResult` populated → autosave persists → card's status scan flips to approved → projector picks up the new row → canvas shows it.

The whole pipeline is fire-and-forget on the canvas side: the chat doesn't directly know or care that the canvas refreshed. That's the boundary the store + Pusher already establish.

## Forked / shared chats

Per CANVAS.md, the share-fork flow gives each forker their own auto-save row. That means:

- A fork inherits the original conversation's messages, including any proposal tool calls.
- Status derivation re-runs against the fork's own message list — proposals approved before the fork was made show as approved (the `approvalResult` message is in the inherited transcript); pending proposals stay pending.
- The fork can independently approve a still-pending proposal — it would create a new DB row and append an `approvalResult` message to the fork's transcript only. (The original conversation's transcript is unchanged.)
- This is fine and probably even useful — multiple users exploring the same agent suggestion can each act on it. If it becomes a problem, we add a global lock keyed on `proposalId` later. Don't pre-engineer.

The endpoint scopes its conversation lookup to the calling user's `SharedConversation` rows naturally.

## Future seams

These are intentionally not built in v1, but the design above keeps the path clean:

1. **Drag-from-chat-onto-canvas.** `payload` already matches canvas card props; the approval intent already accepts `currentRef` + `viewport` (drag would just override `viewport` with drop coords and let `featureProjectsOn` validate). Adds: drag source on `<ProposalCard>`, drop target on the canvas surface. Server logic doesn't change.
2. **Ghost nodes on the canvas.** A canvas-side selector iterates the active conversation's pending proposals and emits faded nodes at auto-suggested positions. Approval = ghost solidifies. Implemented as a presentation-time merge after `readCanvas`, so projectors stay pure.
3. **`propose_milestone`.** Same pattern as features. Milestones project on `initiative:<id>` sub-canvases, so the approval fan-out targets that ref.
4. **`propose_edge`.** Edges are authored-blob entities (`Canvas.data.edges`); a proposal would patch the blob on approval. Different shape from row-creating proposals — separate small plan.
5. **Multi-user approval / review queue.** A `Proposal` table becomes justified the moment proposals need a lifecycle independent of their conversation (route to a teammate, time-bounded review). Until then: no table.
6. **Real card rendering instead of list rows.** The `<ProposalCard>` swap is one component; everything around it stays.

## Implementation order (one PR)

Each step is independently sensible; together they're a single coherent PR.

1. **`featureProjectsOn` + `mostSpecificRef`** in `src/lib/canvas/feature-projection.ts` with unit tests. Pure functions, no dependencies.
2. **Type extensions to `CanvasChatMessage`** in `canvasChatStore.ts`: add `approval?`, `rejection?`, `approvalResult?` fields. Add `ProposalOutput` types either here or in `src/lib/proposals/types.ts` (single shared file used by tools, route, and UI).
3. **Two new agent tools** `propose_initiative` and `propose_feature` in `initiativeTools.ts`. Validation only, no DB writes. Both return `ProposalOutput` from `execute`.
4. **Approval handler** as a pre-LLM block in `/api/ask/quick`. Includes:
   - Detection of `approval` / `rejection` on the latest user message.
   - `handleApproval` function: proposal lookup, idempotency scan, parent resolution, payload merge, validation, transactional create, canvas position overlay write, Pusher fan-out.
   - Synthetic assistant message streaming (text + structured `approvalResult`).
   - Skip-LLM short-circuit.
5. **Prompt update** in `getCanvasPromptSuffix()` teaching propose vs. organize.
6. **`<ProposalCard>` UI** in `src/app/org/[githubLogin]/_components/`:
   - Renders inside `SidebarChat` when iterating `message.toolCalls` and the `toolName` is one of the propose tools.
   - Pure derivation: receives the tool call output + the conversation's full message list, computes status with `getProposalStatus`.
   - Approve/Reject buttons trigger `useSendCanvasChatMessage` with the structured intent fields.
   - Inline edit, "Approve all," "Created on this canvas / Created on X ↗" subtext.
7. **CANVAS.md gotcha bullet** pointing to this doc, noting the new tools and the conversation-as-source-of-truth pattern.
8. **Smoke test the full loop:** open canvas, ask agent to propose, approve while on different scopes (root, workspace, initiative), confirm the node lands on the user's current canvas when projection allows and falls back gracefully when it doesn't.

Notably absent from this list (vs. earlier drafts): no "artifact" type, no schema migration, no new REST endpoints, no new store slices, no rehydration logic, no stream-reducer extensions. The chat infrastructure already does everything the persistence layer needs.

## What we are deliberately not building

- A `Proposal` Prisma table (or any schema change at all).
- A "pending proposals" inbox or notification badge.
- Auto-approval, auto-dismissal, or any timeout-driven state change.
- Drag-and-drop placement.
- Ghost nodes on the canvas.
- Proposing milestones, edges, decisions, or anything else not explicitly listed.
- Cross-conversation deduplication.
- Versioning of proposals (no "agent revised proposal X — show diff").
- A new REST endpoint for approve/reject — it goes through `/api/ask/quick` because the conversation owns the lifecycle.

Each is a real feature that could become important. None is needed for the core loop *agent suggests → user approves → row appears on canvas*. Build the loop, watch usage, decide what's next from data.
