/**
 * Shared types for agent-proposed initiatives and features.
 *
 * The chat is the source of truth for proposal lifecycle:
 *   - The `propose_initiative` / `propose_feature` agent tools return
 *     a `ProposalOutput` from `execute(...)`. The streaming reducer
 *     already lifts tool outputs into `CanvasChatMessage.toolCalls[].
 *     output`, so a proposal lives in the conversation transcript for
 *     free.
 *   - The user clicks Approve / Reject in `<ProposalCard>`. Each click
 *     appends a normal user message carrying an `ApprovalIntent` /
 *     `RejectionIntent` field. The user-side message is suppressed
 *     visually — the card transition IS the user feedback.
 *   - The `/api/ask/quick` route detects the intent on the latest user
 *     message, runs the side effect (validate, create Initiative /
 *     Feature, write canvas position overlay if legal, fan out
 *     CANVAS_UPDATED), and streams a synthetic assistant message with
 *     `ApprovalResult` populated.
 *   - Status is *derived* from the conversation: a card scans the full
 *     message list for a matching `approvalResult` (→ approved) or
 *     `rejection` (→ rejected) by `proposalId`.
 *
 * Therefore: no DB schema changes, no new tables, no rehydration logic
 * beyond "load the conversation as you already do." Forks inherit the
 * proposal trail naturally.
 *
 * Idempotency on Approve: re-clicking just appends another approval
 * message. The route's pre-LLM scan finds the existing `approvalResult`
 * and short-circuits, returning the same `createdEntityId` again.
 */

import type { InitiativeStatus, MilestoneStatus } from "@prisma/client";

// ─── Tool input/output shapes ──────────────────────────────────────────

/**
 * Payload the agent fills in for an `Initiative` proposal. Matches the
 * fields `prisma.initiative.create` accepts at approval time. Optional
 * fields stay optional through to creation.
 */
export interface InitiativeProposalPayload {
  name: string;
  description?: string;
  status?: InitiativeStatus; // DRAFT | ACTIVE | COMPLETED | ARCHIVED
  assigneeId?: string;
  startDate?: string; // ISO; the route parses to Date
  targetDate?: string; // ISO
}

/**
 * Payload the agent fills in for a `Feature` proposal. Matches the
 * input shape `createFeature(...)` expects. `parentProposalId` is the
 * cross-proposal link: when the agent proposes "initiative X with
 * features A, B, C," the features carry `parentProposalId: X`. The
 * approval handler resolves it by scanning the conversation for X's
 * `ApprovalResult` and using `createdEntityId` as the `initiativeId`.
 */
export interface FeatureProposalPayload {
  title: string;
  description?: string;
  workspaceId: string;
  initiativeId?: string;
  milestoneId?: string;
  parentProposalId?: string;
  /**
   * One-sentence directive ("what should be created") that becomes the
   * first USER `ChatMessage` on the new feature's plan chat after
   * approval. This is what kicks off the Stakwork plan_mode workflow,
   * which performs research and then auto-renames the feature via
   * `PUT /api/features/[id]/title`. Distinct from `description`
   * (the brief): the brief is durable context shown on the feature
   * page; `initialMessage` is the seed prompt for the planning agent.
   */
  initialMessage?: string;
}

/**
 * Payload the agent fills in for a `Milestone` proposal.
 *
 * Milestones belong to a single initiative — `initiativeId` is required.
 * `sequence` is intentionally absent: the approval handler computes
 * `MAX(sequence) + 1` for the initiative inside the create transaction
 * (with a small retry on `P2002` for the `(initiativeId, sequence)`
 * unique index), so the agent doesn't race with concurrent human
 * `+ Milestone` clicks.
 *
 * `featureIds` is the load-bearing extra: a milestone proposal can
 * carry a list of features to attach on approval. Every id MUST
 * already belong to `initiativeId` — the propose tool re-validates
 * this, the approval handler re-validates again. Empty array is legal
 * (a milestone with no features yet; the user can attach later via
 * the canvas drag/edge gestures). The agent should bias the list
 * toward features whose `milestoneId IS NULL` ("unlinked" features
 * on the initiative canvas — those without a synthetic edge to any
 * milestone card). Re-attaching an already-linked feature works but
 * moves it from its current milestone; the card surfaces this as a
 * warning so the user approves knowingly.
 */
