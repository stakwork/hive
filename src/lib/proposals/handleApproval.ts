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
  findFreeSlotInViewport,
  ROOT_REF,
} from "@/lib/canvas";
import { readCanvas } from "@/lib/canvas/io";
import {
  INITIATIVE_W,
  INITIATIVE_H,
  FEATURE_W,
  FEATURE_H,
  MILESTONE_W,
  MILESTONE_H,
} from "@/lib/canvas/geometry";
import type { CanvasNode } from "@/lib/canvas/types";
import { createFeature } from "@/services/roadmap";
import { detectFeatureDependencyCycle } from "@/services/roadmap/feature-dependency";
import { notifyFeatureReassignmentRefresh } from "@/lib/canvas";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  PROPOSE_NEW_PROMPT_TOOL,
  PROPOSE_PROMPT_UPDATE_TOOL,
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
  PROPOSE_CODE_CHANGE_TOOL,
  type ApprovalIntent,
  type ApprovalResult,
  type FeatureProposalPayload,
  type InitiativeProposalPayload,
  type MilestoneProposalPayload,
  type ProposalOutput,
  type RejectionIntent,
  type GraphNodeCreateProposalPayload,
  type GraphNodeEditProposalPayload,
  type GraphTripletCreateProposalPayload,
  type GraphBatchTripletCreateProposalPayload,
  type GraphEdgeDeleteProposalPayload,
  type GraphNodeMoveProposalPayload,
  type GraphNodeDeleteProposalPayload,
} from "./types";
import { mcpCreatePrompt, mcpUpdatePrompt } from "@/lib/mcp/mcpTools";
import { logger } from "@/lib/logger";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import {
  addNode,
  updateNodeV2,
  addEdgeV2,
  readNodeByRef,
  deleteNode,
  deleteEdge,
  deleteSingleNode,
  findEdgeByEndpoints,
  searchNodesByAttributes,
  type JarvisEdgeEndpoint,
} from "@/services/swarm/api/nodes";
import { findReservedKeyViolation, wouldCycle } from "@/lib/proposals/graphWriteValidation";
import {
  HIVE_WORKSPACE,
  HIVE_WORKSPACE_MEMBER,
} from "@/services/jarvis-mirror/mappers";
import type { ConceptKind } from "./types";

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
        tc.toolName !== PROPOSE_MILESTONE_TOOL &&
        tc.toolName !== PROPOSE_NEW_PROMPT_TOOL &&
        tc.toolName !== PROPOSE_PROMPT_UPDATE_TOOL &&
        tc.toolName !== PROPOSE_NEW_CONCEPT_TOOL &&
        tc.toolName !== PROPOSE_CONCEPT_UPDATE_TOOL &&
        tc.toolName !== PROPOSE_CREATE_NODE_TOOL &&
        tc.toolName !== PROPOSE_NODE_EDIT_TOOL &&
        tc.toolName !== PROPOSE_CREATE_TRIPLET_TOOL &&
        tc.toolName !== PROPOSE_CREATE_BATCH_TRIPLET_TOOL &&
        tc.toolName !== PROPOSE_DELETE_EDGE_TOOL &&
        tc.toolName !== PROPOSE_MOVE_NODE_TOOL &&
        tc.toolName !== PROPOSE_DELETE_NODE_TOOL &&
        tc.toolName !== PROPOSE_CODE_CHANGE_TOOL
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
  /**
   * Validated `SharedConversation.id` for the canvas conversation this
   * approval was clicked from. When supplied AND the proposal is a
   * feature, the new `Feature` row is stamped with
   * `parentCanvasConversationId = conversationId` so subsequent
   * planner messages fan out to this conversation
   * (`src/services/canvas-planner-fanout.ts`). The caller MUST have
   * validated the id (e.g. via `resolveTokenAttributionRowId`) before
   * passing it in — otherwise a malicious payload could launder
   * ownership claims into someone else's conversation.
   *
   * Optional. Other approval kinds (initiative, milestone) ignore it.
   */
  conversationId?: string;
  /**
   * The approving user's `chatAgentModel` preference (e.g.
   * `"anthropic/claude-opus-4-6"`). When supplied, persisted as
   * `Feature.model` on the new row so all subsequent plan-chat
   * messages honour the user's model selection via the existing
   * `feature.model || model || undefined` chain in
   * `sendFeatureChatMessage`. Optional; when absent, the existing
   * `getDefaultModel("plan")` fallback is unchanged.
   */
  chatAgentModel?: string;
}

