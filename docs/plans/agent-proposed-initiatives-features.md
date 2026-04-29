# Agent-Proposed Initiatives & Features

Let the org canvas chat agent **propose** new `Initiative` and `Feature` rows as chat artifacts that the user explicitly approves before any DB write happens. Approval flips the proposal into a real `Initiative` / `Feature` (creation flows the agent already cannot drive), without ever giving the agent direct create access.

> **Companion docs:** read first.
> - `src/app/org/[githubLogin]/CANVAS.md` — org canvas + chat orientation. Notes the reserved `state.proposals` slot in `useCanvasChatStore` and the "agent does NOT create initiatives or milestones" invariant this plan preserves.
> - `docs/plans/org-initiatives.md` — design of the live initiative/milestone projection. The DB-creating-categories pattern (line 28) is what we're extending.
> - `src/lib/ai/initiativeTools.ts` — the existing "organize, don't create" agent tool (`assign_feature_to_initiative`). The new tools live alongside it and follow the same org-ownership validation pattern.
>
> **Out of scope (deliberately):** proposing milestones, proposing edges, drag-from-chat-onto-canvas, ghost nodes on the canvas, multi-user approval workflows. Each is reachable from this design without rewrites — see "Future seams."

## Goal

The canonical scenario: a user opens the org canvas chat and says *"I'm spinning up an Onboarding Revamp initiative — propose 3-5 features we should ship for it."* Today the agent has no way to do that without writing to the DB, which violates the human-only-creates rule. With this plan the agent emits a structured **proposal artifact** in chat; the user approves (or rejects) each row; only on approval does a real `Initiative` / `Feature` row appear and project onto the canvas.

The animating principle: **proposals are chat output, not data**. They live inside the message that produced them, ride along when the conversation is shared/forked, and disappear from product surfaces the moment they're approved (because at that point the real DB row carries the meaning). No new table.

## The four ideas the design rests on

1. **Proposal = chat artifact.** A proposal is a typed entry inside `ChatMessage.artifacts` (the existing `Artifact` Prisma model — JSON `content` field). It is *not* a row in a new `Proposal` table. Persistence comes for free via `useCanvasChatAutoSave`; rehydration comes for free on conversation load.

2. **Payload shape = create-API input shape.** A proposal's `payload` field carries exactly the fields the corresponding create endpoint expects. Approval is a thin `validate → create → patch artifact` step with no translation layer. This is the load-bearing decision: it keeps the UI swappable (list today, real cards later) and makes drag-to-place a future additive feature, not a refactor.

3. **Approval is a one-way door.** Once approved, the proposal artifact stamps `status: "approved"`, `createdEntityId`, `resolvedAt`. The real DB row owns the data from then on. Rejection is also terminal (`status: "rejected"`) — the artifact stays in chat history for context but is dimmed in the UI.

4. **Idempotency by `proposalId`.** The agent generates a stable `proposalId` per proposal. The approval endpoint treats it as an idempotency key: a second approve call returns the existing `createdEntityId` instead of double-creating. Cheap, no new table, survives the "user double-clicks Approve" race and the "two browser tabs both approve" race.

## What's authored vs. what's projected vs. proposed

| Concept | Source | Where data lives | Lifecycle |
| --- | --- | --- | --- |
| `note`, `decision`, free `text` | authored | `Canvas.data` blob | Manual edit / delete |
| `workspace`, `repository` | DB-projected | DB tables | Existing flows |
| `initiative`, `milestone`, `feature` | DB-projected | DB tables | Human creates via `+` menu dialog (`docs/plans/org-initiatives.md`) **OR** human approves an agent proposal (this doc) |
| `propose-initiative`, `propose-feature` artifacts | agent output | `ChatMessage.artifacts` JSON | Pending → Approved (creates DB row) / Rejected (terminal) |

