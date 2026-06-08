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
import { WorkflowStatus } from "@prisma/client";
import type { Artifact, ChatMessage } from "@prisma/client";
import { isClarifyingQuestions } from "@/types/stakwork";
import type { ClarifyingQuestion } from "@/types/stakwork";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
// Type-only import — the runtime `invokeCanvasAgentOnPlannerMessage` is
// loaded by the webhook route (in `after()`), NOT here, so this module
// doesn't statically pull in `runCanvasAgent`'s heavy module graph
// (bifrost, pods, encryption, …). We just report whether an auto-turn
// is warranted; the caller schedules it off the request's critical path.
import type { AutoTurnWakeReason } from "@/services/canvas-agent-autoturn";

/**
 * Extract the planner's clarifying-question list from a message, if it
 * carries one.
 *
 * **Important representation note.** A feature planner asks the user a
 * structured question via a `PLAN`-typed artifact whose JSON content
 * passes `isClarifyingQuestions` (`tool_use === "ask_clarifying_questions"`,
 * `content: ClarifyingQuestion[]`) — the exact shape
 * `ClarifyingQuestionsPreview` renders and `FeaturePlanChat` /
 * `FeaturePlanChatMessage` detect. This is NOT an `ArtifactType.FORM`
 * (that's the *task* chat's form representation). Returns the questions
 * array (≥1) or `null` when the message has no clarifying-questions
 * artifact.
 */
export function extractClarifyingQuestions(
  plannerMessage: { artifacts: Artifact[] },
): ClarifyingQuestion[] | null {
  for (const a of plannerMessage.artifacts) {
    if (a.type === "PLAN" && isClarifyingQuestions(a.content)) {
      const questions = a.content.content;
      if (Array.isArray(questions) && questions.length > 0) return questions;
    }
  }
  return null;
}

/**
 * Did this planner message carry a `TASKS` artifact — i.e. the planner
 * just generated a task breakdown? Surfaced as `source.hasTasks` so the
 * card can offer a **Start Tasks** button (which fetches the live
 * ready-count and POSTs to `…/tasks/assign-all`). Like the other
 * signals, a snapshot: the actual count is read live by the card.
 */
export function plannerMessageHasTasks(
  plannerMessage: { artifacts: Artifact[] },
): boolean {
  return plannerMessage.artifacts.some((a) => a.type === "TASKS");
}

/** Subset of `Feature` the fan-out needs. */
export interface FanOutFeatureRef {
  id: string;
  parentCanvasConversationId: string | null;
  /** Carried for future use (e.g. workspace-scoped logging). Not read in v1. */
  workspaceId: string;
  /**
   * The feature's live workflow status, used by the Phase 3 "actionable"
   * check to decide whether a planner message warrants an autonomous
   * canvas-agent turn. Optional for backwards-compat with existing
   * callers/tests; absent → workflow-transition wakeups don't fire.
   */
  workflowStatus?: WorkflowStatus | null;
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
    /**
     * Feature `workflowStatus` at fan-out time (Phase 3). Drives the
     * `SubAgentRunCard` status pill. Stringified enum value; omitted
     * when the caller didn't supply it.
     */
    workflowStatus?: string;
    /**
     * `true` when the planner message carried a clarifying-questions
     * artifact (`PLAN` + `ask_clarifying_questions`) — Phase 3. Drives
     * the `Waiting for you` pill.
     */
    hasForm?: boolean;
    /**
     * The clarifying-question list (Phase 4), embedded so the canvas
     * conversation is self-contained — `PlannerFormSlot` renders this
     * verbatim via `ClarifyingQuestionsPreview` with no extra fetch,
     * and it round-trips through share / fork / iOS like every other
     * message field. Present iff `hasForm` is `true`.
     */
    formQuestions?: ClarifyingQuestion[];
    /**
     * `true` when the planner message carried a `TASKS` artifact — it
     * just generated a task breakdown. Gates the card's **Start Tasks**
     * button (which reads the live ready-count itself).
     */
    hasTasks?: boolean;
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
 *   - A `CANVAS_CONVERSATION_UPDATED` Pusher nudge fires so an open
 *     browser shows the planner message immediately.
 *
 * **Returns the auto-turn wake reason** (or `null`). The caller (the
 * Stakwork webhook route) is responsible for scheduling the actual
 * `invokeCanvasAgentOnPlannerMessage` in `after()` — off the webhook's
 * critical path — so the LLM turn never blocks the response to
 * Stakwork. The append + Pusher nudge are the only synchronous work
 * here (a single short transaction, <10ms typical).
 */
export async function fanOutPlannerMessageToCanvas(
  feature: FanOutFeatureRef,
  plannerMessage: FanOutPlannerMessage,
): Promise<AutoTurnWakeReason | null> {
  // No owning conversation → nothing to fan out to. Common case for
  // features created from the per-feature plan page that have never
  // been touched by a canvas agent.
  if (!feature.parentCanvasConversationId) return null;

  const conversationId = feature.parentCanvasConversationId;

  try {
    // Tracks whether THIS call actually appended a row (vs. an
    // idempotent no-op). Only a fresh append should wake the agent —
    // re-deliveries must not re-trigger an auto-turn.
    let didAppend = false;
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

      const formQuestions = extractClarifyingQuestions(plannerMessage);
      const hasTasks = plannerMessageHasTasks(plannerMessage);

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
          // Phase 3/4 status-pill + inline-FORM signal. All optional —
          // only set when present, so the card distinguishes "unknown"
          // (legacy/absent) from a real state.
          ...(feature.workflowStatus
            ? { workflowStatus: feature.workflowStatus }
            : {}),
          ...(formQuestions
            ? { hasForm: true, formQuestions }
            : {}),
          ...(hasTasks ? { hasTasks: true } : {}),
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
      didAppend = true;
    });