export interface MilestoneProposalPayload {
  initiativeId: string;
  name: string;
  description?: string;
  status?: MilestoneStatus; // NOT_STARTED | IN_PROGRESS | COMPLETED
  dueDate?: string; // ISO; the route parses to Date
  assigneeId?: string;
  featureIds: string[];
}

/**
 * Render-only metadata for the milestone proposal's feature checklist.
 * Resolved server-side by the propose tool from the same query that
 * validates `featureIds`, so the card doesn't need a fetch on render
 * and the chat transcript stays self-describing across reloads.
 *
 * The approval handler does NOT trust this — it always re-fetches
 * before writing.
 */
export interface MilestoneFeatureMeta {
  id: string;
  title: string;
  currentMilestoneId: string | null;
  currentMilestoneName: string | null;
}

/**
 * Render-only metadata for a feature proposal. Resolved server-side
 * by `propose_feature` from the same queries that validate
 * `workspaceSlug` / `initiativeId` / `milestoneId`, so the proposal
 * card can render human-readable names ("Hive · Auth Refactor")
 * instead of opaque cuid suffixes ("ws s9vogz · init ebbk65"). The
 * chat transcript stays self-describing across reloads — no fetch
 * on render.
 *
 * Names beat ids for any user-facing UI (CANVAS.md gotchas).
 *
 * Optional fields: `initiativeName` / `milestoneName` are absent
 * when the corresponding id was not supplied. Older proposals
 * (pre-meta) won't carry this object at all; the card falls back
 * to a cuid-suffix hint in that case.
 *
 * The approval handler does NOT trust this — names are resolved
 * again at create time for `landedOnName`.
 */
export interface FeatureProposalMeta {
  workspaceName: string;
  workspaceSlug: string;
  initiativeName?: string;
  milestoneName?: string;
}

/**
 * Render-only metadata for a milestone proposal. Resolved server-side
 * by `propose_milestone` from the parent-initiative validation query.
 * Same rationale as `FeatureProposalMeta` — names beat cuid suffixes
 * for the under-initiative subtext on the card.
 *
 * Older proposals won't carry this object; the card falls back to a
 * cuid-suffix hint.
 */
export interface MilestoneProposalMeta {
  initiativeName: string;
}

/** What the propose tools return from `execute(...)` on success. */
export type ProposalOutput =
  | {
      kind: "initiative";
      proposalId: string;
      payload: InitiativeProposalPayload;
      rationale?: string;
    }
  | {
      kind: "feature";
      proposalId: string;
      payload: FeatureProposalPayload;
      rationale?: string;
      /** Resolved workspace / initiative / milestone names for the
       *  card subtext. Render-only; the handler re-fetches.
       *  Optional for backward compat with pre-meta proposals. */
      meta?: FeatureProposalMeta;
    }
  | {
      kind: "milestone";
      proposalId: string;
      payload: MilestoneProposalPayload;
      rationale?: string;
      /** Resolved feature titles + current-milestone names for the
       *  card's checklist. Render-only; the handler re-fetches. */
      featureMeta: MilestoneFeatureMeta[];
      /** Resolved parent-initiative name for the card subtext.
       *  Render-only; optional for backward compat with pre-meta
       *  proposals. */
      meta?: MilestoneProposalMeta;
    };

/**
 * Tool name constants — referenced by the chat UI to find proposal
 * tool calls inside `message.toolCalls[]`, by the route's scanner, and
 * by the agent tool factory. Single source so a rename is one edit.
 */
export const PROPOSE_INITIATIVE_TOOL = "propose_initiative" as const;
export const PROPOSE_FEATURE_TOOL = "propose_feature" as const;
export const PROPOSE_MILESTONE_TOOL = "propose_milestone" as const;

export type ProposeToolName =
  | typeof PROPOSE_INITIATIVE_TOOL
  | typeof PROPOSE_FEATURE_TOOL
  | typeof PROPOSE_MILESTONE_TOOL;

// ─── Approval / rejection intent (rides on user messages) ──────────────

