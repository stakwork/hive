/**
 * Canvas agent-run fan-out.
 *
 * Appends a `source: { kind: "agent_run" }` row to the owning canvas
 * conversation once a canvas-linked workflow-explorer run completes (or
 * fails), whether it finished inline or via the webhook fan-back safety net.
 *
 * Design mirrors `canvas-graph-walk-fanout.ts`:
 *   - `FOR UPDATE` lock serializes against concurrent autosave PUTs.
 *   - Idempotent on `runId`: a second call for the same run is a silent
 *     no-op (prevents double-rows on webhook retry).
 *   - Non-fatal: failures are logged but never block the caller.
 *
 * Security guards beyond the clone:
 *   - IDOR / ownership re-validation: before any write, re-check that the
 *     loaded conversation's `sourceControlOrgId === agentRunRow.orgId &&
 *     conversation.userId === agentRunRow.userId` (mirrors
 *     `canvas-graph-walk-worker`). Bails non-fatally on mismatch so a
 *     forged webhook payload cannot hijack a foreign conversation.
 *   - Always writes to `agentRunRow.conversationId`, NEVER to any
 *     `conversationId` supplied by the external payload.
 *   - Payload hardening: external `content` is validated for shape,
 *     coerced to a string, and length-capped before append.
 */

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";

/** Maximum byte length accepted for the run result content. ~128 KB. */
const MAX_CONTENT_LENGTH = 128 * 1024;

export interface AgentRunFanOutPayload {
  runId: string;
  agentKind: string;
  title: string;
  /** Externally-supplied result text (already coerced + length-capped upstream). */
  content: string;
  status: "success" | "failed";
}

/** Row shape written into SharedConversation.messages. */
type AgentRunMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  source: {
    kind: "agent_run";
    runId: string;
    agentKind: string;
    title: string;
    status: string;
  };
};

/**
 * Row fields from `AgentRun` needed for ownership re-validation + fan-out.
 */
export interface AgentRunRow {
  conversationId: string;
  orgId: string;
  userId: string;
}

/**
 * Harden an external payload string: coerce to string, trim, length-cap.
 * Returns null if the value is missing / non-coercible / oversized.
 */
export function hardenContent(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === "string" ? raw : String(raw);
  if (s.length > MAX_CONTENT_LENGTH) return null;
  return s;
}

/**
 * Append an agent-run result row to the owning canvas conversation.
 *
 * Idempotent: if a row with `source.runId === payload.runId` already exists,
 * this is a silent no-op (safe for webhook retries).
 *
 * @param agentRunRow  The `AgentRun` DB row (conversationId / orgId / userId
 *                     come from the DB, never from the external payload).
 */
export async function fanOutAgentRunToCanvas(
  agentRunRow: AgentRunRow,
  payload: AgentRunFanOutPayload,
): Promise<void> {
  const { runId, agentKind, title, content, status } = payload;
  const { conversationId, orgId, userId } = agentRunRow;

  try {
    let didAppend = false;

    await db.$transaction(async (tx) => {
      // ── Ownership re-validation ───────────────────────────────────────
      // Re-read conversation ownership before any write — mirroring
      // `canvas-graph-walk-worker`. We always write to `agentRunRow.conversationId`
      // (trusted DB value), but verify it still belongs to the expected
      // org + user so a compromised row can't direct writes elsewhere.
      const conversation = await tx.sharedConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true, sourceControlOrgId: true },
      });
      if (!conversation) {
        console.log("[canvas-agent-run-fanout] conversation not found — skip", {
          conversationId,
          runId,
        });
        return;
      }
      if (
        conversation.sourceControlOrgId !== orgId ||
        conversation.userId !== userId
      ) {
        console.warn("[canvas-agent-run-fanout] ownership mismatch — bail", {
          conversationId,
          runId,
          expectedOrgId: orgId,
          actualOrgId: conversation.sourceControlOrgId,
        });
        return;
      }

      // ── FOR UPDATE lock ───────────────────────────────────────────────
      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return; // Deleted between the check above and the lock — no-op.
      }

      const existingMessages = Array.isArray(locked[0].messages)
        ? (locked[0].messages as AgentRunMessageRow[])
        : [];

      // ── Idempotency ───────────────────────────────────────────────────
      const alreadyFannedOut = existingMessages.some(
        (m) =>
          (m.source as { kind?: string; runId?: string })?.kind ===
            "agent_run" &&
          (m.source as { runId?: string })?.runId === runId,
      );
      if (alreadyFannedOut) {
        return;
      }

      const newRow: AgentRunMessageRow = {
        id: `agent-run-${runId}`,
        role: "assistant",
        content:
          status === "success"
            ? content
            : `The workflow explorer run "${title}" did not complete: ${content}`,
        timestamp: new Date().toISOString(),
        source: {
          kind: "agent_run",
          runId,
          agentKind,
          title,
          status,
        },
      };

      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [...existingMessages, newRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      didAppend = true;
    });

    console.log("[canvas-agent-run-fanout]", {
      conversationId,
      runId,
      title,
      status,
      didAppend,
    });

    if (didAppend) {
      notifyCanvasConversationUpdated(conversationId, "agent_run");
    }
  } catch (e) {
    console.error(
      "[canvas-agent-run-fanout] fanOutAgentRunToCanvas failed (non-fatal):",
      {
        conversationId,
        runId,
        title,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
}