export async function handleApproval(
  args: HandleApprovalArgs,
): Promise<HandleApprovalReturn> {
  const { orgId, userId, messages, intent, conversationId, chatAgentModel } = args;

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
  if (proposal.kind === "promptCreate") {
    return approvePromptCreate({
      userId,
      proposal,
      intent,
    });
  }
  if (proposal.kind === "promptUpdate") {
    return approvePromptUpdate({
      userId,
      proposal,
      intent,
    });
  }
  if (proposal.kind === "conceptCreate") {
    return approveConceptCreate({ orgId, userId, proposal });
  }
  if (proposal.kind === "conceptUpdate") {
    return approveConceptUpdate({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphNodeCreate") {
    return approveGraphNodeCreate({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphNodeEdit") {
    return approveGraphNodeEdit({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphTripletCreate") {
    return approveGraphTripletCreate({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphBatchTripletCreate") {
    return approveGraphBatchTripletCreate({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphEdgeDelete") {
    return approveGraphEdgeDelete({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphNodeMove") {
    return approveGraphNodeMove({ orgId, userId, proposal });
  }
  if (proposal.kind === "graphNodeDelete") {
    return approveGraphNodeDelete({ orgId, userId, proposal });
  }
  if (proposal.kind === "codeChange") {
    // `propose_code_change` is retired: a code change runs as a job now.
    // Cards from before that still render, but can no longer be approved.
    return {
      ok: false,
      error:
        "Code-change previews have been retired. Ask Jamie to make this change as a job instead.",
      status: 410,
    };
  }
  return approveFeature({
    orgId,
    userId,
    messages,
    proposal,
    intent,
    conversationId,
    chatAgentModel,
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

    // Initiatives project only on root. Three-way priority:
    //   (a) Agent's `placement` hint resolves cleanly → use it.
    //   (b) Else, viewport-aware free slot → land within user's visible area.
    //   (c) Else, no overlay → projector's auto-layout decides.
    const liveId = `initiative:${created.id}`;
    let coords = await resolvePlacement(merged.placement, {
      orgId,
      targetRef: ROOT_REF,
      newCategory: "initiative",
    });

    // (b) No agent placement hint — try viewport-aware free slot
    if (!coords && intent.viewportState) {
      let rootNodes: CanvasNode[] = [];
      try {
        const rootCanvas = await readCanvas(orgId, ROOT_REF);
        rootNodes = rootCanvas.nodes ?? [];
      } catch {
        // best-effort; empty list means no collision avoidance
      }
      coords = findFreeSlotInViewport(
        intent.viewportState,
        rootNodes,
        INITIATIVE_W,
        INITIATIVE_H,
      );
      if (!coords) {
        console.warn(
          "[handleApproval] viewport fully packed for initiative, falling back to auto-layout",
        );
      }
    }

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
  /**
   * Validated `SharedConversation.id` to stamp as
   * `Feature.parentCanvasConversationId` on the new row. See
   * `HandleApprovalArgs.conversationId` for the validation contract.
   */
  conversationId?: string;
  /**
   * The approving user's `chatAgentModel` preference. Persisted as
   * `Feature.model` so subsequent plan-chat messages use the user's
   * selected model via `sendFeatureChatMessage`'s
   * `feature.model || model || undefined` chain. Optional; absent →
   * existing `getDefaultModel("plan")` fallback unchanged.
   */
  chatAgentModel?: string;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, messages, proposal, intent, conversationId, chatAgentModel } = args;

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
    select: {
      id: true,
      slug: true,
      repositories: { select: { id: true } },
    },
  });
  if (!workspace) {
    return {
      ok: false,
      error: "Workspace not found in this organization.",
      status: 404,
    };
  }

  // ─── Validate selectedRepositoryIds (IDOR guard) ──────────────────
  // Intersect the forwarded ids against the resolved workspace's actual
  // repositories so the caller can only scope to repos that belong here.
  // An all-foreign / empty result falls back to undefined (all-repos
  // default). Never forward an empty array — downstream reinterprets
  // that as all-repos but in a way that silently contradicts the user's
  // narrowed intent.
  let validatedRepoIds: string[] | undefined;
  if (merged.selectedRepositoryIds && merged.selectedRepositoryIds.length > 0) {
    const workspaceRepoIds = new Set(workspace.repositories.map((r) => r.id));
    const intersection = merged.selectedRepositoryIds.filter((id) =>
      workspaceRepoIds.has(id),
    );
    if (intersection.length > 0) {
      validatedRepoIds = intersection;
    } else {
      // All ids were foreign/stale — fall back to all-repos default and
      // log so it's visible in server logs without blocking the approval.
      logger.warn(
        "[handleApproval.approveFeature] selectedRepositoryIds had no overlap with workspace repos — falling back to all-repos",
        "handleApproval",
        {
          workspaceId: merged.workspaceId,
          forwarded: merged.selectedRepositoryIds,
        },
      );
    }
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

  // ─── Resolve dependencies ───────────────────────────────────────────
  // Two sources, one final array:
  //   - `dependsOnFeatureIds`: already-cuid array from the propose
  //     tool. Was validated at propose-time for org ownership.
  //   - `dependsOnProposalIds`: proposalId references to sibling
  //     proposals in this same conversation. Resolve each via
  //     `findPriorApproval`, pull `createdEntityId`. If any sibling
  //     hasn't been approved yet (or was rejected), bail with a clear
  //     message that mirrors the existing `parentProposalId` ordering
  //     error.
  const resolvedDependsOnFeatureIds: string[] = [];
  if (merged.dependsOnFeatureIds && merged.dependsOnFeatureIds.length > 0) {
    // Re-validate org ownership in case inline-edit overrides changed
    // the array. Propose-time already checked, but the approval
    // intent's `payload` field can override anything.
    const cuidShape = /^c[a-z0-9]{20,}$/;
    const malformed = merged.dependsOnFeatureIds.filter(
      (id) => !cuidShape.test(id),
    );
    if (malformed.length > 0) {
      return {
        ok: false,
        error:
          "`dependsOnFeatureIds` expects DB cuids, but received: " +
          malformed.join(", ") +
          ". Sibling-proposal ids belong in `dependsOnProposalIds`.",
        status: 400,
      };
    }
    const existing = await db.feature.findMany({
      where: {
        id: { in: merged.dependsOnFeatureIds },
        deleted: false,
        workspace: { sourceControlOrgId: orgId },
      },
      select: { id: true },
    });
    if (existing.length !== merged.dependsOnFeatureIds.length) {
      const found = new Set(existing.map((f) => f.id));
      const missing = merged.dependsOnFeatureIds.filter(
        (id) => !found.has(id),
      );
      return {
        ok: false,
        error:
          "Dependency feature(s) not found in this organization: " +
          missing.join(", "),
        status: 404,
      };
    }
    resolvedDependsOnFeatureIds.push(...merged.dependsOnFeatureIds);
  }

  if (merged.dependsOnProposalIds && merged.dependsOnProposalIds.length > 0) {
    for (const blockerProposalId of merged.dependsOnProposalIds) {
      if (findPriorRejection(messages, blockerProposalId)) {
        return {
          ok: false,
          error:
            "Cannot approve this feature — blocker proposal " +
            `\`${blockerProposalId}\` was rejected. Remove it from ` +
            "`dependsOnProposalIds` or propose a replacement.",
          status: 409,
        };
      }
      const blockerResult = findPriorApproval(messages, blockerProposalId);
      if (!blockerResult) {
        return {
          ok: false,
          error:
            `Approve the blocker proposal \`${blockerProposalId}\` ` +
            "first — its row hasn't been created yet.",
          status: 409,
        };
      }
      if (blockerResult.kind !== "feature") {
        return {
          ok: false,
          error:
            "`dependsOnProposalIds` entries must reference feature " +
            `proposals. \`${blockerProposalId}\` is a ${blockerResult.kind}.`,
          status: 400,
        };
      }
      resolvedDependsOnFeatureIds.push(blockerResult.createdEntityId);
    }
  }

  // De-dup the union (a sibling could already have an approval result
  // AND a literal cuid override; idempotent).
  const uniqueDeps = Array.from(new Set(resolvedDependsOnFeatureIds));

  // Cycle check. The new feature doesn't have an id yet (selfId =
  // null), so this catches the case where two siblings depend on
  // each other via already-DB cuids (the rare malicious / confused
  // case). The full BFS over the existing graph is cheap.
  if (uniqueDeps.length > 0) {
    const cycle = await detectFeatureDependencyCycle(null, uniqueDeps);
    if (!cycle.ok) {
      return {
        ok: false,
        error:
          "Approving this feature would create a dependency cycle: " +
          (cycle.cycle ?? []).join(" → "),
        status: 400,
      };
    }
  }

  try {
    const feature = await createFeature(userId, {
      title: merged.title.trim(),
      workspaceId: merged.workspaceId,
      ...(merged.description !== undefined && { brief: merged.description }),
      ...(resolvedInitiativeId && { initiativeId: resolvedInitiativeId }),
      ...(merged.milestoneId && { milestoneId: merged.milestoneId }),
      ...(uniqueDeps.length > 0 && { dependsOnFeatureIds: uniqueDeps }),
      autoRespond: merged.autoRespond ?? null,
      ...(chatAgentModel ? { model: chatAgentModel } : {}),
    });

    // Stamp ownership: this canvas conversation now "owns" the new
    // feature for fan-out purposes. Planner ASSISTANT messages will
    // appear in this conversation's `messages` JSON via
    // `fanOutPlannerMessageToCanvas`. Non-fatal — a stamp failure
    // just means the feature isn't fanned out (the row still exists,
    // user can fall back to opening the feature's plan page).
    // Validation of `conversationId` is the caller's responsibility
    // (see `HandleApprovalArgs.conversationId` doc).
    if (conversationId) {
      try {
        await db.feature.update({
          where: { id: feature.id },
          data: { parentCanvasConversationId: conversationId },
        });
      } catch (e) {
        console.error(
          "[handleApproval.approveFeature] parentCanvasConversationId stamp failed (non-fatal):",
          e,
        );
      }
    }

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
    //
    // **Track success in `autoPinned`.** If the pin write fails (DB
    // hiccup, etc.), we MUST NOT promise the user the feature
    // landed on the workspace canvas — `featureProjectsOn` would
    // return false for the unpinned feature, we'd fall back to
    // `mostSpecificRef` which also returns the workspace ref (loose
    // feature → workspace canvas per the rule), and then write a
    // dead-weight position overlay onto a canvas that doesn't
    // project the card. The boolean drives both the `featureProjectsOn`
    // check below AND lets us skip the `mostSpecificRef` fallback for
    // the workspace case (since no pin = no projection).
    const liveId = `feature:${feature.id}`;
    const wantsAutoPin =
      intent.currentRef !== undefined &&
      intent.currentRef.startsWith("ws:") &&
      intent.currentRef === `ws:${merged.workspaceId}` &&
      !resolvedInitiativeId &&
      !merged.milestoneId;
    let autoPinned = false;
    if (wantsAutoPin) {
      try {
        const { assignFeatureOnCanvas } = await import("@/lib/canvas");
        await assignFeatureOnCanvas(orgId, intent.currentRef!, feature.id);
        autoPinned = true;
      } catch (e) {
        console.error("[handleApproval] auto-pin to workspace canvas failed:", e);
      }
    }
    // `featureProjectsOn` on a `ws:` ref needs the assigned-features
    // list (the pin overlay). On the happy path we just wrote the
    // pin, so we can synthesize the post-write list locally instead
    // of re-reading. On the failure path (`wantsAutoPin && !autoPinned`),
    // we leave the list as the pre-write state; `featureProjectsOn`
    // will correctly return false for the new feature since it isn't
    // pinned.
    let landedOn: string;
    let assignedFeatures: string[] | undefined;
    if (
      intent.currentRef !== undefined &&
      intent.currentRef.startsWith("ws:")
    ) {
      const existing = await readAssignedFeatures(orgId, intent.currentRef);
      assignedFeatures = autoPinned ? [...existing, feature.id] : existing;
    }
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

    // (a) Agent placement first — wins over viewport fallbacks because
    // the agent has typically read the canvas and picked a deliberate
    // anchor.
    let coords = await resolvePlacement(merged.placement, {
      orgId,
      targetRef: landedOn,
      newCategory: "feature",
    });
    // (b) No agent placement hint — try viewport-aware free slot so the
    // card lands within the user's visible area instead of at {40,40}.
    if (!coords && intent.viewportState) {
      const canvasForCollision = await readCanvas(orgId, landedOn).catch(
        () => ({ nodes: [] as CanvasNode[] }),
      );
      coords =
        findFreeSlotInViewport(
          intent.viewportState,
          canvasForCollision.nodes ?? [],
          FEATURE_W,
          FEATURE_H,
        ) ?? intent.viewport ?? null; // final { x:40, y:40 } safety net
    } else if (!coords && intent.currentRef === landedOn && intent.viewport) {
      // Legacy fallback: viewport hint from old clients without viewportState.
      coords = intent.viewport;
    }
    // **Skip the position write when the feature won't actually
    // render on `landedOn`.** Loose features land on `ws:<workspaceId>`
    // per `mostSpecificRef`, but the workspace projector only emits
    // them when pinned (`assignedFeatures`). If the auto-pin failed
    // above (or we never attempted one — e.g. the user was on a
    // different canvas), writing the position overlay would create
    // dead weight: a `positions[feature:<id>]` entry on a canvas the
    // feature doesn't project on. Re-check projection with the
    // post-auto-pin `assignedFeatures` we computed above. Initiative-
    // anchored features always project on their initiative canvas
    // regardless of pin state, so this skip only bites loose
    // features that failed to pin onto a workspace canvas.
    //
    // We can't reuse the `landedOn === intent.currentRef` shortcut
    // here: in the failure case `currentRef === ws:X` AND
    // `mostSpecificRef` also returns `ws:X`, so `landedOn ===
    // currentRef` is true even though the feature isn't pinned.
    // Always go through `featureProjectsOn` with the correct
    // overlay for the target ref.
    const overlayForLanded =
      landedOn === intent.currentRef ? assignedFeatures : undefined;
    const featureWillRenderOnLanded = featureProjectsOn(
      landedOn,
      featurePlacementPayload,
      overlayForLanded,
    );
    if (coords && featureWillRenderOnLanded) {
      try {
        await setLivePosition(orgId, landedOn, liveId, coords);
      } catch (e) {
        // Position-overlay write failures are non-fatal — the
        // feature still exists, it just lands at the projector's
        // default. Log and move on.
        console.error("[handleApproval] setLivePosition failed:", e);
      }
    } else if (coords && !featureWillRenderOnLanded) {
      // The most common reason we get here: the user approved a
      // loose-feature proposal on a workspace canvas and the
      // auto-pin write failed. We keep `landedOn` pointing at the
      // workspace canvas (the most useful navigation target — the
      // user can manually pin from there) but skip the position
      // overlay write so the blob stays clean. A future re-pin of
      // the same feature will land at the projector's default slot,
      // no phantom overlay to worry about.
      //
      // Known minor inconsistency: the assistant message will say
      // "Created **X** on **Workspace Y**" and link to that canvas,
      // but the user won't see the card until they pin it manually.
      // Acceptable for a rare transient failure; flagging here in
      // case a future user-experience pass wants to surface the
      // pin-failure state explicitly (e.g. an "Unable to add to
      // canvas — pin manually" sub-line on the ProposalCard).
      console.warn(
        "[handleApproval] skipping setLivePosition — feature will not project on landedOn",
        { landedOn, featureId: feature.id },
      );
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
          // The canvas agent that proposed this feature already
          // explored the org canvases when composing the seed —
          // re-running the org-context scout from Hive would be
          // redundant work (5-60s) and could re-frame context the
          // proposing agent already curated. Skip it.
          skipOrgContextScout: true,
          // Forward validated repo scope from the ProposalCard
          // selector. undefined → all-repos default (unchanged
          // behavior); a non-empty intersection → exactly those repos.
          ...(validatedRepoIds && { selectedRepositoryIds: validatedRepoIds }),
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
        workspaceSlug: workspace.slug,
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
  //   (b) Else, viewport-aware free slot → land within user's visible area.
  //   (c) Else, no overlay → projector auto-layout decides (timeline
  //       row left-to-right by sequence).
  const landedOn = `initiative:${merged.initiativeId}`;
  const liveId = `milestone:${createdMilestoneId}`;
  let coords = await resolvePlacement(merged.placement, {
    orgId,
    targetRef: landedOn,
    newCategory: "milestone",
  });
  // (b) No agent placement hint — try viewport-aware free slot
  if (!coords && intent.viewportState) {
    const canvasForCollision = await readCanvas(orgId, landedOn).catch(
      () => ({ nodes: [] as CanvasNode[] }),
    );
    coords =
      findFreeSlotInViewport(
        intent.viewportState,
        canvasForCollision.nodes ?? [],
        MILESTONE_W,
        MILESTONE_H,
      ) ?? intent.viewport ?? null; // final { x:40, y:40 } safety net
  } else if (
    !coords &&
    intent.currentRef !== undefined &&
    intent.currentRef === landedOn &&
    intent.viewport
  ) {
    // Legacy fallback: viewport hint from old clients without viewportState.
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

// ── Approve: promptCreate ────────────────────────────────────────────
//
// Creates a new prompt via mcpCreatePrompt (same logic as the MCP tool).
// Cross-tenant guard: verifies the acting user is a member of the shared
// "stakwork" workspace before writing, since prompts are global-scope and
// not org-filtered. Returns landedOn: "" (no canvas node).

async function approvePromptCreate(args: {
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "promptCreate" }>;
  intent: ApprovalIntent;
}): Promise<HandleApprovalReturn> {
  const { userId, proposal } = args;
  const { name, value, description } = proposal.payload;

  if (!name || !name.trim()) {
    return { ok: false, error: "Prompt name is required.", status: 400 };
  }
  if (!value) {
    return { ok: false, error: "Prompt value is required.", status: 400 };
  }

  // Cross-tenant guard: the shared prompt library is accessed via the
  // "stakwork" workspace. Any org's canvas agent can propose, but only
  // a member of that workspace may actually write.
  const stakworkWorkspace = await db.workspace.findFirst({
    where: { name: "stakwork", deleted: false },
    select: { id: true, slug: true, ownerId: true },
  });

  if (!stakworkWorkspace) {
    logger.warn(
      "[handleApproval.approvePromptCreate] stakwork workspace not found",
      "handleApproval",
      { proposalId: proposal.proposalId, name },
    );
    return {
      ok: false,
      error: "The shared prompt library workspace is not available.",
      status: 503,
    };
  }

  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId: stakworkWorkspace.id, userId, leftAt: null },
    select: { id: true },
  });

  logger.info("[handleApproval.approvePromptCreate] membership check", "handleApproval", {
    proposalId: proposal.proposalId,
    name,
    userId,
    isMember: !!membership,
  });

  if (stakworkWorkspace.ownerId !== userId && !membership) {
    return {
      ok: false,
      error:
        "You must be a member of the stakwork workspace to create prompts in the shared library.",
      status: 403,
    };
  }

  const auth = {
    workspaceId: stakworkWorkspace.id,
    workspaceSlug: stakworkWorkspace.slug,
    userId,
  };

  const result = await mcpCreatePrompt(auth, name.trim(), value, description);

  logger.info("[handleApproval.approvePromptCreate] write outcome", "handleApproval", {
    proposalId: proposal.proposalId,
    name,
    isError: result.isError,
  });

  if (result.isError) {
    const msg = result.content[0]?.text ?? "Failed to create prompt.";
    return { ok: false, error: msg, status: 400 };
  }

  // Extract the created prompt id from the MCP result.
  let createdId = "";
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    createdId = parsed.id ?? "";
  } catch {
    // Non-fatal — we still return success even if we can't parse the id.
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "promptCreate",
      createdEntityId: createdId,
      landedOn: "",
    },
  };
}

// ── Approve: promptUpdate ────────────────────────────────────────────
//
// Creates a new draft version of an existing prompt via mcpUpdatePrompt.
// Same cross-tenant guard as promptCreate — only stakwork workspace members
// may write. Returns landedOn: "" (no canvas node).

async function approvePromptUpdate(args: {
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "promptUpdate" }>;
  intent: ApprovalIntent;
}): Promise<HandleApprovalReturn> {
  const { userId, proposal } = args;
  const { promptId, value, description } = proposal.payload;

  if (!promptId) {
    return { ok: false, error: "promptId is required.", status: 400 };
  }
  if (!value) {
    return { ok: false, error: "Prompt value is required.", status: 400 };
  }

  // Cross-tenant guard.
  const stakworkWorkspace = await db.workspace.findFirst({
    where: { name: "stakwork", deleted: false },
    select: { id: true, slug: true, ownerId: true },
  });

  if (!stakworkWorkspace) {
    logger.warn(
      "[handleApproval.approvePromptUpdate] stakwork workspace not found",
      "handleApproval",
      { proposalId: proposal.proposalId, promptId },
    );
    return {
      ok: false,
      error: "The shared prompt library workspace is not available.",
      status: 503,
    };
  }

  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId: stakworkWorkspace.id, userId, leftAt: null },
    select: { id: true },
  });

  logger.info("[handleApproval.approvePromptUpdate] membership check", "handleApproval", {
    proposalId: proposal.proposalId,
    promptId,
    userId,
    isMember: !!membership,
  });

  if (stakworkWorkspace.ownerId !== userId && !membership) {
    return {
      ok: false,
      error:
        "You must be a member of the stakwork workspace to update prompts in the shared library.",
      status: 403,
    };
  }

  const auth = {
    workspaceId: stakworkWorkspace.id,
    workspaceSlug: stakworkWorkspace.slug,
    userId,
  };

  const result = await mcpUpdatePrompt(auth, promptId, value, description);

  logger.info("[handleApproval.approvePromptUpdate] write outcome", "handleApproval", {
    proposalId: proposal.proposalId,
    promptId,
    isError: result.isError,
  });

  if (result.isError) {
    const msg = result.content[0]?.text ?? "Failed to update prompt.";
    return { ok: false, error: msg, status: 400 };
  }

  // Extract versionId from the MCP result non-fatally — same pattern as approvePromptCreate.
  // NEVER spread `parsed`: the payload also contains the full prompt `value`.
  let promptVersionId = "";
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    promptVersionId = typeof parsed.versionId === "string" ? parsed.versionId : "";
  } catch {
    logger.warn(
      "[handleApproval.approvePromptUpdate] versionId parse failed",
      "handleApproval",
      {
        proposalId: proposal.proposalId,
        promptId,
      },
    );
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "promptUpdate",
      createdEntityId: promptId,
      landedOn: "",
      workspaceSlug: stakworkWorkspace.slug,
      ...(promptVersionId ? { promptVersionId } : {}),
    },
  };
}

// ── Concept approvals ────────────────────────────────────────────────
//
// Concepts live on a workspace's swarm, not in the Hive DB. Both create
// and update go through the Jarvis API rather than gitree HTTP:
//  - create (`POST /v2/nodes` + `/v2/edges`) — new Concepts are born with
//    `Domain_general` labels and queued `text_embeddings` (jarvis
//    migration 108/110), discoverable by graph_search's semantic half.
//  - update (`POST /v2/nodes/{ref_id}`) — jarvis rebuilds the `Data_Bank`
//    search text from the schema's index fields and re-queues embeddings,
//    which gitree's `saveDocumentation` (`SET f.docs` only) never did:
//    concepts updated through gitree kept ranking on their OLD body.
// `node_data.id` carries gitree's slug address so stakgraph's readers
// (`MATCH (f:Concept {id})`) keep resolving these nodes. The proposal
// payload carries the workspace cuid (resolved under the org at propose
// time); `resolveGraphJarvis` re-verifies org + workspace membership.
// Both return `landedOn: ""` (no canvas node) + the workspace slug so
// the card can deep-link to the concept in the learn UI.

/**
 * Resolve a Concept's jarvis ref_id from whatever identifier the agent has.
 *
 * Matches the same three addresses gitree's `getConcept` does
 * (`WHERE f.id = $id OR f.node_key = $rawId OR f.ref_id = $rawId`), and for
 * the same reason: `list_concepts` / `read_concept_documentation` read
 * through gitree, whose `nodeToConcept` falls back to `node_key`/`ref_id`
 * when a node has no `id` property. Resolving on `id` alone made every such
 * concept readable but not updatable — the agent would be handed a body by
 * `read_concept_documentation` and then get a 404 from
 * `propose_concept_update` for the very id it was just given.
 *
 * Not every Concept carries `id`: gitree's `saveConcept` stamps it and the
 * jarvis create path above passes it in `node_data`, but concepts created
 * through other jarvis writers have only `node_key`.
 *
 * Jarvis ANDs `search_filters`, so the alternatives are tried in sequence,
 * cheapest-first. `readNodeByRef` is last because it only applies when the
 * caller passed a bare ref_id (its `isSafeRefId` guard rejects slug
 * addresses like "owner/repo/slug" without issuing a request).
 */
async function findConceptRefById(
  config: { jarvisUrl: string; apiKey: string },
  conceptId: string,
): Promise<
  | { ok: true; refId: string }
  | { ok: false; error: string; status: number }
> {
  let reachedGraph = false;

  for (const attribute of ["id", "node_key"]) {
    const search = await searchNodesByAttributes(config, {
      nodeTypes: ["Concept"],
      filters: [{ attribute, value: conceptId, comparator: "=" }],
      limit: 1,
    });
    if (search.ok) {
      reachedGraph = true;
      if (search.nodes[0]) {
        return { ok: true, refId: search.nodes[0].ref_id };
      }
    }
  }

  // Bare ref_id — what gitree hands back for a concept with no `id`.
  const byRef = await readNodeByRef(config, conceptId);
  if (byRef.success && byRef.node_type === "Concept") {
    return { ok: true, refId: conceptId };
  }

  // Only report "not found" if the graph actually answered; otherwise the
  // lookups failed for transport reasons and a 404 would be a lie.
  if (!reachedGraph) {
    return {
      ok: false,
      error: "Could not reach the workspace graph.",
      status: 502,
    };
  }
  return { ok: false, error: `Concept '${conceptId}' not found.`, status: 404 };
}

// ── Concept anchor edges (jarvis migration 111) ──────────────────────
//
// Every approved Concept is wired into the workspace anchor subgraph so the
// graph walker can reach it from a walk seed instead of only via search:
//   - HiveWorkspace -{HAS_CONCEPT|PREFERENCE|BEST_PRACTICE|GOTCHA|PROCESS}-> Concept
//     (edge type selected by payload.kind; the taxonomy accumulates on the
//     workspace node as {EDGE_TYPE: count} for the walker)
//   - HiveWorkspaceMember -APPROVED-> Concept (attribution: the clicker)
//   - HiveWorkspaceMember -PREFERENCE-> Concept (payload.personUserId —
//     the member the knowledge is ABOUT)
//   - Concept -IN_REPO-> Repository (payload.repo, resolved to the ingested
//     Repository node by name)
// All are BEST-EFFORT: /v2/edges create-or-merges inline endpoints, so the
// workspace/member nodes need not exist yet (the jarvis-mirror cron enriches
// them later by node_key) — but a failure here never fails the approval; the
// concept itself is the value, anchors are wiring. Failures are logged.

/** payload.kind → workspace-anchor edge type (migration 111). */
const CONCEPT_KIND_EDGE: Record<ConceptKind, string> = {
  preference: "PREFERENCE",
  best_practice: "BEST_PRACTICE",
  gotcha: "GOTCHA",
  process: "PROCESS",
  general: "HAS_CONCEPT",
};

/**
 * Inline HiveWorkspaceMember endpoint for a hive user, or null when the user
 * is not (any longer) part of the workspace. Mirrors the jarvis-mirror cron's
 * identity scheme: member-row cuid for members, the user id for the OWNER
 * (who has no member row), same display-name fallback chain.
 */
async function memberEndpointForUser(
  workspaceId: string,
  userId: string,
): Promise<JarvisEdgeEndpoint | null> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, leftAt: null },
    select: {
      id: true,
      user: {
        select: {
          name: true,
          githubAuth: { select: { githubUsername: true } },
        },
      },
    },
  });
  if (member) {
    return {
      node_type: HIVE_WORKSPACE_MEMBER,
      node_data: {
        member_id: member.id,
        name:
          member.user.name ?? member.user.githubAuth?.githubUsername ?? "member",
        user_id: userId,
      },
    };
  }
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerId: true,
      owner: {
        select: {
          name: true,
          githubAuth: { select: { githubUsername: true } },
        },
      },
    },
  });
  if (workspace?.ownerId === userId) {
    return {
      node_type: HIVE_WORKSPACE_MEMBER,
      node_data: {
        member_id: userId,
        name:
          workspace.owner.name ??
          workspace.owner.githubAuth?.githubUsername ??
          "owner",
        user_id: userId,
      },
    };
  }
  return null;
}