/**
 * Set on a user message when the user clicks Approve. The message's
 * `content` carries a human-readable string for transcript readability
 * but the UI suppresses rendering of approval-bearing user messages —
 * the card's state transition is the user feedback.
 *
 * `payload` carries inline-edit overrides. Fields the user changed in
 * the card before clicking Approve land here; the route merges
 * `{ ...proposal.payload, ...intent.payload }` for the effective
 * create call. The original tool-call output is never mutated.
 *
 * `currentRef` and `viewport` are placement hints for features. The
 * route checks `featureProjectsOn(currentRef, payload)` before writing
 * a `Canvas.data.positions[liveId]` overlay; mismatches fall back to
 * `mostSpecificRef(payload)` and skip the overlay.
 */
export interface ApprovalIntent {
  proposalId: string;
  payload?:
    | Partial<InitiativeProposalPayload>
    | Partial<FeatureProposalPayload>
    | Partial<MilestoneProposalPayload>;
  currentRef?: string;
  viewport?: { x: number; y: number };
}

/** Set on a user message when the user clicks Reject. */
export interface RejectionIntent {
  proposalId: string;
}

// ─── Approval result (rides on the synthetic assistant message) ────────

/**
 * What `/api/ask/quick` writes onto the streamed-back assistant message
 * after running the approval handler. The card's status scan picks this
 * up and flips to "approved." `landedOn` drives the subtext: "Created
 * on this canvas ✓" if it matches the user's `currentRef`, otherwise
 * "Created on <name> ↗" with a deep-link to that canvas.
 *
 * `landedOnName` is the human-readable name of the entity the new row
 * landed *under* (the workspace / initiative / milestone whose ref is
 * `landedOn`). Resolved by `handleApproval` at create time so the
 * synthesized assistant text and the card subtext can say "Created on
 * **Auth Refactor**" instead of "Created on an initiative canvas." Not
 * set when `landedOn === ""` (root) — the root has no entity name.
 */
export interface ApprovalResult {
  proposalId: string;
  kind: "initiative" | "feature" | "milestone";
  createdEntityId: string;
  /** Canvas ref the new node landed on. Empty string = root. */
  landedOn: string;
  /**
   * Display name of the entity at `landedOn` (workspace / initiative /
   * milestone name). Optional: omitted for the root canvas, and may be
   * absent on older approval results that pre-date this field — code
   * consuming it must fall back to a kind-based label.
   */
  landedOnName?: string;
}

// ─── Status derivation (pure helper) ───────────────────────────────────

export type ProposalStatus =
  | { status: "pending" }
  | { status: "pending-in-flight" } // Approve clicked, server hasn't replied yet
  | { status: "approved"; result: ApprovalResult }
  | { status: "rejected" };

/**
 * Minimal shape we need from a `CanvasChatMessage` to derive proposal
 * status. Declared locally to avoid a cross-package import cycle (the
 * canvas chat store imports types from here, not the other way around).
 */
interface MessageForStatusScan {
  role: "user" | "assistant";
  approval?: ApprovalIntent;
  rejection?: RejectionIntent;
  approvalResult?: ApprovalResult;
}

/**
 * Resolve a proposal's lifecycle status from the conversation transcript.
 *
 * Scan order is forward — the first matching terminal event wins.
 *
 *   - assistant message with `approvalResult.proposalId === id` → approved.
 *   - user message with `rejection.proposalId === id` → rejected.
 *   - user message with `approval.proposalId === id` AND no later
 *     `approvalResult` → in flight (Approve was clicked, the route's
 *     synthetic confirmation hasn't streamed back yet).
 *   - otherwise → pending.
 *
 * `approvalResult` short-circuits over `rejection` when both exist
 * (shouldn't happen, but if it did, the row got created — the DB is
 * authoritative). Subsequent re-approvals are no-ops by the route's
 * idempotency scan; we don't need to model "approved twice."
 */
export function getProposalStatus(
  messages: MessageForStatusScan[],
  proposalId: string,
): ProposalStatus {
  let sawApprovalIntent = false;

  for (const msg of messages) {
    if (
      msg.role === "assistant" &&
      msg.approvalResult?.proposalId === proposalId
    ) {
      return { status: "approved", result: msg.approvalResult };
    }
    if (msg.role === "user" && msg.rejection?.proposalId === proposalId) {
      return { status: "rejected" };
    }
    if (msg.role === "user" && msg.approval?.proposalId === proposalId) {
      sawApprovalIntent = true;
    }
  }

  return sawApprovalIntent ? { status: "pending-in-flight" } : { status: "pending" };
}