    // Re-delivery / double-fire → no fresh append → nothing to push or
    // wake on.
    if (!didAppend) return null;

    // Push the planner message to an open browser immediately (live
    // chat). Fire-and-forget; never blocks the webhook.
    notifyCanvasConversationUpdated(conversationId, "planner");

    // If the message is "actionable", report the wake reason so the
    // caller can schedule the autonomous canvas-agent turn in `after()`
    // (off the webhook's critical path). The turn itself is gated behind
    // `CANVAS_AUTONOMOUS_TURNS_ENABLED` (off by default).
    return actionableWakeReason(feature, plannerMessage);
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
    return null;
  }
}

/**
 * Decide whether a planner message is "actionable" — i.e. worth waking
 * the canvas agent for — and, if so, classify *why*. Returns `null`
 * for pure-prose status updates (which fan out but don't trigger a
 * turn). Mirrors the precise definition in
 * `docs/plans/canvas-agent-manages-planners.md` Phase 3:
 *
 *   1. A clarifying-questions artifact — `PLAN` + `ask_clarifying_questions`
 *      (planner's explicit "a human must pick"). → `"form"`.
 *      Deterministic. (NOT `ArtifactType.FORM`, which is the task
 *      chat's representation — feature planners use the PLAN variant.)
 *   2. The feature's `workflowStatus` is terminal
 *      (`COMPLETED` / `FAILED` / `HALTED` / `ERROR`). → mapped reason.
 *      Deterministic.
 *   3. The message text ends with `?` (heuristic for "asked a question
 *      without a FORM"). → `"question"`. Fragile-but-cheap; a false
 *      positive costs one extra turn the agent can `stay_silent` on.
 *
 * FORM takes precedence over the others (it's the strongest signal).
 */
export function actionableWakeReason(
  feature: FanOutFeatureRef,
  plannerMessage: FanOutPlannerMessage,
): AutoTurnWakeReason | null {
  // 1. Clarifying-questions artifact (PLAN + ask_clarifying_questions).
  if (extractClarifyingQuestions(plannerMessage)) return "form";

  // 2. Terminal workflow status.
  switch (feature.workflowStatus) {
    case WorkflowStatus.COMPLETED:
      return "completed";
    case WorkflowStatus.HALTED:
      return "halted";
    case WorkflowStatus.FAILED:
    case WorkflowStatus.ERROR:
      return "failed";
    default:
      break;
  }

  // 3. Trailing-`?` question heuristic.
  if (plannerMessage.message.trim().endsWith("?")) return "question";

  return null;
}