The agent's tool surface gains two **non-creating** tools — `propose_initiative` and `propose_feature` — that emit artifacts on the streaming response. The agent still cannot write to the `Initiative` / `Feature` tables directly. The human approval step is the only path from chat to DB.

## The artifact shape

Lives inside an existing `ChatMessage.artifacts` row (model: `Artifact`, `content: Json`). One artifact per proposal — the agent typically emits several per assistant message, so a single message ends up with multiple artifacts.

```ts
type ProposalArtifact =
  | InitiativeProposal
  | FeatureProposal;

type ProposalBase = {
  type: "proposal";
  proposalId: string;            // agent-supplied; stable; idempotency key
  status: "pending" | "approved" | "rejected";
  resolvedAt?: string;           // ISO timestamp; set on approve/reject
  resolvedBy?: string;           // userId; set on approve/reject (relevant for forked chats)
  createdEntityId?: string;      // populated on approval; the real Initiative / Feature id
  rationale?: string;            // optional one-liner the agent supplies for "why this?"
};

type InitiativeProposal = ProposalBase & {
  kind: "initiative";
  payload: {
    name: string;                // required
    description?: string;
    status?: "DRAFT" | "ACTIVE";
    assigneeId?: string;
    startDate?: string;          // ISO
    targetDate?: string;
  };
};

type FeatureProposal = ProposalBase & {
  kind: "feature";
  payload: {
    title: string;               // required
    description?: string;
    workspaceId: string;         // required — agent picks from per-workspace context
    initiativeId?: string;       // optional — agent links to an existing initiative
    milestoneId?: string;        // optional — agent links to an existing milestone
    parentProposalId?: string;   // optional — references an InitiativeProposal in the
                                 // same conversation, so "feature under proposed
                                 // initiative" can resolve at approval time
  };
};
```

**`parentProposalId` is the key cross-proposal link.** When the agent proposes "initiative X with features A, B, C," the features carry `parentProposalId: <X's proposalId>`. The approval handler treats this specially:

- Approving the initiative first → `createdEntityId` is stamped; later feature approvals look up the parent's `createdEntityId` and use it as `initiativeId`.
- Approving a feature whose parent is still pending → API returns 409 with a clear message; UI shows "approve the parent initiative first" with a single "Approve initiative + this feature" combo button.
- Rejecting the parent does NOT auto-reject children — the agent might have proposed features that stand on their own. The UI surfaces this clearly.

## Storage & rehydration

**Storage:** the agent's tool execution returns a structured tool-result; the streaming pipeline (`useStreamProcessor` → `canvasChatStore`) writes the artifact into the assistant message's `artifacts` array. `useCanvasChatAutoSave` persists messages to `chat_conversations`; the `Artifact` rows fall out for free.

**Rehydration:** when a conversation loads, the existing message-load path already populates `message.artifacts`. We add a step that scans incoming artifacts for `type === "proposal"` and indexes them into the store's `proposals` map (keyed by `proposalId`).

```ts
// useCanvasChatStore — sketch of the slice
type ProposalsSlice = {
  proposals: Map<string, ProposalArtifact>;   // keyed by proposalId

  ingestArtifacts: (artifacts: ProposalArtifact[]) => void;
  setProposalStatus: (
    proposalId: string,
    patch: Pick<ProposalBase, "status" | "resolvedAt" | "resolvedBy" | "createdEntityId">,
  ) => void;
};
```

The store is the canvas-side **denormalized view**. The chat renders proposals from `message.artifacts` directly (so message ordering and artifact ordering are preserved). The store is for cross-cutting concerns (canvas badges/halos in future work, "is this proposal still pending?" lookups).

**Performance contract** (per CANVAS.md line 38): selectors that pull from the proposals map must use `useShallow`, fall back to a module-level empty-Map sentinel, and select narrowly. The chat list renders from the conversation's messages (already a stable selector), not from `state.proposals`.

## The agent tools

Add to `src/lib/ai/initiativeTools.ts` (same file, same `buildInitiativeTools(orgId, userId)` factory).