/**
 * Write the anchor edges for a freshly approved Concept. Best-effort by
 * design (see the block comment above): every failure is logged and
 * swallowed so a graph gap can never block a user's "remember this".
 */
async function writeConceptAnchorEdges(args: {
  config: { jarvisUrl: string; apiKey: string };
  proposalId: string;
  workspaceId: string;
  approverUserId: string;
  conceptTarget: JarvisEdgeEndpoint;
  kind?: ConceptKind;
  personUserId?: string;
  repo?: string;
}): Promise<void> {
  const {
    config,
    proposalId,
    workspaceId,
    approverUserId,
    conceptTarget,
    kind,
    personUserId,
    repo,
  } = args;

  const warn = (what: string, detail?: unknown) =>
    logger.warn(
      `[handleApproval.writeConceptAnchorEdges] ${what}`,
      "handleApproval",
      { proposalId, workspaceId, detail },
    );

  // Workspace anchor. Inline endpoint create-or-merges the HiveWorkspace
  // node, so this works even before the mirror cron's first pass.
  try {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    if (workspace) {
      const res = await addEdgeV2(config, {
        edge: { edge_type: CONCEPT_KIND_EDGE[kind ?? "general"] },
        source: {
          node_type: HIVE_WORKSPACE,
          node_data: { workspace_id: workspaceId, name: workspace.name },
        },
        target: conceptTarget,
      });
      if (!res.success) warn("workspace anchor edge failed", res.message);
    }
  } catch (e) {
    warn("workspace anchor edge threw", e instanceof Error ? e.message : e);
  }

  // Approval attribution: member -APPROVED-> Concept.
  try {
    const approver = await memberEndpointForUser(workspaceId, approverUserId);
    if (approver) {
      const res = await addEdgeV2(config, {
        edge: { edge_type: "APPROVED" },
        source: approver,
        target: conceptTarget,
      });
      if (!res.success) warn("APPROVED edge failed", res.message);
    }
  } catch (e) {
    warn("APPROVED edge threw", e instanceof Error ? e.message : e);
  }

  // Person link: member -PREFERENCE-> Concept (who the knowledge is ABOUT).
  // Written even when the approver IS the person — APPROVED above is
  // attribution, not a preference claim.
  if (personUserId) {
    try {
      const person = await memberEndpointForUser(workspaceId, personUserId);
      if (person) {
        const res = await addEdgeV2(config, {
          edge: { edge_type: "PREFERENCE" },
          source: person,
          target: conceptTarget,
        });
        if (!res.success) warn("person PREFERENCE edge failed", res.message);
      } else {
        warn("person no longer a workspace member — PREFERENCE edge skipped", {
          personUserId,
        });
      }
    } catch (e) {
      warn("person PREFERENCE edge threw", e instanceof Error ? e.message : e);
    }
  }

  // Repo anchor: Concept -IN_REPO-> Repository. The Repository node_key
  // needs file/start we don't have, so NEVER inline-create — resolve the
  // stakgraph-ingested node by name ("owner/repo") and skip if absent.
  if (repo) {
    try {
      const search = await searchNodesByAttributes(config, {
        nodeTypes: ["Repository"],
        filters: [{ attribute: "name", value: repo, comparator: "=" }],
        limit: 1,
      });
      if (search.ok && search.nodes[0]) {
        const res = await addEdgeV2(config, {
          edge: { edge_type: "IN_REPO" },
          source: conceptTarget,
          target: { ref_id: search.nodes[0].ref_id },
        });
        if (!res.success) warn("IN_REPO edge failed", res.message);
      } else {
        warn("Repository node not found — IN_REPO edge skipped", { repo });
      }
    } catch (e) {
      warn("IN_REPO edge threw", e instanceof Error ? e.message : e);
    }
  }
}

