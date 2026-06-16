/**
 * Shared server-side persistence for canvas-chat agent turns.
 *
 * Extracted from `canvas-agent-autoturn.ts` so BOTH the autonomous
 * planner-woken turn AND the user-driven `/api/ask/quick` turn write
 * through one code path. The contract is identical for both:
 *
 *   - Reconstruct `CanvasChatMessage`-shaped rows from a finished
 *     `streamText` run's `steps` (`messagesFromSteps`).
 *   - Append them to `SharedConversation.messages` under a
 *     `SELECT … FOR UPDATE` row lock so the write serializes against the
 *     other writers on that row (the planner fan-out, the conversations
 *     PUT route), and is idempotent on a caller-chosen id prefix so a
 *     retried `after()` / re-delivered webhook never double-appends.
 *   - Fire a `CANVAS_CONVERSATION_UPDATED` Pusher nudge on a fresh
 *     append so open browsers live-sync the new rows in.
 *
 * The id prefix is the dedup key. Callers pick a prefix unique to the
 * turn: the user-driven path uses `${turnId}-a` (assistant rows) and
 * `${turnId}-u` (the user row); the auto-turn path uses
 * `autoturn-${plannerMessageId}-`. The org-canvas client filters server
 * rows by `${turnId}-` prefix in its live-sync merge so the authoring
 * tab never double-renders its own optimistic stream.
 */

import { db } from "@/lib/db";
import {
  notifyCanvasConversationUpdated,
  type CanvasConversationUpdateReason,
} from "@/lib/pusher";

// ───────────────────────────────────────────────────────────────────
// Stored-message types (the `CanvasChatMessage` JSON shape inside
// `SharedConversation.messages`). Kept loose — the column is `Json`
// and the canonical render-side type lives in `canvasChatStore.ts`.
// ───────────────────────────────────────────────────────────────────

export interface StoredToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status?: string;
  output?: unknown;
  errorText?: string;
}

/**
 * A user-uploaded file attached to a message (image/doc). Mirrors the
 * render-side `CanvasAttachment` shape (`canvasChatStore.ts`): `path` is the
 * S3 key the client turns into a presigned download URL. Persisted in the
 * `SharedConversation.messages` JSON so attachments survive reload.
 */
export interface StoredAttachment {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  toolCalls?: StoredToolCall[];
  attachments?: StoredAttachment[];
  source?: { kind: string; featureId?: string; plannerMessageId?: string };
  // Approval-flow metadata round-tripping through the JSON. Untyped here
  // (the canonical types live in `src/lib/proposals/types.ts`); the
  // render-side store re-narrows them.
  approval?: unknown;
  rejection?: unknown;
  approvalResult?: unknown;
  /**
   * Populated when this assistant message confirmed a `schedule_check`
   * tool call. Mirrors `CanvasChatMessage.deferredCheck` in the store.
   */
  deferredCheck?: {
    id: string;
    description: string;
    fireAt: string;
    status: "PENDING" | "FIRED" | "CANCELLED" | "FAILED";
  };
}

type StepLike = {
  text?: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown }>;
  toolResults?: Array<{ toolCallId: string; output?: unknown; result?: unknown }>;
};

const NO_STRIP: ReadonlySet<string> = new Set();

/**
 * Reconstruct the agent's output as `CanvasChatMessage`-shaped rows from
 * the finished stream's `steps`. Mirrors the client-side timeline split
 * in `useSendCanvasChatMessage.ts`: text becomes a text message, tool
 * calls become a tool-call message (so `SubAgentRunCard` can extract
 * `send_to_feature_planner` calls as outbound thread entries).
 *
 * Row ids are `${idPrefix}${n}` (n = 0,1,2,…), so `idPrefix` doubles as
 * the idempotency key for `appendTurnMessages`.
 *
 * `stripToolNames` removes control-signal tool calls that aren't real
 * transcript entries (the auto-turn's `stay_silent`). A turn that did
 * nothing but a stripped tool produces an empty array, and the caller
 * appends nothing.
 */
