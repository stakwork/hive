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
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  notifyCanvasUpdated,
  setLivePosition,
  featureProjectsOn,
  mostSpecificRef,
  readAssignedFeatures,
  resolvePlacement,
  ROOT_REF,
} from "@/lib/canvas";
import { createFeature } from "@/services/roadmap";
import { notifyFeatureReassignmentRefresh } from "@/lib/canvas";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  type ApprovalIntent,
  type ApprovalResult,
  type FeatureProposalPayload,
  type InitiativeProposalPayload,
  type MilestoneProposalPayload,
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
        tc.toolName !== PROPOSE_FEATURE_TOOL &&
        tc.toolName !== PROPOSE_MILESTONE_TOOL
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
  if (proposal.kind === "milestone") {
    return approveMilestone({
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

    // Initiatives project only on root. If the agent supplied a
    // resolvable placement hint, land the new card there; otherwise
    // the projector's auto-layout (initiative row on root) decides.
    // No fallback to `intent.viewport` here — the human `+` flow
    // for initiatives goes through the dialog, not through this
    // approval path.
    const liveId = `initiative:${created.id}`;
    const coords = await resolvePlacement(merged.placement, {
      orgId,
      targetRef: ROOT_REF,
      newCategory: "initiative",
    });
    if (coords) {
      try {
        await setLivePosition(orgId, ROOT_REF, liveId, coords);
      } catch (e) {
        console.error(
          "[handleApproval] setLivePosition (initiative) failed:",
          e,
        );
      }
    }

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
      featureId: feature.id,
    };

    // Decide where the new node lands. Two questions:
    //   1. Which canvas? If the user is looking at a canvas where the
    //      feature legally projects, prefer that — they'll see it
    //      appear without navigating. Otherwise fall back to the
    //      most-specific projection canvas.
    //   2. Where on that canvas? Three-way priority:
    //        a. Agent's `placement` hint resolves cleanly → use it.
    //        b. Else, user's click hint (`intent.viewport`) on the
    //           current canvas → use it (mirrors the human `+` flow).
    //        c. Else, no overlay → projector auto-layout decides.
    //
    // Workspace-canvas special case: the workspace canvas only
    // projects features that are explicitly pinned via
    // `CanvasBlob.assignedFeatures`. When the user approves a loose-
    // feature proposal while looking at a workspace canvas, we
    // auto-pin the new feature to that canvas so it lands where
    // they're looking. This mirrors the human "+ Feature → Assign
    // existing" flow's pin step, and is what makes
    // `featureProjectsOn(currentRef, ...)` return true below.
    const liveId = `feature:${feature.id}`;
    if (
      intent.currentRef !== undefined &&
      intent.currentRef.startsWith("ws:") &&
      intent.currentRef === `ws:${merged.workspaceId}` &&
      !resolvedInitiativeId &&
      !merged.milestoneId
    ) {
      try {
        const { assignFeatureOnCanvas } = await import("@/lib/canvas");
        await assignFeatureOnCanvas(orgId, intent.currentRef, feature.id);
      } catch (e) {
        console.error("[handleApproval] auto-pin to workspace canvas failed:", e);
      }
    }
    // Read the post-pin assignment list so `featureProjectsOn` sees
    // the auto-pin we just wrote (when applicable). Cheap one-row
    // read; skipped when the user isn't on a workspace canvas.
    let landedOn: string;
    const refForPinCheck =
      intent.currentRef !== undefined && intent.currentRef.startsWith("ws:")
        ? intent.currentRef
        : null;
    const assignedFeatures = refForPinCheck
      ? await readAssignedFeatures(orgId, refForPinCheck)
      : undefined;
    if (
      intent.currentRef !== undefined &&
      featureProjectsOn(
        intent.currentRef,
        featurePlacementPayload,
        assignedFeatures,
      )
    ) {
      landedOn = intent.currentRef;
    } else {
      landedOn = mostSpecificRef(featurePlacementPayload);
    }

    // (a) Agent placement first — wins over `intent.viewport` because
    // the agent has typically read the canvas and picked a deliberate
    // anchor; the viewport hint is a hardcoded `{40,40}` placeholder
    // until drag-from-chat lands.
    let coords = await resolvePlacement(merged.placement, {
      orgId,
      targetRef: landedOn,
      newCategory: "feature",
    });
    // (b) Fallback to user's viewport hint, but only when the user is
    // looking at the canvas the feature actually lands on (matches
    // the previous behavior for non-placement proposals).
    if (!coords && intent.currentRef === landedOn && intent.viewport) {
      coords = intent.viewport;
    }
    if (coords) {
      try {
        await setLivePosition(orgId, landedOn, liveId, coords);
      } catch (e) {
        // Position-overlay write failures are non-fatal — the
        // feature still exists, it just lands at the projector's
        // default. Log and move on.
        console.error("[handleApproval] setLivePosition failed:", e);
      }
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

// ── Approve: milestone ──────────────────────────────────────────────
//
// Creates the Milestone row + PATCHes feature.milestoneId for each
// `featureIds[i]` in the same transaction. `sequence` is computed as
// `MAX(sequence) + 1` for the initiative; we retry on `P2002` (unique
// `(initiativeId, sequence)` index) up to a few times in case a human
// `+ Milestone` click landed concurrently.
//
// Position-overlay write only when the user is currently looking at
// the parent initiative canvas (the only canvas a milestone projects
// on). Pusher fan-out: the parent initiative ref + root + per-feature
// reassignment refresh (covers both old and new milestone refs, the
// initiative, and the workspace).

const MAX_SEQUENCE_RETRIES = 3;

async function approveMilestone(args: {
  orgId: string;
  proposal: Extract<ProposalOutput, { kind: "milestone" }>;
  intent: ApprovalIntent;
}): Promise<HandleApprovalReturn> {
  const { orgId, proposal, intent } = args;

  // Inline-edit overrides. `featureIds` is a full replacement (the
  // user toggled checkboxes; their post-toggle list is authoritative),
  // matching how `name` replaces (not merges) in the other arms.
  const merged: MilestoneProposalPayload = {
    ...proposal.payload,
    ...(intent.payload as Partial<MilestoneProposalPayload>),
  };

  if (!merged.name || !merged.name.trim()) {
    return { ok: false, error: "Milestone name is required.", status: 400 };
  }
  if (!merged.initiativeId) {
    return {
      ok: false,
      error: "Milestone initiativeId is required.",
      status: 400,
    };
  }

  // Re-validate initiative ownership.
  const initiative = await db.initiative.findFirst({
    where: { id: merged.initiativeId, orgId },
    select: { id: true },
  });
  if (!initiative) {
    return {
      ok: false,
      error: "Initiative not found in this organization.",
      status: 404,
    };
  }

  // Re-validate every feature in `featureIds`. The user may have
  // toggled new ids in via inline edit that the propose tool never
  // saw, OR a feature may have been reassigned/deleted between
  // propose and approve. Bail if any id fails — partial attach is
  // worse than no attach.
  const featureIds = Array.from(new Set(merged.featureIds ?? []));
  let priorMilestonesByFeatureId = new Map<string, string | null>();
  let workspaceIdByFeatureId = new Map<string, string>();
  let initiativeIdByFeatureId = new Map<string, string>();
  if (featureIds.length > 0) {
    const features = await db.feature.findMany({
      where: { id: { in: featureIds }, deleted: false },
      select: {
        id: true,
        initiativeId: true,
        milestoneId: true,
        workspaceId: true,
        workspace: { select: { sourceControlOrgId: true } },
      },
    });
    if (features.length !== featureIds.length) {
      const found = new Set(features.map((f) => f.id));
      const missing = featureIds.filter((id) => !found.has(id));
      return {
        ok: false,
        error:
          "Feature(s) not found or deleted: " + missing.join(", "),
        status: 404,
      };
    }
    const wrongOrg = features.filter(
      (f) => f.workspace.sourceControlOrgId !== orgId,
    );
    if (wrongOrg.length > 0) {
      return {
        ok: false,
        error:
          "Feature(s) do not belong to this organization: " +
          wrongOrg.map((f) => f.id).join(", "),
        status: 403,
      };
    }
    const wrongInitiative = features.filter(
      (f) => f.initiativeId !== merged.initiativeId,
    );
    if (wrongInitiative.length > 0) {
      return {
        ok: false,
        error:
          "Feature(s) do not belong to the supplied initiative " +
          "(a milestone can only own features of its parent " +
          "initiative): " +
          wrongInitiative.map((f) => f.id).join(", "),
        status: 400,
      };
    }
    priorMilestonesByFeatureId = new Map(
      features.map((f) => [f.id, f.milestoneId]),
    );
    workspaceIdByFeatureId = new Map(features.map((f) => [f.id, f.workspaceId]));
    initiativeIdByFeatureId = new Map(
      features.map((f) => [f.id, f.initiativeId ?? merged.initiativeId]),
    );
  }

  // Transactional create + reassign with sequence retry.
  let createdMilestoneId: string | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_SEQUENCE_RETRIES; attempt++) {
    try {
      const { id } = await db.$transaction(async (tx) => {
        const last = await tx.milestone.findFirst({
          where: { initiativeId: merged.initiativeId },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        const sequence = (last?.sequence ?? -1) + 1;

        const milestone = await tx.milestone.create({
          data: {
            initiativeId: merged.initiativeId,
            name: merged.name.trim(),
            sequence,
            ...(merged.description !== undefined && {
              description: merged.description,
            }),
            ...(merged.status !== undefined && { status: merged.status }),
            ...(merged.dueDate !== undefined && {
              dueDate: merged.dueDate ? new Date(merged.dueDate) : null,
            }),
            ...(merged.assigneeId !== undefined && {
              assigneeId: merged.assigneeId,
            }),
          },
          select: { id: true },
        });

        if (featureIds.length > 0) {
          // Re-assert the initiativeId invariant inside the tx as a
          // belt-and-suspenders against TOCTOU between the validation
          // findMany above and this update.
          await tx.feature.updateMany({
            where: {
              id: { in: featureIds },
              initiativeId: merged.initiativeId,
              deleted: false,
            },
            data: { milestoneId: milestone.id },
          });
        }

        return { id: milestone.id };
      });
      createdMilestoneId = id;
      break;
    } catch (e) {
      lastError = e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // Someone created a milestone in this initiative between our
        // findFirst and create. Retry — the next iteration will read
        // a higher MAX(sequence).
        continue;
      }
      // Non-sequence error — bail.
      break;
    }
  }

  if (!createdMilestoneId) {
    console.error("[handleApproval] milestone create failed:", lastError);
    return {
      ok: false,
      error:
        lastError instanceof Error
          ? lastError.message
          : "Failed to create milestone.",
      status: 500,
    };
  }

  // Place on the milestone's parent-initiative canvas (the sole
  // canvas a milestone projects on — milestones aren't drillable,
  // see CANVAS.md). Three-way priority:
  //   (a) Agent's `placement` hint resolves cleanly → use it.
  //   (b) Else, user's click hint (`intent.viewport`) on the parent
  //       initiative canvas → use it (mirrors the human `+` flow).
  //   (c) Else, no overlay → projector auto-layout decides (timeline
  //       row left-to-right by sequence).
  const landedOn = `initiative:${merged.initiativeId}`;
  const liveId = `milestone:${createdMilestoneId}`;
  let coords = await resolvePlacement(merged.placement, {
    orgId,
    targetRef: landedOn,
    newCategory: "milestone",
  });
  if (
    !coords &&
    intent.currentRef !== undefined &&
    intent.currentRef === landedOn &&
    intent.viewport
  ) {
    coords = intent.viewport;
  }
  if (coords) {
    try {
      await setLivePosition(orgId, landedOn, liveId, coords);
    } catch (e) {
      console.error("[handleApproval] setLivePosition (milestone) failed:", e);
    }
  }

  const landedOnName = await resolveLandedOnName(orgId, landedOn);

  // Fan out CANVAS_UPDATED. Two emits for the milestone itself
  // (initiative canvas + root rollup), plus one feature-reassign
  // refresh per attached feature. The reassign helper unions
  // before+after refs so it covers the prior milestone (if any) too.
  void notifyCanvasUpdated(orgId, landedOn, "milestone-created", {
    initiativeId: merged.initiativeId,
    milestoneId: createdMilestoneId,
    proposalId: proposal.proposalId,
  });
  void notifyCanvasUpdated(orgId, ROOT_REF, "milestone-created", {
    initiativeId: merged.initiativeId,
    milestoneId: createdMilestoneId,
    proposalId: proposal.proposalId,
  });
  for (const featureId of featureIds) {
    void notifyFeatureReassignmentRefresh(featureId, {
      milestoneId: priorMilestonesByFeatureId.get(featureId) ?? null,
      initiativeId: initiativeIdByFeatureId.get(featureId) ?? null,
      workspaceId: workspaceIdByFeatureId.get(featureId) ?? "",
    });
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "milestone",
      createdEntityId: createdMilestoneId,
      landedOn,
      ...(landedOnName && { landedOnName }),
    },
  };
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