/** Mirror of gitree's generateSlug (stakgraph mcp/src/gitree/store/utils.ts). */
function conceptSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function approveConceptCreate(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "conceptCreate" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  const {
    workspaceId,
    workspaceSlug,
    name,
    documentation,
    description,
    repo,
    parent,
    kind,
    personUserId,
  } = proposal.payload;

  if (!name || !name.trim()) {
    return { ok: false, error: "Concept name is required.", status: 400 };
  }
  if (typeof documentation !== "string" || !documentation) {
    return { ok: false, error: "Concept documentation is required.", status: 400 };
  }

  // gitree's slug address: repo-prefixed when the concept is filed under a
  // repo, bare slug for general (repo-less) concepts. stakgraph resolves
  // concepts by this property, so it must land on the node.
  const slug = conceptSlug(name);
  if (!slug) {
    return {
      ok: false,
      error: "Concept name must contain alphanumeric characters.",
      status: 400,
    };
  }
  const conceptId = repo ? `${repo}/${slug}` : slug;
  const parentId = parent?.trim() || undefined;
  if (parentId && parentId === conceptId) {
    return { ok: false, error: "A concept cannot be its own parent.", status: 400 };
  }

  const resolved = await resolveGraphJarvis(orgId, userId, { workspaceId });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { config } = resolved.access;

  // Resolve the parent BEFORE creating — a bad parent must never leave a
  // partially-created concept behind (mirrors gitree's createConceptDirect).
  let parentRef: string | undefined;
  if (parentId) {
    const found = await findConceptRefById(config, parentId);
    if (!found.ok) {
      return found.status === 404
        ? { ok: false, error: `Parent concept '${parentId}' not found.`, status: 400 }
        : found;
    }
    parentRef = found.refId;
  }

  // Jarvis create-or-merge (node_key: concept-name — a same-name concept
  // merges rather than erroring). `docs` is the canonical indexed body
  // (jarvis migration 106); `documentation` is deprecated and unindexed.
  const created = await addNode(config, {
    node_type: "Concept",
    node_data: {
      id: conceptId,
      name: name.trim(),
      docs: documentation,
      ...(description && { description }),
      ...(repo && { repo }),
    },
  });
  if (!created.success) {
    logger.error(
      "[handleApproval.approveConceptCreate] jarvis node create failed",
      "handleApproval",
      { proposalId: proposal.proposalId, workspaceSlug, error: created.error },
    );
    return {
      ok: false,
      error: created.error ?? "Failed to create concept.",
      status: 502,
    };
  }

  // `alreadyExists` can legitimately come back without a ref_id — hand
  // addEdgeV2 the inline spec and let it resolve by schema node_key
  // (same fallback as resolveInlineNode above). Shared by the parent link
  // and every anchor edge below.
  const conceptTarget: JarvisEdgeEndpoint = created.ref_id
    ? { ref_id: created.ref_id }
    : { node_type: "Concept", node_data: { name: name.trim() } };

  if (parentRef) {
    if (created.ref_id && created.ref_id === parentRef) {
      // Merge-by-name landed on the parent itself (same name, different id).
      return { ok: false, error: "A concept cannot be its own parent.", status: 400 };
    }
    const edgeResult = await addEdgeV2(config, {
      edge: { edge_type: "PARENT_OF" },
      source: { ref_id: parentRef },
      target: conceptTarget,
    });
    if (!edgeResult.success) {
      // Compensating rollback — but only when THIS call created the node;
      // never delete a pre-existing concept that a merge landed on.
      if (created.ref_id && !created.alreadyExists) {
        const rollback = await deleteNode(config, created.ref_id);
        if (!rollback.success) {
          logger.error(
            "[handleApproval.approveConceptCreate] rollback failed for orphaned concept",
            "handleApproval",
            { proposalId: proposal.proposalId, conceptId, refId: created.ref_id },
          );
        }
      }
      return {
        ok: false,
        error: `Concept parent link failed: ${edgeResult.message ?? "unknown error"}`,
        status: 502,
      };
    }
  }

  // Anchor the concept in the workspace graph (best-effort — never fails
  // the approval; see writeConceptAnchorEdges).
  await writeConceptAnchorEdges({
    config,
    proposalId: proposal.proposalId,
    workspaceId,
    approverUserId: userId,
    conceptTarget,
    kind,
    personUserId,
    repo,
  });

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "conceptCreate",
      createdEntityId: conceptId,
      landedOn: "",
      workspaceSlug,
    },
  };
}