### `propose_initiative`

```
description:
  "Propose a new initiative for this org. Emits a chat artifact the user
   must approve — does NOT create the initiative. Use when the user asks
   you to suggest, draft, or sketch initiatives. After the user approves,
   you can attach features under it via `assign_feature_to_initiative`
   or by proposing features with parentProposalId set."

inputSchema:
  proposalId: string            // agent-generated; format: cuid-ish; stable
  name: string
  description?: string
  status?: "DRAFT" | "ACTIVE"   // default DRAFT
  assigneeId?: string
  startDate?: string
  targetDate?: string
  rationale?: string            // 1 line: why suggest this?

execute: returns the artifact JSON; the streaming handler attaches it.
```

### `propose_feature`

```
description:
  "Propose a new feature in a specific workspace, optionally under an
   existing or proposed initiative/milestone. Emits a chat artifact the
   user must approve. To group multiple features under a single
   not-yet-approved initiative, set parentProposalId to that initiative
   proposal's id; the approval step will wire them up automatically."

inputSchema:
  proposalId: string
  title: string
  description?: string
  workspaceId: string           // required
  initiativeId?: string         // existing initiative
  milestoneId?: string          // existing milestone
  parentProposalId?: string     // sibling InitiativeProposal in this conversation
  rationale?: string
```

**Validation in `execute`** (cheap, returns an error string if it fails — the agent retries):
- Workspace exists and belongs to this org. (Same `sourceControlOrgId` check pattern as `assign_feature_to_initiative`.)
- If `initiativeId` is supplied, it belongs to this org.
- If `milestoneId` is supplied, it belongs to that initiative (transitive via the existing `updateFeature` invariant).
- `parentProposalId` is **not** validated here — the conversation transcript isn't available to the tool. Validation happens at approval time on the server.

**Wiring** is already done: `src/app/api/ask/quick/route.ts` line 181 spreads `buildInitiativeTools(orgId, userId)` into the toolset for org-scoped chat. The two new tools join the existing `assign_feature_to_initiative` automatically.

**Prompt update:** `src/lib/constants/prompt.ts` `getCanvasPromptSuffix()` gains a paragraph teaching the agent *when* to propose vs. *when* to organize:

> "When the user asks you to suggest, draft, or sketch new initiatives or features, use `propose_initiative` and `propose_feature`. These do NOT create anything — they emit proposals the user reviews. When the user has already created an initiative and asks you to file existing features under it, use `assign_feature_to_initiative` instead. Never use `update_canvas` to author live nodes."

## The approval API

Single new endpoint, both kinds:

### `POST /api/orgs/[githubLogin]/proposals/[proposalId]/approve`