export function messagesFromSteps(
  steps: StepLike[],
  idPrefix: string,
  stripToolNames: ReadonlySet<string> = NO_STRIP,
): StoredMessage[] {
  const rows: StoredMessage[] = [];
  let idx = 0;
  const nextId = () => `${idPrefix}${idx++}`;
  const now = new Date().toISOString();

  for (const step of steps) {
    // Extract any schedule_check result from this step so it can be
    // attached to the text row as `deferredCheck` metadata.
    const deferredCheck = extractDeferredCheckFromStep(step);

    if (step.text && step.text.trim()) {
      const textRow: StoredMessage = {
        id: nextId(),
        role: "assistant",
        content: step.text,
        timestamp: now,
      };
      if (deferredCheck) {
        textRow.deferredCheck = deferredCheck;
      }
      rows.push(textRow);
    }

    const calls = step.toolCalls ?? [];
    if (calls.length === 0) continue;

    const resultByCallId = new Map(
      (step.toolResults ?? []).map((r) => [r.toolCallId, r] as const),
    );

    const toolCalls: StoredToolCall[] = calls
      .filter((tc) => !stripToolNames.has(tc.toolName))
      .map((tc) => {
        const r = resultByCallId.get(tc.toolCallId);
        const output = r ? (r.output ?? r.result) : undefined;
        const isError =
          !!output &&
          typeof output === "object" &&
          "error" in (output as Record<string, unknown>);
        return {
          id: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
          output,
          status:
            output === undefined
              ? "input-available"
              : isError
                ? "output-error"
                : "output-available",
          ...(isError ? { errorText: "Tool call failed" } : {}),
        };
      });

    if (toolCalls.length > 0) {
      const toolRow: StoredMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        timestamp: now,
        toolCalls,
      };
      // If there was no text in this step, attach deferredCheck to the
      // tool-call row instead so the card is always anchored somewhere.
      if (deferredCheck && rows[rows.length - 1]?.deferredCheck == null) {
        toolRow.deferredCheck = deferredCheck;
      }
      rows.push(toolRow);
    }
  }

  return rows;
}

/**
 * Scan a single step for a completed `schedule_check` tool result and
 * return the parsed `deferredCheck` metadata, or `undefined` if none.
 */
function extractDeferredCheckFromStep(
  step: StepLike,
): StoredMessage["deferredCheck"] | undefined {
  const calls = step.toolCalls ?? [];
  const results = step.toolResults ?? [];

  const scheduleCall = calls.find((tc) => tc.toolName === "schedule_check");
  if (!scheduleCall) return undefined;

  const result = results.find((r) => r.toolCallId === scheduleCall.toolCallId);
  if (!result) return undefined;

  const output = (result.output ?? result.result) as Record<string, unknown> | undefined;
  if (
    !output ||
    typeof output !== "object" ||
    typeof output.deferredActionId !== "string" ||
    typeof output.fireAt !== "string" ||
    typeof output.description !== "string"
  ) {
    return undefined;
  }

  return {
    id: output.deferredActionId,
    description: output.description,
    fireAt: output.fireAt,
    status: "PENDING",
  };
}

/**
 * Append rows into a canvas conversation under the same row-level lock
 * the fan-out worker and the autosave PUT use, so all writers serialize
 * on the conversation row. Idempotent on the `idPrefix`: if any existing
 * row id already starts with it, this is a no-op (a retried `after()`,
 * a re-delivered webhook). Returns whether THIS call appended.
 *
 * Fires a `CANVAS_CONVERSATION_UPDATED` nudge only on a fresh append, so
 * open browsers live-sync the new rows in. Never throws on the Pusher
 * side (the helper swallows that); the DB write is the contract.
 */
export async function appendTurnMessages(args: {
  conversationId: string;
  rows: StoredMessage[];
  idPrefix: string;
  reason: CanvasConversationUpdateReason;
}): Promise<boolean> {
  const { conversationId, rows, idPrefix, reason } = args;
  if (rows.length === 0) return false;

  let didAppend = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted mid-turn

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];

    const alreadyAppended = existing.some(
      (m) => typeof m.id === "string" && m.id.startsWith(idPrefix),
    );
    if (alreadyAppended) return;

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...existing, ...rows] as unknown as never,
        lastMessageAt: new Date(),
      },
    });
    didAppend = true;
  });

  if (didAppend) notifyCanvasConversationUpdated(conversationId, reason);
  return didAppend;
}