async function approveConceptUpdate(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "conceptUpdate" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  const { workspaceId, workspaceSlug, conceptId, documentation } =
    proposal.payload;

  if (!conceptId) {
    return { ok: false, error: "conceptId is required.", status: 400 };
  }
  if (typeof documentation !== "string") {
    return { ok: false, error: "Concept documentation is required.", status: 400 };
  }

  const resolved = await resolveGraphJarvis(orgId, userId, { workspaceId });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { config } = resolved.access;

  const found = await findConceptRefById(config, conceptId);
  if (!found.ok) {
    return found;
  }

  // node_type is inferred from the node's labels; jarvis rebuilds Data_Bank
  // and re-queues text_embeddings from the merged properties, so the new
  // body is searchable — not just stored.
  // Jarvis scopes the write to one namespace, so read the node's namespace
  // first. Best-effort: a failed read writes without one (default namespace)
  // rather than failing the approval.
  const existing = await readNodeByRef(config, found.refId);
  const updated = await updateNodeV2(
    config,
    found.refId,
    { docs: documentation },
    existing.success ? existing.namespace : undefined,
  );
  if (!updated.success) {
    logger.error(
      "[handleApproval.approveConceptUpdate] jarvis node update failed",
      "handleApproval",
      { proposalId: proposal.proposalId, workspaceSlug, conceptId, error: updated.message },
    );
    return {
      ok: false,
      error: updated.message ?? "Failed to update concept.",
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "conceptUpdate",
      createdEntityId: conceptId,
      landedOn: "",
      workspaceSlug,
    },
  };
}

