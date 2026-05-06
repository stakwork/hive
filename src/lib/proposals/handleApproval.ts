/**
 * Server-side handler for proposal Approve / Reject clicks.
 *
 * Called from `/api/ask/quick` as a pre-LLM step when the latest user
 * message carries `approvalIntent` or `rejectionIntent`. The chat is
 * the source of truth for proposal lifecycle (no DB tables track it),
 * so this handler is the only place state crosses from chat into DB
 * land for the agent-proposal feature.
 *
 * High level:
 *   1. Find the proposal in the conversation transcript by `proposalId`.
 *   2. Idempotency: if a prior `approvalResult` for this id exists,
 *      return it unchanged (no DB write).
 *   3. Resolve `parentProposalId` if present (initiative-grouped
 *      features). Pending parent → 409. Rejected parent → 409.
 *      Approved parent → use its `createdEntityId` as `initiativeId`.
 *   4. Merge inline-edit overrides onto the proposal's payload.
 *   5. Validate the effective payload (org ownership re-check).
 *   6. Create the row (`Initiative.create` or `createFeature`).
 *   7. Optionally write a `Canvas.data.positions[liveId]` overlay if
 *      the new feature legally projects on the user's current canvas.
 *   8. Fan out CANVAS_UPDATED on the affected canvases.
 *
 * Returns `ApprovalResult` (which the route writes onto the synthetic
 * assistant message's `approvalResult` field) or an error string the
 * route renders as the assistant text.
 */
import { db } from "@/lib/db";
import {
  notifyCanvasUpdated,
  setLivePosition,
  featureProjectsOn,
  mostSpecificRef,
  ROOT_REF,
} from "@/lib/canvas";
import { createFeature } from "@/services/roadmap";
import { notifyFeatureReassignmentRefresh } from "@/services/roadmap/feature-canvas-notify";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  type ApprovalIntent,
  type ApprovalResult,
  type FeatureProposalPayload,
  type InitiativeProposalPayload,
  type ProposalOutput,
  type RejectionIntent,
} from "./types";

// ─── Conversation-shape primitives ────────────────────────────────────
// We accept a permissive `MessageLike` to avoid a runtime dependency
// on the chat store types (this module is server-only). Only the fields
// the scan reads are required.

export interface ToolCallLike {
  toolName: string;
  output?: unknown;
}

export interface MessageLike {
  role: "user" | "assistant" | string;
  toolCalls?: ToolCallLike[];
  approval?: ApprovalIntent;
  rejection?: RejectionIntent;
  approvalResult?: ApprovalResult;
}

// ─── Approval result helpers ──────────────────────────────────────────

export type HandleApprovalReturn =
  | { ok: true; result: ApprovalResult; alreadyApproved: boolean }
  | { ok: false; error: string; status: number };

export type HandleRejectionReturn = { ok: true } | { ok: false; error: string };

/**
 * Walk the conversation transcript backward looking for an assistant
 * message that emitted a propose tool call with this proposalId.
 * Returns the structured `ProposalOutput` it carried.
 */
function findProposal(
  messages: MessageLike[],
  proposalId: string,
): ProposalOutput | null {
  // Scan backward — most recently emitted proposals dominate. (In
  // practice each proposalId is unique per agent turn, so direction
  // is moot, but backward is cheaper for long transcripts.)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.toolCalls) continue;
    for (const tc of msg.toolCalls) {
      if (
        tc.toolName !== PROPOSE_INITIATIVE_TOOL &&
        tc.toolName !== PROPOSE_FEATURE_TOOL
      )
        continue;
      const out = tc.output;
      if (!out || typeof out !== "object") continue;
      // Tool errors land as `{ error: "..." }` — skip those, the
      // proposal never validated.
      if ("error" in out) continue;
      const candidate = out as ProposalOutput;
      if (candidate.proposalId === proposalId) return candidate;
    }
  }
  return null;
}

/**
 * Find the prior `approvalResult` for this proposalId, if any.
 * The route writes one of these onto its synthetic assistant message
 * after a successful approval; finding one means the click already
 * landed and we should short-circuit (idempotency).
 */
function findPriorApproval(
  messages: MessageLike[],
  proposalId: string,
): ApprovalResult | null {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (msg.approvalResult?.proposalId === proposalId) {
      return msg.approvalResult;
    }
  }
  return null;
}