**Request body** (the artifact's `payload`, optionally with overrides — the user can edit the proposal before approving):

```ts
{
  payload: InitiativeProposal["payload"] | FeatureProposal["payload"];

  // What canvas the user is currently looking at when they approve.
  // The chat already has this from `OrgCanvasView.updateActiveContext`
  // (CANVAS.md line 37). Used so the new node lands on the canvas the
  // user is staring at, when projection rules allow it.
  currentRef?: string;

  // Sensible default placement coords on `currentRef`'s canvas.
  // Today the UI sends viewport-center; future drag-from-chat would
  // send drop coords. Server treats this as a hint, not a command.
  viewport?: { x: number; y: number };
}
```

**Behavior:**

1. Look up the message+artifact by `proposalId` (server-side scan via `chat_conversations` join — small N per conversation; index later if needed).
2. **Idempotency check:** if the artifact already has `status: "approved"` and a `createdEntityId`, return `{ status: "already_approved", entityId, landedOn }` immediately.
3. Validate org ownership of the caller (existing pattern from `initiativeTools.ts:97`).
4. Validate `payload` references (workspace belongs to org, etc.).
5. **Resolve `parentProposalId`** if present: look up the parent artifact in the same conversation; if it's `pending` → 409. If `approved` → use `parent.createdEntityId` as `initiativeId`. If `rejected` → 409 with a clear message.
6. Create the row inside a Prisma `$transaction`:
   - `kind === "initiative"` → `prisma.initiative.create({ data: { ...payload, orgId } })`.
   - `kind === "feature"` → `createFeature(...)` from the existing roadmap service (preserves the `feature.initiativeId === milestone.initiativeId` invariant).
7. **Place on the user's current canvas, when legal** (features only — initiatives only ever project on root, where positions are auto-laid-out by the projector; future-us can revisit if root layout grows custom).
   - Compute `landedOn`:
     - If `currentRef` is supplied AND `featureProjectsOn(currentRef, payload)` is true (see helper below) → `landedOn = currentRef`. Read the current canvas's `Canvas.data` blob, write `positions[<feature liveId>] = viewport ?? autoCascade(currentRef)`, save in the same transaction.
     - Otherwise → `landedOn = mostSpecificRef(payload)` (milestone if set, else initiative, else workspace — the existing projector rule). No position overlay written; the projector's row/column auto-layout handles it.
   - This is the same side-channel `Canvas.data` write the `+` button does (CANVAS.md gotcha line 24, line 27 — "side-channel DB writes from canvas interactions").
8. **Patch the artifact** in the same transaction: `status: "approved"`, `resolvedAt: now`, `resolvedBy: userId`, `createdEntityId: <new row id>`. Save the parent message.
9. Fan out `CANVAS_UPDATED` on the affected canvases via the existing helpers — for features, `notifyFeatureReassignmentRefresh` already covers root, both initiatives, both milestones, and the workspace; if `landedOn === currentRef` and the position overlay was written, that ref is in the fan-out set already so the position update goes out without an extra emit. For initiatives, `notifyCanvasUpdatedByLogin` on the root ref.
10. Return `{ status: "approved", entityId, landedOn, artifact }`. The chat UI uses `landedOn` to render either "Created on this canvas ✓" (when `landedOn === currentRef`) or "Created on Onboarding Revamp ↗" with a one-click `?canvas=<landedOn>` deep link (CANVAS.md gotcha line 33) when the feature landed elsewhere.

**`POST /api/orgs/[githubLogin]/proposals/[proposalId]/reject`**

1. Idempotency: if already rejected → no-op success.
2. Patch the artifact: `status: "rejected"`, `resolvedAt`, `resolvedBy`. Save the message.
3. No DB row, no Pusher fan-out.

If `payload` is omitted on approve, the server uses the artifact's stored payload verbatim. If the user edited it in the UI, the modified payload comes through and overrides the stored one **for this approval only** — we do not retroactively patch the artifact's `payload` field, because the chat history should reflect what the agent actually proposed.

## Shared helper: `featureProjectsOn`

The "place on current canvas if legal" rule has to match the projector's logic exactly, or the position overlay becomes dead weight written to a canvas where the feature doesn't render. Put the rule in **one place** and have both the approval handler and any future caller (drag-from-chat predicate, ghost-node placement) import it.

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
    // initiative-loose features (initiative set, milestone null) project here
    return (
      payload.initiativeId === ref.slice("initiative:".length) &&
      !payload.milestoneId
    );
  }
  if (ref.startsWith("ws:")) {
    // loose features (no initiative, no milestone) project on workspace
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

This is the canvas equivalent of `geometry.ts` — a single source of truth that prevents projector and approval logic from drifting. Tests live with the helper, not with the API route.

## The chat UX (v1: simple list)

Render a `<ProposalCard>` component per proposal artifact, inside the assistant message that emitted it. Multiple proposals in one message render as a small group with a header.

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

**States:**
- `pending`: full color, both buttons enabled.
- `approved`: dimmed-with-checkmark. Subtext shows where the new node landed:
  - If `landedOn === currentRef` (placed on the canvas the user was looking at) → "Created on this canvas ✓".
  - Else → "Created on **<initiative or workspace name>** ↗" — clicking the link navigates via `?canvas=<landedOn>` (CANVAS.md gotcha line 33).
- `rejected`: faded out, "Rejected" subtext, expandable to see what was proposed.

**"Approve all" button:** approves the parent initiative (if any) first, then children in `parentProposalId` order. Shows a small progress indicator if any single approval fails (rare — almost always validation), with per-row error display.

**Inline edit:** click any field in a pending proposal to edit before approving. Edits are local UI state; they're sent in the approve body's `payload` override. **Edits don't mutate the artifact** — chat history shows the original proposal.

**No drag, no auto-approve, no auto-dismiss.** The agent will be wrong sometimes; the click is the safety rail. Per the conversation that preceded this plan: "the agent's job is to make the proposal *good*, not to make approval *invisible*."

## Streaming flow (end-to-end)

1. User: *"propose 3 features for billing v2"*.
2. `useSendCanvasChatMessage` POSTs to `/api/ask/quick` with `orgId` set; `buildInitiativeTools` is in the toolset.
3. Agent text-streams a brief framing message ("Here are three I'd suggest:"), then calls `propose_feature` three times.
4. Each tool execution validates and returns a `ProposalArtifact` JSON. The streaming handler attaches each to the assistant message's `artifacts` array (existing path — same as how other tools' rich results attach).
5. `canvasChatStore` ingests artifacts as they stream in; UI re-renders the assistant message with `<ProposalCard>` rows appearing one by one.
6. `useCanvasChatAutoSave` persists the message + artifacts to `chat_conversations`.
7. User clicks Approve on one row → POST to the approve endpoint → DB row created → artifact patched → Pusher fan-out → projector picks up the new row → canvas shows it.