// ─── Reject ───────────────────────────────────────────────────────────

interface HandleRejectionArgs {
  messages: MessageLike[];
  intent: RejectionIntent;
}

// ── Approve: graph node create ──────────────────────────────────────

/**
 * Mirror-owned types that the propose_node_edit tool refuses at propose time
 * and we doubly-guard here so a client-crafted approval cannot bypass it.
 */
const GRAPH_MIRROR_OWNED_TYPES = new Set([
  "HiveFeature",
  "HiveTask",
  "HiveChatMessage",
  "ErrorIssue",
  "Initiative",
  "Milestone",
  "Research",
]);

async function approveGraphNodeCreate(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphNodeCreate" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  // Ignore intent.payload — always use the server-persisted proposal payload.
  const payload = proposal.payload as GraphNodeCreateProposalPayload;

  if (!payload.workspaceId || !payload.node_type) {
    return { ok: false, error: "Invalid graph node create proposal payload.", status: 400 };
  }

  // Re-check reserved keys. The propose tool already rejected them, but the
  // payload reaches us through the client-supplied transcript, so a forged
  // approval would otherwise write straight over Jarvis / Neo4j metadata.
  const reserved = findReservedKeyViolation([["node_data", payload.node_data]]);
  if (reserved) {
    return { ok: false, error: reserved, status: 400 };
  }

  // Re-run resolveGraphJarvis at approval time — validateUserBelongsToOrg
  // only checks org-wide membership, not membership in the specific workspace.
  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  const result = await addNode(config, {
    node_type: payload.node_type,
    node_data: payload.node_data,
  });

  const outcome = result.alreadyExists ? "already-existed" : result.success ? "created" : "failed";
  logger.info(
    `[handleApproval.approveGraphNodeCreate] ${outcome}`,
    "handleApproval",
    {
      workspaceId,
      workspaceSlug,
      kind: "graphNodeCreate",
      node_type: payload.node_type,
      ref_id: result.ref_id,
      outcome,
    },
  );

  if (!result.success) {
    return {
      ok: false,
      error: result.error ?? "Failed to create node in knowledge graph.",
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphNodeCreate",
      createdEntityId: result.ref_id ?? "",
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
      alreadyExisted: result.alreadyExists,
    },
  };
}

// ── Approve: graph node edit ────────────────────────────────────────

async function approveGraphNodeEdit(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphNodeEdit" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  // Ignore intent.payload — always use the server-persisted proposal payload.
  const payload = proposal.payload as GraphNodeEditProposalPayload;

  if (!payload.workspaceId || !payload.ref_id) {
    return { ok: false, error: "Invalid graph node edit proposal payload.", status: 400 };
  }

  // Re-check reserved keys — see approveGraphNodeCreate.
  const reserved = findReservedKeyViolation([["node_data", payload.node_data]]);
  if (reserved) {
    return { ok: false, error: reserved, status: 400 };
  }

  // Authorization runs before reading meta or any external call — a caller
  // must be a verified member of the specific workspace before we reveal
  // anything about the proposal's refused/accepted state.
  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  // If the propose tool itself refused (refusedReason in meta), surface as error.
  const meta = proposal.meta as { refusedReason?: string } | undefined;
  if (meta?.refusedReason) {
    return { ok: false, error: meta.refusedReason, status: 400 };
  }

  // Re-read the node at approval time to verify it still exists and is not mirror-owned.
  const existing = await readNodeByRef(config, payload.ref_id);
  if (!existing.success) {
    return {
      ok: false,
      error: `Node "${payload.ref_id}" not found in this workspace's graph.`,
      status: 404,
    };
  }
  const nodeType = existing.node_type ?? "";
  if (GRAPH_MIRROR_OWNED_TYPES.has(nodeType)) {
    return {
      ok: false,
      error: `"${nodeType}" is a mirror-owned type and cannot be edited — changes would be reverted on the next mirror pass.`,
      status: 400,
    };
  }

  const result = await updateNodeV2(
    config,
    payload.ref_id,
    payload.node_data,
    existing.namespace,
  );

  const outcome = result.success ? "created" : "failed";
  logger.info(
    `[handleApproval.approveGraphNodeEdit] ${outcome}`,
    "handleApproval",
    {
      workspaceId,
      workspaceSlug,
      kind: "graphNodeEdit",
      node_type: nodeType,
      ref_id: payload.ref_id,
      namespace: existing.namespace ?? "default",
      outcome,
      ...(result.success ? {} : { message: result.message }),
    },
  );

  if (!result.success) {
    return {
      ok: false,
      error: result.message ?? "Failed to update node in knowledge graph.",
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphNodeEdit",
      createdEntityId: payload.ref_id,
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
    },
  };
}

// ── Approve: graph triplet create ───────────────────────────────────

/** `node_data` of an inline endpoint; `undefined` for a ref_id endpoint. */
function inlineNodeData(
  endpoint: JarvisEdgeEndpoint,
): Record<string, unknown> | undefined {
  return "ref_id" in endpoint ? undefined : endpoint.node_data;
}

/**
 * Resolve an inline triplet endpoint to a `JarvisEdgeEndpoint`.
 *
 * `addNode` gives create-or-merge semantics, but it legitimately returns
 * `{ success: true, alreadyExists: true, ref_id: undefined }` when the node
 * already existed and Jarvis reported the duplicate only in
 * `status_messages`. That is a success, not a failure: the node is there, we
 * just don't know its ref. In that case we hand the inline spec straight to
 * `addEdgeV2`, which resolves endpoints by schema node_key.
 */
async function resolveInlineNode(
  config: { jarvisUrl: string; apiKey: string },
  endpoint: { node_type: string; node_data: Record<string, unknown> },
): Promise<{ ok: true; endpoint: JarvisEdgeEndpoint } | { ok: false; error: string }> {
  const result = await addNode(config, {
    node_type: endpoint.node_type,
    node_data: endpoint.node_data,
  });

  if (!result.success) {
    return { ok: false, error: result.error ?? "unknown error" };
  }

  return { ok: true, endpoint: result.ref_id ? { ref_id: result.ref_id } : endpoint };
}