function findPriorRejection(
  messages: MessageLike[],
  proposalId: string,
): boolean {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (msg.rejection?.proposalId === proposalId) return true;
  }
  return false;
}

/**
 * Resolve the human-readable name of the entity a new proposal "landed
 * on" — i.e. the workspace / initiative whose canvas the new row will
 * project on. Returns `undefined` for the root canvas (no single
 * entity owns it) and on lookup failure (caller falls back to a
 * kind-based label).
 *
 * Single round-trip per approval, keyed on the id-prefix convention
 * the projector uses (`ws:` / `initiative:` / `feature:`). Milestone-
 * bound features land on `initiative:<id>` (milestones aren't
 * drillable scopes); the legacy `milestone:` branch is kept as a
 * defensive fallback in case any pre-cutover proposal trail still
 * carries that ref. The lookup is deliberately scoped by `orgId` so
 * a forged ref from a different org can't leak a name.
 */
async function resolveLandedOnName(
  orgId: string,
  landedOn: string,
): Promise<string | undefined> {
  if (!landedOn) return undefined;
  try {
    if (landedOn.startsWith("ws:")) {
      const id = landedOn.slice(3);
      const ws = await db.workspace.findFirst({
        where: { id, sourceControlOrgId: orgId, deleted: false },
        select: { name: true },
      });
      return ws?.name ?? undefined;
    }
    if (landedOn.startsWith("initiative:")) {
      const id = landedOn.slice("initiative:".length);
      const init = await db.initiative.findFirst({
        where: { id, orgId },
        select: { name: true },
      });
      return init?.name ?? undefined;
    }
    if (landedOn.startsWith("milestone:")) {
      const id = landedOn.slice("milestone:".length);
      const m = await db.milestone.findFirst({
        where: { id, initiative: { orgId } },
        select: { name: true },
      });
      return m?.name ?? undefined;
    }
    if (landedOn.startsWith("feature:")) {
      const id = landedOn.slice("feature:".length);
      const f = await db.feature.findFirst({
        where: { id, workspace: { sourceControlOrgId: orgId } },
        select: { title: true },
      });
      return f?.title ?? undefined;
    }
  } catch (e) {
    // Non-fatal: a missing name just degrades the assistant text to
    // the kind-based fallback. Don't fail the whole approval over it.
    console.error("[handleApproval.resolveLandedOnName] lookup failed:", e);
  }
  return undefined;
}

// ─── Approve ──────────────────────────────────────────────────────────

interface HandleApprovalArgs {
  orgId: string;
  userId: string;
  /** The full chat-side conversation transcript (raw `CanvasChatMessage[]`). */
  messages: MessageLike[];
  intent: ApprovalIntent;
}

export async function handleApproval(
  args: HandleApprovalArgs,
): Promise<HandleApprovalReturn> {
  const { orgId, userId, messages, intent } = args;

  // 1. Find the proposal.
  const proposal = findProposal(messages, intent.proposalId);
  if (!proposal) {
    return {
      ok: false,
      error:
        "Proposal not found in this conversation. The agent may have rolled it back.",
      status: 404,
    };
  }

  // 2. Idempotency.
  const prior = findPriorApproval(messages, intent.proposalId);
  if (prior) {
    return { ok: true, result: prior, alreadyApproved: true };
  }

  if (proposal.kind === "initiative") {
    return approveInitiative({
      orgId,
      proposal,
      intent,
    });
  }
  return approveFeature({
    orgId,
    userId,
    messages,
    proposal,
    intent,
  });
}

// ── Approve: initiative ─────────────────────────────────────────────

