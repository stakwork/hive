/**
 * Canvas strut fan-out.
 *
 * Appends a `source: { kind: "strut" }` row to the owning canvas
 * conversation for each callback a dispatched strut chat posts (see
 * `src/lib/ai/strutTools.ts`): one per turn end, plus a closing note when
 * strut reports the chat settled without another turn.
 *
 * Mirrors `canvas-agent-run-fanout.ts` — `FOR UPDATE` lock against the
 * autosave PUT, ownership re-validation against the `AgentRun` row (never
 * the external payload), never throws — with one difference: a dispatch yields
 * SEVERAL rows, so idempotency is keyed on `(runId, turn, event)`.
 *
 * The content's header line names the workspace + strut chat id. Stored
 * rows reach the model as plain text (`source` is UI-only), and the agent
 * needs that id to continue the chat.
 */

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import type { AgentRunRow } from "@/services/canvas-agent-run-fanout";

export interface StrutFanOutPayload {
  runId: string;
  title: string;
  workspaceSlug: string;
  chatId: string;
  turn: number;
  event: "turn.end" | "settled";
  status: "done" | "error";
  /** Hardened (coerced + length-capped) upstream. */
  text: string | null;
  error: string | null;
  settled: boolean;
  parked: boolean;
}

type StrutMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  source: {
    kind: "strut";
    runId: string;
    title: string;
    workspaceSlug: string;
    chatId: string;
    turn: number;
    event: string;
    status: string;
    settled: boolean;
  };
};

/** Row id — also the idempotency key, and the auto-turn's wake id. */
export function strutRowId(p: Pick<StrutFanOutPayload, "runId" | "turn" | "event">): string {
  return `strut-${p.runId}-${p.turn}-${p.event === "settled" ? "settled" : "turn"}`;
}

export function renderStrutContent(p: StrutFanOutPayload): string {
  const header = `**Strut · ${p.workspaceSlug} · chat \`${p.chatId}\`** — ${p.title}`;
  const footer = p.parked
    ? "\n\n_Strut paused its own follow-ups (auto-turn cap reached) — it continues when the chat is dispatched again._"
    : !p.settled
      ? "\n\n_Strut is still working — another reply will follow._"
      : "";
  if (p.event === "settled") {
    return `${header}\n\nStrut finished its background work with nothing further to report.${footer}`;
  }
  if (p.status === "error") {
    return `${header}\n\nStrut's turn did not complete: ${p.error ?? "unknown error"}${footer}`;
  }
  return `${header}\n\n${p.text ?? "_(no reply text)_"}${footer}`;
}

/**
 * - `appended`  — THIS call wrote the row (the caller may schedule a wake).
 * - `duplicate` — a retry; the row was already there.
 * - `skipped`   — no delivery target (conversation gone / not the owner's).
 * - `failed`    — transient; the caller answers 5xx so strut retries.
 */
export type StrutFanOutResult = "appended" | "duplicate" | "skipped" | "failed";

/** Append one strut callback to the owning conversation. Never throws. */
export async function fanOutStrutToCanvas(
  agentRunRow: AgentRunRow,
  payload: StrutFanOutPayload,
): Promise<StrutFanOutResult> {
  const { conversationId, orgId, userId } = agentRunRow;
  const id = strutRowId(payload);

  try {
    let result = "skipped" as StrutFanOutResult;

    await db.$transaction(async (tx) => {
      const conversation = await tx.sharedConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true, sourceControlOrgId: true },
      });
      if (!conversation) return;
      if (conversation.sourceControlOrgId !== orgId || conversation.userId !== userId) {
        console.warn("[canvas-strut-fanout] ownership mismatch — bail", {
          conversationId,
          runId: payload.runId,
        });
        return;
      }

      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) return;

      const existingMessages = Array.isArray(locked[0].messages) ? (locked[0].messages as StrutMessageRow[]) : [];
      if (existingMessages.some((m) => m.id === id)) {
        result = "duplicate";
        return;
      }

      const newRow: StrutMessageRow = {
        id,
        role: "assistant",
        content: renderStrutContent(payload),
        timestamp: new Date().toISOString(),
        source: {
          kind: "strut",
          runId: payload.runId,
          title: payload.title,
          workspaceSlug: payload.workspaceSlug,
          chatId: payload.chatId,
          turn: payload.turn,
          event: payload.event,
          status: payload.status,
          settled: payload.settled,
        },
      };

      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [...existingMessages, newRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      result = "appended";
    });

    console.log("[canvas-strut-fanout]", {
      conversationId,
      runId: payload.runId,
      turn: payload.turn,
      event: payload.event,
      settled: payload.settled,
      result,
    });

    if (result === "appended") notifyCanvasConversationUpdated(conversationId, "strut");
    return result;
  } catch (e) {
    console.error("[canvas-strut-fanout] failed:", {
      conversationId,
      runId: payload.runId,
      error: e instanceof Error ? e.message : String(e),
    });
    return "failed";
  }
}