async function approveGraphTripletCreate(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphTripletCreate" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  const payload = proposal.payload as GraphTripletCreateProposalPayload;

  if (!payload.workspaceId || !payload.edge_type) {
    return { ok: false, error: "Invalid graph triplet create proposal payload.", status: 400 };
  }

  // Re-check reserved keys — see approveGraphNodeCreate.
  const reserved = findReservedKeyViolation([
    ["edge_data", payload.edge_data],
    ["source.node_data", inlineNodeData(payload.source)],
    ["target.node_data", inlineNodeData(payload.target)],
  ]);
  if (reserved) {
    return { ok: false, error: reserved, status: 400 };
  }

  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  // Resolve inline source/target nodes (if any).
  let sourceEndpoint: JarvisEdgeEndpoint;
  let targetEndpoint: JarvisEdgeEndpoint;

  if ("ref_id" in payload.source) {
    sourceEndpoint = { ref_id: payload.source.ref_id };
  } else {
    const r = await resolveInlineNode(config, payload.source);
    if (!r.ok) {
      return { ok: false, error: `Failed to resolve source node: ${r.error}`, status: 502 };
    }
    sourceEndpoint = r.endpoint;
  }

  if ("ref_id" in payload.target) {
    targetEndpoint = { ref_id: payload.target.ref_id };
  } else {
    const r = await resolveInlineNode(config, payload.target);
    if (!r.ok) {
      return { ok: false, error: `Failed to resolve target node: ${r.error}`, status: 502 };
    }
    targetEndpoint = r.endpoint;
  }

  const edgeResult = await addEdgeV2(config, {
    edge: {
      edge_type: payload.edge_type,
      ...(payload.edge_data ? { edge_data: payload.edge_data } : {}),
      ...(payload.weight !== undefined ? { weight: payload.weight } : {}),
    },
    source: sourceEndpoint,
    target: targetEndpoint,
  });

  const outcome = edgeResult.alreadyExists
    ? "already-existed"
    : edgeResult.success
      ? "created"
      : "failed";
  logger.info(
    `[handleApproval.approveGraphTripletCreate] ${outcome}`,
    "handleApproval",
    {
      workspaceId,
      workspaceSlug,
      kind: "graphTripletCreate",
      edge_type: payload.edge_type,
      ref_id: edgeResult.ref_id,
      outcome,
    },
  );

  if (!edgeResult.success) {
    return {
      ok: false,
      error: edgeResult.message ?? "Failed to create edge in knowledge graph.",
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphTripletCreate",
      createdEntityId: edgeResult.ref_id ?? "",
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
      alreadyExisted: edgeResult.alreadyExists,
    },
  };
}

// ── Approve: graph batch triplet create ──────────────────────────────

const GRAPH_BATCH_TRIPLET_CAP = 25;

async function approveGraphBatchTripletCreate(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphBatchTripletCreate" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  const payload = proposal.payload as GraphBatchTripletCreateProposalPayload;

  if (!payload.workspaceId || !Array.isArray(payload.triplets)) {
    return { ok: false, error: "Invalid graph batch triplet proposal payload.", status: 400 };
  }
  if (payload.triplets.length > GRAPH_BATCH_TRIPLET_CAP) {
    return {
      ok: false,
      error: `Batch exceeds the ${GRAPH_BATCH_TRIPLET_CAP}-triplet cap.`,
      status: 400,
    };
  }

  // Re-check reserved keys across every triplet — see approveGraphNodeCreate.
  // Rejected as a whole: a partially-applied batch is worse than none.
  const batchEntries: Array<[string, Record<string, unknown> | undefined]> = [];
  payload.triplets.forEach((t, i) => {
    batchEntries.push(
      [`triplets[${i}].edge_data`, t.edge_data],
      [`triplets[${i}].source.node_data`, inlineNodeData(t.source)],
      [`triplets[${i}].target.node_data`, inlineNodeData(t.target)],
    );
  });
  const reserved = findReservedKeyViolation(batchEntries);
  if (reserved) {
    return { ok: false, error: reserved, status: 400 };
  }

  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  // Dedup inline nodes by (node_type, node_key) within the batch so we
  // don't re-issue addNode when multiple triplets reference the same node.
  const inlineNodeCache = new Map<string, JarvisEdgeEndpoint>();

  async function resolveEndpoint(
    endpoint: GraphBatchTripletCreateProposalPayload["triplets"][number]["source"],
  ): Promise<{ endpoint: JarvisEdgeEndpoint } | { error: string }> {
    if ("ref_id" in endpoint) return { endpoint: { ref_id: endpoint.ref_id } };

    const cacheKey = `${endpoint.node_type}::${JSON.stringify(endpoint.node_data)}`;
    const cached = inlineNodeCache.get(cacheKey);
    if (cached) return { endpoint: cached };

    const r = await resolveInlineNode(config, endpoint);
    if (!r.ok) {
      return { error: r.error };
    }
    inlineNodeCache.set(cacheKey, r.endpoint);
    return { endpoint: r.endpoint };
  }

  // Process triplets sequentially, collecting per-item results.
  const items: Array<{ index: number; ok: boolean; refId?: string; error?: string }> = [];
  let anySuccess = false;

  for (let i = 0; i < payload.triplets.length; i++) {
    const t = payload.triplets[i];

    const srcResult = await resolveEndpoint(t.source);
    if ("error" in srcResult) {
      items.push({ index: i, ok: false, error: `source: ${srcResult.error}` });
      continue;
    }

    const tgtResult = await resolveEndpoint(t.target);
    if ("error" in tgtResult) {
      items.push({ index: i, ok: false, error: `target: ${tgtResult.error}` });
      continue;
    }

    const edgeResult = await addEdgeV2(config, {
      edge: {
        edge_type: t.edge_type,
        ...(t.edge_data ? { edge_data: t.edge_data } : {}),
        ...(t.weight !== undefined ? { weight: t.weight } : {}),
      },
      source: srcResult.endpoint,
      target: tgtResult.endpoint,
    });

    const outcome = edgeResult.alreadyExists
      ? "already-existed"
      : edgeResult.success
        ? "created"
        : "failed";
    logger.info(
      `[handleApproval.approveGraphBatchTripletCreate] triplet[${i}] ${outcome}`,
      "handleApproval",
      {
        workspaceId,
        workspaceSlug,
        kind: "graphBatchTripletCreate",
        index: i,
        edge_type: t.edge_type,
        ref_id: edgeResult.ref_id,
        outcome,
      },
    );

    if (edgeResult.success) {
      anySuccess = true;
      items.push({ index: i, ok: true, refId: edgeResult.ref_id });
    } else {
      items.push({
        index: i,
        ok: false,
        error: edgeResult.message ?? "Edge creation failed",
      });
    }
  }

  // Nothing landed — report a failure rather than stamping an approvalResult.
  // A successful return marks the proposal approved, and `findPriorApproval`
  // then short-circuits every retry, so an all-failed batch would be
  // unrecoverable: no edges written and no way to re-run the write.
  if (!anySuccess) {
    const firstError = items.find((it) => !it.ok)?.error;
    return {
      ok: false,
      error:
        items.length === 0
          ? "Batch contained no triplets."
          : `None of the ${items.length} triplet(s) could be created.${firstError ? ` First error: ${firstError}` : ""}`,
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphBatchTripletCreate",
      createdEntityId: workspaceId,
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
      items,
    },
  };
}


// ── Approve: graph edge delete ───────────────────────────────────────

async function approveGraphEdgeDelete(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphEdgeDelete" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  // Ignore intent.payload — always use the server-persisted proposal payload.
  const payload = proposal.payload as GraphEdgeDeleteProposalPayload;

  if (
    !payload.workspaceId ||
    !payload.edge_type ||
    !payload.source_ref_id ||
    !payload.target_ref_id ||
    payload.source_ref_id === payload.target_ref_id
  ) {
    return { ok: false, error: "Invalid graph edge delete proposal payload.", status: 400 };
  }

  // Authorization runs before reading meta or any external call.
  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  const meta = proposal.meta as { refusedReason?: string } | undefined;
  if (meta?.refusedReason) {
    return { ok: false, error: meta.refusedReason, status: 400 };
  }

  // Find the edge again by its ends: the ref_id in meta came through the
  // client-supplied transcript, and the edge may have gone since.
  const found = await findEdgeByEndpoints(config, {
    source_ref_id: payload.source_ref_id,
    edge_type: payload.edge_type,
    target_ref_id: payload.target_ref_id,
  });
  if (!found.success) {
    return {
      ok: false,
      error: found.message ?? "Failed to read the edge from the knowledge graph.",
      status: 502,
    };
  }
  if (!found.edge) {
    return {
      ok: false,
      error: `No ${payload.edge_type} edge from "${payload.source_ref_id}" to "${payload.target_ref_id}" exists in this workspace's graph — it may already have been removed.`,
      status: 404,
    };
  }

  const result = await deleteEdge(config, found.edge.ref_id);

  const outcome = result.success ? "removed" : result.notFound ? "not-found" : "failed";
  logger.info(
    `[handleApproval.approveGraphEdgeDelete] ${outcome}`,
    "handleApproval",
    {
      workspaceId,
      workspaceSlug,
      kind: "graphEdgeDelete",
      edge_type: payload.edge_type,
      ref_id: found.edge.ref_id,
      outcome,
      ...(result.success ? {} : { message: result.error }),
    },
  );

  if (!result.success) {
    return {
      ok: false,
      error: result.error ?? "Failed to remove the edge from the knowledge graph.",
      status: result.notFound ? 404 : 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphEdgeDelete",
      createdEntityId: found.edge.ref_id,
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
    },
  };
}

// ── Approve: graph node move ─────────────────────────────────────────