async function approveInitiative(args: {
  orgId: string;
  proposal: Extract<ProposalOutput, { kind: "initiative" }>;
  intent: ApprovalIntent;
}): Promise<HandleApprovalReturn> {
  const { orgId, proposal, intent } = args;
  const merged: InitiativeProposalPayload = {
    ...proposal.payload,
    ...(intent.payload as Partial<InitiativeProposalPayload>),
  };

  if (!merged.name || !merged.name.trim()) {
    return { ok: false, error: "Initiative name is required.", status: 400 };
  }

  try {
    const created = await db.initiative.create({
      data: {
        orgId,
        name: merged.name.trim(),
        ...(merged.description !== undefined && {
          description: merged.description,
        }),
        ...(merged.status !== undefined && { status: merged.status }),
        ...(merged.assigneeId !== undefined && {
          assigneeId: merged.assigneeId,
        }),
        ...(merged.startDate !== undefined && {
          startDate: merged.startDate ? new Date(merged.startDate) : null,
        }),
        ...(merged.targetDate !== undefined && {
          targetDate: merged.targetDate ? new Date(merged.targetDate) : null,
        }),
      },
      select: { id: true },
    });

    // Initiatives only project on root, where the projector
    // auto-lays them out — no `currentRef` overlay write here.
    void notifyCanvasUpdated(orgId, ROOT_REF, "initiative-created", {
      initiativeId: created.id,
      proposalId: proposal.proposalId,
    });

    return {
      ok: true,
      alreadyApproved: false,
      result: {
        proposalId: proposal.proposalId,
        kind: "initiative",
        createdEntityId: created.id,
        landedOn: ROOT_REF,
      },
    };
  } catch (e) {
    console.error("[handleApproval] initiative create failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create initiative.",
      status: 500,
    };
  }
}

// ── Approve: feature ────────────────────────────────────────────────