The whole pipeline is fire-and-forget on the canvas side: the chat doesn't know or care that the canvas refreshed. That's the boundary CANVAS.md's gotcha line 36 already establishes (chat and canvas talk through the store + Pusher, not direct calls).

## Forked / shared chats

Per CANVAS.md line 14, the share-fork flow gives each forker their own auto-save row. That means:

- A fork inherits the original conversation's messages, including any proposal artifacts.
- The fork sees `status: "approved"` and `createdEntityId` for proposals approved before the fork was made.
- The fork can independently approve a still-`pending` proposal — it would create a new DB row and patch the fork's copy of the artifact. (The original conversation's artifact stays `pending`.)
- This is fine and probably even useful — multiple users exploring the same agent suggestion can each act on it. If it becomes a problem, we add a global lock keyed on `proposalId` later. **Don't pre-engineer.**

The endpoint scopes its artifact lookup to the calling user's `chat_conversations`, so cross-user / cross-fork interference is naturally prevented.

## Future seams

These are intentionally not built in v1, but the design above keeps the path clean:

1. **Drag-from-chat-onto-canvas.** `payload` already matches canvas card props; approval endpoint already accepts `currentRef` + `viewport` (drag would just override `viewport` with drop coords and let `featureProjectsOn` validate). Adds: drag source on `<ProposalCard>`, drop target on the canvas surface (separate from the existing node-on-node drop), translation of drop coords. The placement logic on the server doesn't change.
2. **Ghost nodes on the canvas.** Projector overlay layer reads `state.proposals`, emits faded ghost nodes at auto-suggested positions. Approval = ghost solidifies. Implemented as a presentation-time merge after `readCanvas`, so projectors stay pure (per CANVAS.md line 11's projection contract).
3. **`propose_milestone`.** Same pattern as features. The only nuance is that milestones project on `initiative:<id>` sub-canvases, so the approval fan-out targets that ref.
4. **`propose_edge` for connections between initiatives or features.** Edges are already authored-blob entities (`Canvas.data.edges`); a proposal would patch the blob on approval. Different path from row-creating proposals — worth a separate small plan.
5. **Multi-user approval / review queue.** A new `Proposal` table becomes justified the moment proposals need a lifecycle independent of their conversation (e.g. "route this to a teammate"). Until that requirement appears: no table.
6. **Real card rendering instead of list rows.** The `<ProposalCard>` swap is one component; everything around it stays. Worth doing once the UX is clearly demanded — the hierarchy-rendering question (nest? connect with line? stack?) deserves a real prototype, not an assumption.

## Implementation order

A pragmatic sequence that ships value early and lets each step be tested in isolation.

1. **Artifact shape + types** (`src/lib/ai/types.ts` or a new `src/lib/proposals/types.ts`). One file, no behavior. PR-able alone.
2. **Store slice.** Extend `useCanvasChatStore` with `proposals` Map + `ingestArtifacts` + `setProposalStatus`. Add tests for ingestion + idempotent updates.
3. **Agent tools.** Add `propose_initiative` and `propose_feature` to `initiativeTools.ts`. Update prompt suffix in `prompt.ts`. Verify via the existing chat — proposals appear as raw JSON tool-results until step 4 lands.
4. **Shared helper.** Land `src/lib/canvas/feature-projection.ts` with `featureProjectsOn` + `mostSpecificRef`, plus unit tests covering each ref shape and each payload combination. PR-able alone; the approval API consumes it in step 5.
5. **Approval API.** New routes under `/api/orgs/[githubLogin]/proposals/[proposalId]/{approve,reject}`. Includes idempotency, parent resolution, transaction, position-overlay write when `featureProjectsOn(currentRef, payload)`, Pusher fan-out. Integration test: approve with `currentRef` matching projection writes the position; approve with mismatched `currentRef` skips the overlay and returns the correct `landedOn`.
6. **`<ProposalCard>` UI.** List rendering inside chat messages, ✓/✗ buttons, dim/fade states for resolved proposals, "Approve all" button, inline edit. Approve action sends `currentRef` (from `OrgCanvasView.updateActiveContext`) + viewport-center as `viewport`, renders the "Created on this canvas / Created on X ↗" subtext from the response's `landedOn`. The fully-styled-node version is explicitly **not** v1.
7. **Stream-time artifact attach.** Confirm the existing `useStreamProcessor` path attaches tool results to messages correctly; if not, narrow extension to detect `type: "proposal"` and route into `artifacts`.
8. **Rehydration.** Conversation load already populates `message.artifacts`; add a one-liner that calls `ingestArtifacts` after load completes.
9. **Update CANVAS.md.** A new bullet under the agent-tooling section pointing here. Reference: the doc is the orientation point, this plan is the source of truth.
10. **Smoke test the full loop:** open canvas, ask agent to propose, approve while on different scopes (root, workspace, initiative), confirm the node lands on the user's current canvas when projection allows and falls back gracefully when it doesn't. Manual for v1; a Playwright run is overkill until the UI stabilizes.

Each step except 6 is small (under ~150 LOC). Step 6 is the biggest piece and can be split into a stub-list-only PR followed by a polish PR. Don't try to ship 1-10 as one branch.

## What we are deliberately not building

Listed once, here, to keep scope honest:

- A `Proposal` Prisma table (and migration, and CRUD endpoints, and admin UI).
- A "pending proposals" inbox or notification badge.
- Auto-approval, auto-dismissal, or any timeout-driven state change.
- Drag-and-drop placement.
- Ghost nodes on the canvas.
- Proposing milestones, edges, decisions, or anything else not explicitly listed.
- Cross-conversation deduplication (i.e. "the agent already proposed this in another chat").
- Versioning of proposals (i.e. "the agent revised proposal X — show diff").

Each is a real feature that could become important. None is needed for the core loop *agent suggests → user approves → row appears on canvas*. Build the loop, watch usage, decide what's next from data.