/**
 * Move = create the new parent link, confirm it is live, then remove the old
 * one, in that order: a failure between them leaves the node under both
 * parents rather than under none. The confirm matters because Jarvis reports
 * a muted legacy edge as an existing duplicate, which would leave the node
 * with no visible parent. A failed removal is reported as an error (no
 * approvalResult is stamped), so approving again retries: the create is a
 * benign duplicate ("Warning") and the removal runs again.
 */
async function approveGraphNodeMove(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphNodeMove" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  // Ignore intent.payload — always use the server-persisted proposal payload.
  const payload = proposal.payload as GraphNodeMoveProposalPayload;

  if (
    !payload.workspaceId ||
    !payload.ref_id ||
    !payload.edge_type ||
    !payload.from_ref_id ||
    !payload.to_ref_id ||
    payload.to_ref_id === payload.ref_id ||
    payload.from_ref_id === payload.to_ref_id
  ) {
    return { ok: false, error: "Invalid graph node move proposal payload.", status: 400 };
  }

  // Authorization runs before reading meta or any external call.
  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  const meta = proposal.meta as { refusedReason?: string } | undefined;
  if (meta?.refusedReason) {
    return { ok: false, error: meta.refusedReason, status: 400 };
  }

  // Re-read everything the propose tool checked: the transcript is
  // client-supplied, and the graph may have changed since.
  const node = await readNodeByRef(config, payload.ref_id);
  if (!node.success) {
    return {
      ok: false,
      error: `Node "${payload.ref_id}" not found in this workspace's graph.`,
      status: 404,
    };
  }
  const nodeType = node.node_type ?? "";
  if (GRAPH_MIRROR_OWNED_TYPES.has(nodeType)) {
    return {
      ok: false,
      error: `"${nodeType}" is a mirror-owned type and cannot be moved — its links would be restored on the next mirror pass.`,
      status: 400,
    };
  }
  const destination = await readNodeByRef(config, payload.to_ref_id);
  if (!destination.success) {
    return {
      ok: false,
      error: `Destination "${payload.to_ref_id}" not found in this workspace's graph.`,
      status: 404,
    };
  }
  if (await wouldCycle(config, payload)) {
    return {
      ok: false,
      error: `"${payload.to_ref_id}" sits under "${payload.ref_id}" — moving the node there would make a cycle.`,
      status: 400,
    };
  }
  const old = await findEdgeByEndpoints(config, {
    source_ref_id: payload.from_ref_id,
    edge_type: payload.edge_type,
    target_ref_id: payload.ref_id,
  });
  if (!old.success) {
    return {
      ok: false,
      error: old.message ?? "Failed to read the node's current link from the knowledge graph.",
      status: 502,
    };
  }
  if (!old.edge) {
    return {
      ok: false,
      error: `"${payload.ref_id}" is no longer under "${payload.from_ref_id}" along ${payload.edge_type} — nothing to move.`,
      status: 404,
    };
  }

  // 1. The new link first.
  const created = await addEdgeV2(config, {
    edge: { edge_type: payload.edge_type },
    source: { ref_id: payload.to_ref_id },
    target: { ref_id: payload.ref_id },
  });
  if (!created.success) {
    logger.info(`[handleApproval.approveGraphNodeMove] link failed`, "handleApproval", {
      workspaceId,
      workspaceSlug,
      kind: "graphNodeMove",
      edge_type: payload.edge_type,
      ref_id: payload.ref_id,
      to_ref_id: payload.to_ref_id,
      outcome: "failed",
      message: created.message,
    });
    return {
      ok: false,
      error: created.message ?? "Failed to link the node under its new parent.",
      status: 502,
    };
  }

  // 2. Confirm the new link is live before the old one goes.
  const linked = await findEdgeByEndpoints(config, {
    source_ref_id: payload.to_ref_id,
    edge_type: payload.edge_type,
    target_ref_id: payload.ref_id,
  });
  if (!linked.success || !linked.edge) {
    logger.info(`[handleApproval.approveGraphNodeMove] link not live`, "handleApproval", {
      workspaceId,
      workspaceSlug,
      kind: "graphNodeMove",
      edge_type: payload.edge_type,
      ref_id: payload.ref_id,
      to_ref_id: payload.to_ref_id,
      alreadyLinked: created.alreadyExists,
      outcome: "link-not-live",
      ...(linked.success ? {} : { message: linked.message }),
    });
    return {
      ok: false,
      error: linked.success
        ? `Could not confirm a live ${payload.edge_type} link from "${payload.to_ref_id}" — the old link from "${payload.from_ref_id}" was kept, so the node still has a parent.`
        : linked.message ?? "Failed to confirm the node's new link in the knowledge graph.",
      status: linked.success ? 409 : 502,
    };
  }

  // 3. Then the old one goes.
  const removed = await deleteEdge(config, old.edge.ref_id);
  const outcome = removed.success ? "moved" : "unlink-failed";
  logger.info(`[handleApproval.approveGraphNodeMove] ${outcome}`, "handleApproval", {
    workspaceId,
    workspaceSlug,
    kind: "graphNodeMove",
    edge_type: payload.edge_type,
    ref_id: payload.ref_id,
    from_ref_id: payload.from_ref_id,
    to_ref_id: payload.to_ref_id,
    old_edge_ref_id: old.edge.ref_id,
    new_edge_ref_id: created.ref_id,
    alreadyLinked: created.alreadyExists,
    outcome,
    ...(removed.success ? {} : { message: removed.error }),
  });
  if (!removed.success) {
    return {
      ok: false,
      error: `The node is now linked under "${payload.to_ref_id}", but its old link from "${payload.from_ref_id}" could not be removed${
        removed.error ? ` (${removed.error})` : ""
      }. Approve again to retry the removal.`,
      status: 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphNodeMove",
      createdEntityId: payload.ref_id,
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
      alreadyExisted: created.alreadyExists,
    },
  };
}

// ── Approve: graph node delete ───────────────────────────────────────

/**
 * Soft-delete one node. Jarvis stamps it deleted and permanently removes its
 * edges in one write and returns the delete fields from that write, so
 * `deleteSingleNode` succeeding IS the check that the node is gone — no
 * second read.
 */
async function approveGraphNodeDelete(args: {
  orgId: string;
  userId: string;
  proposal: Extract<ProposalOutput, { kind: "graphNodeDelete" }>;
}): Promise<HandleApprovalReturn> {
  const { orgId, userId, proposal } = args;
  // Ignore intent.payload — always use the server-persisted proposal payload.
  const payload = proposal.payload as GraphNodeDeleteProposalPayload;

  if (!payload.workspaceId || !payload.ref_id) {
    return { ok: false, error: "Invalid graph node delete proposal payload.", status: 400 };
  }

  // Authorization runs before reading meta or any external call.
  const resolved = await resolveGraphJarvis(orgId, userId, {
    workspaceId: payload.workspaceId,
  });
  if (!resolved.ok) {
    return { ok: false, error: "Workspace not found or access denied.", status: 403 };
  }
  const { workspaceId, workspaceSlug, config } = resolved.access;

  const meta = proposal.meta as { refusedReason?: string } | undefined;
  if (meta?.refusedReason) {
    return { ok: false, error: meta.refusedReason, status: 400 };
  }

  const result = await deleteSingleNode(config, payload.ref_id, payload.namespace);

  const outcome = result.success ? "deleted" : result.notFound ? "not-found" : "failed";
  logger.info(
    `[handleApproval.approveGraphNodeDelete] ${outcome}`,
    "handleApproval",
    {
      workspaceId,
      workspaceSlug,
      kind: "graphNodeDelete",
      ref_id: payload.ref_id,
      namespace: payload.namespace ?? "default",
      outcome,
      ...(result.success
        ? {
            deleted_edge_count: result.deletedEdgeCount ?? null,
            ...(result.deletedEdgeCount == null ? { deleted_edge_count_unknown: true } : {}),
          }
        : { message: result.error }),
    },
  );

  if (!result.success) {
    return {
      ok: false,
      error: result.error ?? "Failed to delete the node from the knowledge graph.",
      status: result.notFound ? 404 : 502,
    };
  }

  return {
    ok: true,
    alreadyApproved: false,
    result: {
      proposalId: proposal.proposalId,
      kind: "graphNodeDelete",
      createdEntityId: payload.ref_id,
      landedOn: `workspace:${workspaceId}`,
      workspaceSlug,
    },
  };
}

// ── Reject ───────────────────────────────────────────────────────────

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
