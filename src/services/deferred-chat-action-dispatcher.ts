/**
 * Dispatcher for due `DeferredChatAction` records.
 *
 * Called by the per-minute cron at `/api/cron/deferred-chat-actions`.
 * For each PENDING action whose `fireAt` has passed, the dispatcher:
 *   1. Claims it via SELECT FOR UPDATE SKIP LOCKED (concurrent-safe)
 *   2. Re-runs the original query via `runCanvasAgent`
 *   3. Prepends "Checking back as requested…" to the response
 *   4. Appends the result to the originating `SharedConversation`
 *   5. Patches `deferredCheck.status` → "FIRED" in the messages JSON
 *   6. Marks the `DeferredChatAction` row as FIRED
 *   7. Notifies open browser tabs via Pusher
 *
 * Errors on individual actions are caught, logged, and status is set to
 * FAILED — remaining actions continue processing.
 */

import { db } from "@/lib/db";
import { type ModelMessage } from "ai";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import {
  messagesFromSteps,
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";
import { updateDeferredCheckStatus } from "@/services/deferred-check";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";

const LOG_PREFIX = "[DeferredChatActions]";
const MAX_PER_RUN = 10;

export interface DeferredDispatchResult {
  fired: number;
  failed: number;
  errors: string[];
}

function hasConcepts(c: CachedConcepts): boolean {
  if (Array.isArray(c.features)) return c.features.length > 0;
  if (c.conceptsByWorkspace) {
    return Object.values(c.conceptsByWorkspace).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }
  return false;
}

async function persistPromptConcepts(
  conversationId: string,
  concepts: CachedConcepts,
): Promise<void> {
  const patch = JSON.stringify({ promptConcepts: concepts });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${conversationId}
  `;
}

/**
 * Pick up all DeferredChatAction records that are due and have not yet been
 * processed. Returns counts of fired/failed actions.
 */
export async function dispatchDueActions(): Promise<DeferredDispatchResult> {
  const result: DeferredDispatchResult = { fired: 0, failed: 0, errors: [] };

  console.log(`${LOG_PREFIX} Starting dispatch run`);

  // Fetch up to MAX_PER_RUN due actions. We use a plain findMany here (not
  // FOR UPDATE) since each action is claimed with its own transaction below.
  const due = await db.deferredChatAction.findMany({
    where: {
      status: "PENDING",
      fireAt: { lte: new Date() },
    },
    orderBy: { fireAt: "asc" },
    take: MAX_PER_RUN,
  });

  if (due.length === 0) {
    console.log(`${LOG_PREFIX} Dispatch complete — fired: 0, failed: 0`);
    return result;
  }

  for (const action of due) {
    console.log(
      `${LOG_PREFIX} Dispatching deferredActionId=${action.id} conversationId=${action.conversationId}`,
    );

    try {
      // Load the conversation to get workspaceSlugs + cachedConcepts,
      // mirroring the same resolution logic as runAutoTurn.
      const conversation = await db.sharedConversation.findUnique({
        where: { id: action.conversationId },
        select: {
          id: true,
          userId: true,
          sourceControlOrgId: true,
          messages: true,
          settings: true,
          workspace: { select: { slug: true } },
        },
      });

      if (!conversation) {
        throw new Error(
          `SharedConversation ${action.conversationId} not found`,
        );
      }

      if (!conversation.userId || !conversation.sourceControlOrgId) {
        throw new Error(
          `Conversation ${action.conversationId} is missing userId or orgId — cannot dispatch`,
        );
      }

      // IDOR guard: the conversation must be owned by the same user and org
      // that created the DeferredChatAction. A mismatched conversationId
      // (e.g. from a corrupted row) must never cause the dispatcher to
      // execute a query under a different user's identity or append to
      // another user's conversation.
      if (
        conversation.userId !== action.userId ||
        conversation.sourceControlOrgId !== action.orgId
      ) {
        throw new Error(
          `DeferredChatAction ${action.id} ownership mismatch: ` +
            `action.userId=${action.userId} conversation.userId=${conversation.userId}, ` +
            `action.orgId=${action.orgId} conversation.orgId=${conversation.sourceControlOrgId}`,
        );
      }

      // Resolve workspace slugs (mirrors runAutoTurn logic).
      const settings = (conversation.settings ?? {}) as {
        extraWorkspaceSlugs?: unknown;
        promptConcepts?: unknown;
      };
      const extraSlugs = Array.isArray(settings.extraWorkspaceSlugs)
        ? settings.extraWorkspaceSlugs.filter(
            (s): s is string => typeof s === "string",
          )
        : [];
      const slugSet = new Set<string>();
      if (conversation.workspace?.slug) slugSet.add(conversation.workspace.slug);
      for (const s of extraSlugs) slugSet.add(s);
      const workspaceSlugs = Array.from(slugSet).slice(0, 20);

      if (workspaceSlugs.length === 0) {
        throw new Error(
          `No workspace slugs resolved for conversation ${action.conversationId}`,
        );
      }

      // Attempt to claim the action inside a transaction with SKIP LOCKED
      // so a concurrent cron invocation can't double-fire it.
      let claimed = false;
      await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT id, status FROM deferred_chat_actions
          WHERE id = ${action.id}
          FOR UPDATE SKIP LOCKED
        `;
        if (locked.length === 0 || locked[0].status !== "PENDING") {
          // Another process claimed it — skip.
          return;
        }
        // Mark as FIRED optimistically inside the transaction so no other
        // worker picks it up while we are running the agent below.
        await tx.deferredChatAction.update({
          where: { id: action.id },
          data: { status: "FIRED", firedAt: new Date() },
        });
        claimed = true;
      });

      if (!claimed) {
        // Another dispatcher already handled this action.
        console.log(
          `${LOG_PREFIX} deferredActionId=${action.id} already claimed by another worker — skipping`,
        );
        continue;
      }

      // Build the model messages from stored conversation history.
      const storedMessages = Array.isArray(conversation.messages)
        ? (conversation.messages as unknown as StoredMessage[])
        : [];
      const historyMessages = toModelMessages(storedMessages);

      // Append the synthetic deferred-check user message.
      const syntheticUserMessage: ModelMessage = {
        role: "user",
        content: `[Deferred check — do not mention this prefix to the user]\n\n${action.query}`,
      };
      const modelMessages: ModelMessage[] = [
        ...historyMessages,
        syntheticUserMessage,
      ];

      // Reuse cached concepts to avoid slow swarm round-trips.
      const cachedConcepts =
        settings.promptConcepts &&
        typeof settings.promptConcepts === "object"
          ? (settings.promptConcepts as CachedConcepts)
          : null;

      const idPrefix = `deferred-${action.id}-`;

      const { result: agentResult, cacheableConcepts, cacheHit } =
        await runCanvasAgent({
          userId: conversation.userId,
          orgId: conversation.sourceControlOrgId,
          workspaceSlugs,
          messages: modelMessages,
          cachedConcepts,
          silentPusher: true,
          currentCanvasConversationId: action.conversationId,
        });

      // Self-heal concept cache (mirrors autoturn logic).
      if (!cacheHit && hasConcepts(cacheableConcepts)) {
        void persistPromptConcepts(action.conversationId, cacheableConcepts).catch((e) =>
          console.error(`${LOG_PREFIX} prompt-cache persist failed:`, e),
        );
      }

      // Consume the stream to completion.
      await agentResult.text;
      const steps = await agentResult.steps;

      // Build rows from steps, then prepend "Checking back as requested…"
      // to the first text row.
      const rows = messagesFromSteps(
        steps as Parameters<typeof messagesFromSteps>[0],
        idPrefix,
      );

      // Prepend the "Checking back as requested…" header to the first
      // assistant text message.
      const HEADER = "Checking back as requested…\n\n";
      for (const row of rows) {
        if (row.role === "assistant" && row.content.trim()) {
          row.content = HEADER + row.content;
          break;
        }
      }

      // If the agent produced no text rows at all, synthesise a minimal one.
      if (rows.every((r) => !r.content.trim())) {
        rows.unshift({
          id: `${idPrefix}header`,
          role: "assistant",
          content: HEADER,
          timestamp: new Date().toISOString(),
        });
      }

      await appendTurnMessages({
        conversationId: action.conversationId,
        rows,
        idPrefix,
        reason: "deferred-check-fired",
      });

      // Patch deferredCheck.status → FIRED in the conversation JSON and
      // update the DB row status (already set to FIRED in the transaction
      // above, but updateDeferredCheckStatus also patches the JSON).
      await updateDeferredCheckStatus(
        action.conversationId,
        action.id,
        "FIRED",
      );

      // Notify open browser tabs.
      notifyCanvasConversationUpdated(
        action.conversationId,
        "deferred-check-fired",
      );

      console.log(`${LOG_PREFIX} Fired deferredActionId=${action.id}`);
      result.fired++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${LOG_PREFIX} FAILED deferredActionId=${action.id} error=${message}`,
      );
      result.errors.push(`${action.id}: ${message}`);
      result.failed++;

      // Best-effort: mark the row as FAILED so it doesn't get retried.
      await db.deferredChatAction
        .update({
          where: { id: action.id },
          data: { status: "FAILED" },
        })
        .catch((e) =>
          console.error(
            `${LOG_PREFIX} Failed to mark action as FAILED:`,
            e,
          ),
        );
    }
  }

  console.log(
    `${LOG_PREFIX} Dispatch complete — fired: ${result.fired}, failed: ${result.failed}`,
  );
  return result;
}