async function approveFeature(args: {
  orgId: string;
  userId: string;
  messages: MessageLike[];
  proposal: Extract<ProposalOutput, { kind: "feature" }>;
  intent: ApprovalIntent;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, messages, proposal, intent } = args;

  const merged: FeatureProposalPayload = {
    ...proposal.payload,
    ...(intent.payload as Partial<FeatureProposalPayload>),
  };

  if (!merged.title || !merged.title.trim()) {
    return { ok: false, error: "Feature title is required.", status: 400 };
  }
  if (!merged.workspaceId) {
    return { ok: false, error: "Feature workspaceId is required.", status: 400 };
  }

  // Resolve parentProposalId (if any).
  let resolvedInitiativeId = merged.initiativeId ?? null;
  if (merged.parentProposalId) {
    if (resolvedInitiativeId) {
      return {
        ok: false,
        error:
          "Feature has both `initiativeId` and `parentProposalId`. Pick one.",
        status: 400,
      };
    }
    if (findPriorRejection(messages, merged.parentProposalId)) {
      return {
        ok: false,
        error: "The parent initiative for this feature was rejected.",
        status: 409,
      };
    }
    const parentResult = findPriorApproval(messages, merged.parentProposalId);
    if (!parentResult) {
      return {
        ok: false,
        error:
          "Approve the parent initiative first — its row hasn't been created yet.",
        status: 409,
      };
    }
    if (parentResult.kind !== "initiative") {
      return {
        ok: false,
        error: "parentProposalId must reference an initiative proposal.",
        status: 400,
      };
    }
    resolvedInitiativeId = parentResult.createdEntityId;
  }

  // Re-validate workspace + (optionally) initiative + milestone in
  // case the inline-edit overrides changed them. The propose tool
  // already validated, but the user could have edited workspace or
  // initiative ids before approving.
  const workspace = await db.workspace.findFirst({
    where: {
      id: merged.workspaceId,
      sourceControlOrgId: orgId,
      deleted: false,
    },
    select: { id: true },
  });
  if (!workspace) {
    return {
      ok: false,
      error: "Workspace not found in this organization.",
      status: 404,
    };
  }
  if (resolvedInitiativeId) {
    const initiative = await db.initiative.findFirst({
      where: { id: resolvedInitiativeId, orgId },
      select: { id: true },
    });
    if (!initiative) {
      return {
        ok: false,
        error: "Initiative not found in this organization.",
        status: 404,
      };
    }
  }
  if (merged.milestoneId) {
    const milestone = await db.milestone.findFirst({
      where: { id: merged.milestoneId, initiative: { orgId } },
      select: { id: true, initiativeId: true },
    });
    if (!milestone) {
      return {
        ok: false,
        error: "Milestone not found in this organization.",
        status: 404,
      };
    }
    if (resolvedInitiativeId && resolvedInitiativeId !== milestone.initiativeId) {
      return {
        ok: false,
        error:
          "Milestone does not belong to the supplied initiative. Pass only milestoneId — initiative is derived.",
        status: 400,
      };
    }
    // Derive initiativeId from the milestone for createFeature's
    // invariant check.
    resolvedInitiativeId = milestone.initiativeId;
  }

  try {
    const feature = await createFeature(userId, {
      title: merged.title.trim(),
      workspaceId: merged.workspaceId,
      ...(merged.description !== undefined && { brief: merged.description }),
      ...(resolvedInitiativeId && { initiativeId: resolvedInitiativeId }),
      ...(merged.milestoneId && { milestoneId: merged.milestoneId }),
    });

    const featurePlacementPayload = {
      workspaceId: merged.workspaceId,
      initiativeId: resolvedInitiativeId,
      milestoneId: merged.milestoneId ?? null,
    };

    // Decide where the new node lands. If the user is currently
    // looking at a canvas where the feature legally projects, land
    // it there at the requested viewport coords. Otherwise fall
    // back to the most-specific projection canvas; the projector's
    // auto-layout handles placement.
    const liveId = `feature:${feature.id}`;
    let landedOn: string;
    if (
      intent.currentRef !== undefined &&
      featureProjectsOn(intent.currentRef, featurePlacementPayload)
    ) {
      landedOn = intent.currentRef;
      if (intent.viewport) {
        try {
          await setLivePosition(orgId, landedOn, liveId, intent.viewport);
        } catch (e) {
          // Position-overlay write failures are non-fatal — the
          // feature still exists, it just lands at the projector's
          // default. Log and move on.
          console.error("[handleApproval] setLivePosition failed:", e);
        }
      }
    } else {
      landedOn = mostSpecificRef(featurePlacementPayload);
    }

    // Look up the human-readable name of the canvas the feature
    // landed on, so the assistant text can say "Created **Tiered
    // Pricing** under **Billing v2**" instead of "Created on an
    // initiative canvas." Skipped when `landedOn` is root (no entity
    // name to resolve).
    const landedOnName = await resolveLandedOnName(orgId, landedOn);

    // Fan out on every canvas the feature might affect. The
    // reassignment helper covers root, both initiatives, both
    // milestones, and the workspace — it's the most thorough fan-out
    // we have. The "before" snapshot is the empty placement (the
    // feature didn't exist before); the helper handles the
    // creation case correctly because it just unions before+after.
    void notifyFeatureReassignmentRefresh(feature.id, {
      milestoneId: null,
      initiativeId: null,
      workspaceId: merged.workspaceId,
    });

    // Seed the new feature's plan chat with the agent's one-sentence
    // directive. This persists a USER `ChatMessage` and triggers the
    // Stakwork plan_mode workflow with `isFirstMessage: true`, which:
    //   1. Performs research on the brief.
    //   2. Calls `PUT /api/features/[id]/title` to auto-rename the
    //      feature to a semantic name derived from the research.
    //   3. Posts back PLAN artifacts that fill in `requirements /
    //      architecture / userStories`.
    //
    // Without this seed, the feature row exists but its chat is
    // empty — the planning workflow never starts, and whatever the
    // user *eventually* types in the feature chat ends up being the
    // research seed (which produced the wrong title in production:
    // "begin the research" → "Research Initiation Tool").
    //
    // Non-fatal: if seeding fails we still report success for the
    // proposal. The feature row exists; the user can manually send
    // a first message from the feature page.
    const seed = merged.initialMessage?.trim() || merged.title.trim();
    if (seed) {
      try {
        await sendFeatureChatMessage({
          featureId: feature.id,
          userId,
          message: seed,
        });
      } catch (e) {
        console.error(
          "[handleApproval] failed to seed feature chat (feature row still created):",
          e,
        );
      }
    }

    return {
      ok: true,
      alreadyApproved: false,
      result: {
        proposalId: proposal.proposalId,
        kind: "feature",
        createdEntityId: feature.id,
        landedOn,
        ...(landedOnName && { landedOnName }),
      },
    };
  } catch (e) {
    console.error("[handleApproval] feature create failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create feature.",
      status: 500,
    };
  }
}

// ─── Reject ───────────────────────────────────────────────────────────

interface HandleRejectionArgs {
  messages: MessageLike[];
  intent: RejectionIntent;
}

/**
 * Rejection has no DB side effect — the rejection is purely a chat
 * event. We only validate that the proposal exists in the conversation
 * (so a misclick / stale UI doesn't silently no-op forever).
 */
export function handleRejection(
  args: HandleRejectionArgs,
): HandleRejectionReturn {
  const { messages, intent } = args;
  const proposal = findProposal(messages, intent.proposalId);
  if (!proposal) {
    return {
      ok: false,
      error: "Proposal not found in this conversation.",
    };
  }
  return { ok: true };
}
