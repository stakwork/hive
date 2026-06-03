/**
 * Canvas planner fan-out worker.
 *
 * Echoes a planner's ASSISTANT chat message into the canvas
 * conversation that "owns" the feature (per
 * `Feature.parentCanvasConversationId`). The echoed row carries
 * `source: { kind: "planner", featureId, plannerMessageId }` so the
 * canvas chat UI can:
 *   1. Suppress it from the main scroll (see `SidebarChat.tsx`).
 *   2. Surface it inside the feature's `SubAgentRunCard` as an
 *      inbound thread entry (see `SubAgentRunCard.tsx`).
 *
 * Design constraints (from `docs/plans/canvas-agent-manages-planners.md`):
 *   - **Idempotent on `plannerMessageId`**: if a fan-out lands twice
 *     for the same planner message (worker retry, webhook redelivery),
 *     the second write is a no-op.
 *   - **Append-only**: never reorders or overwrites; the row-level
 *     `SELECT ... FOR UPDATE` serializes against the client-driven
 *     autosave PUT at
 *     `src/app/api/workspaces/[slug]/chat/conversations/[conversationId]/route.ts`.
 *     Both writers append; the lock just decides arrival order.
 *   - **Failure-tolerant**: any error is logged but never blocks the
 *     planner's own write. The planner's chat history (`ChatMessage`
 *     rows) is the source of truth for plans; the canvas conversation
 *     is a derived surface. A missed fan-out leaves the canvas
 *     conversation incomplete for one message — the user can prompt
 *     the canvas agent to `read_feature` to recover the missing
 *     context, and any subsequent planner message will fan out
 *     successfully (idempotency means re-running won't double-write).
 *
 * Phase 3 (gated behind `CANVAS_AUTONOMOUS_TURNS_ENABLED`) will add a
 * post-write hook that wakes the canvas agent for "actionable"
 * planner messages (FORM artifacts, workflow-status transitions,
 * trailing-`?` heuristic). Phase 2 ships the fan-out without that
 * hook — the user manually prompts the canvas agent to handle
 * anything they see.
 */

import { db } from "@/lib/db";
import type { Artifact, ChatMessage } from "@prisma/client";

/** Subset of `Feature` the fan-out needs. */
export interface FanOutFeatureRef {
  id: string;
  parentCanvasConversationId: string | null;
  /** Carried for future use (e.g. workspace-scoped logging). Not read in v1. */
  workspaceId: string;
}

/** Subset of `ChatMessage` the fan-out needs. Artifacts are eagerly loaded. */
export type FanOutPlannerMessage = ChatMessage & { artifacts: Artifact[] };

/**
 * Shape of a `CanvasChatMessage` row inside
 * `SharedConversation.messages` JSON. Kept loose (Record-shaped)
 * because the column is `Json` — Prisma doesn't type-check what we
 * write. The render-side `CanvasChatMessage` interface in
 * `src/app/org/[githubLogin]/_state/canvasChatStore.ts` is the
 * canonical shape; this is just what we serialize.
 */
type CanvasMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO string — the client store wraps in `new Date()` on hydrate. */
  timestamp: string;
  source: {
    kind: "planner";
    featureId: string;
    plannerMessageId: string;
  };
  /** Empty for v1; Phase 3 may populate when surfacing artifacts. */
  artifactIds?: string[];
};

/**
 * Append a planner's ASSISTANT chat message into its owning canvas
 * conversation, if any.
 *
 * Pre-conditions:
 *   - `plannerMessage.role` is ASSISTANT (caller's responsibility;
 *     we don't re-check — the only call site is the Stakwork
 *     webhook write path, which only creates ASSISTANT rows).
 *
 * Post-conditions on success:
 *   - The conversation's `messages` JSON has one new entry with the
 *     `source.plannerMessageId === plannerMessage.id`.
 *   - `lastMessageAt` is bumped to the planner message's timestamp.
 *
 * Returns nothing — fire-and-forget by design. Callers should not
 * await the result blocking the user-facing webhook response, but in
 * practice the work is a single short transaction (<10ms typical)
 * so awaiting is fine.
 */
export async function fanOutPlannerMessageToCanvas(
  feature: FanOutFeatureRef,
  plannerMessage: FanOutPlannerMessage,
): Promise<void> {
  // No owning conversation → nothing to fan out to. Common case for
  // features created from the per-feature plan page that have never
  // been touched by a canvas agent.
  if (!feature.parentCanvasConversationId) return;

  const conversationId = feature.parentCanvasConversationId;

  try {
    await db.$transaction(async (tx) => {
      // Row-level lock against concurrent autosave PUTs. See the
      // matching wrap in
      // `src/app/api/workspaces/[slug]/chat/conversations/[conversationId]/route.ts`.
      // If the row was deleted (user cleared chat) the lock returns
      // empty and we silently no-op — soft reference, no FK to
      // cascade.
      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return; // conversation was deleted; nothing to do
      }

      const existingMessages = Array.isArray(locked[0].messages)
        ? (locked[0].messages as CanvasMessageRow[])
        : [];

      // Idempotency: if this planner message already landed (worker
      // retry, double-fire), bail. We scan the whole array; for a
      // conversation that's been collecting fan-outs for a while
      // this is O(n) per write but n is bounded by user-perceived
      // conversation length (typical hundreds, not thousands).
      const alreadyFannedOut = existingMessages.some(
        (m) =>
          m.source?.kind === "planner" &&
          m.source.plannerMessageId === plannerMessage.id,
      );
      if (alreadyFannedOut) {
        return;
      }

      const newRow: CanvasMessageRow = {
        // The canvas chat treats messages as identified by their own
        // ids. Prefix to distinguish from canvas-agent assistant
        // messages and to make this row's origin obvious in logs.
        id: `planner-${plannerMessage.id}`,
        role: "assistant",
        content: plannerMessage.message,
        timestamp: plannerMessage.timestamp.toISOString(),
        source: {
          kind: "planner",
          featureId: feature.id,
          plannerMessageId: plannerMessage.id,
        },
      };

      const updatedMessages = [...existingMessages, newRow];

      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: updatedMessages as unknown as never,
          lastMessageAt: plannerMessage.timestamp,
        },
      });
    });
  } catch (e) {
    // Non-fatal: the planner's own write succeeded; the canvas
    // conversation is just incomplete for this one message. The user
    // can `read_feature` to recover the context.
    console.error(
      "[canvas-planner-fanout] fanOutPlannerMessageToCanvas failed (non-fatal):",
      {
        featureId: feature.id,
        plannerMessageId: plannerMessage.id,
        conversationId,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
}
