/**
 * Shared helpers for SharedConversation rows used by both
 * workspace-scoped and org-scoped conversation API routes.
 */

import type { ModelMessage } from "ai";
import { truncateField } from "@/lib/ai/mcpResult";
import { PROPOSE_CODE_CHANGE_TOOL } from "@/lib/proposals/types";
import { buildUserContent, type AttachmentLike } from "@/lib/ai/attachmentParts";

/** Max chars of a proposed diff replayed back into model context. */
const REPLAY_DIFF_CHAR_CAP = 4_000;

/**
 * Shrink a stored tool output before it is replayed into model context.
 *
 * `propose_code_change` stores the full approved diff on `payload.diff` —
 * up to the 200 KB `diffHygiene` cap. Those exact bytes have to survive in
 * the stored row (the approval handler re-hashes them against
 * `diffSha256`), but re-feeding them to the model on every subsequent turn
 * of the conversation is pure context burn. Truncate on the way out; the
 * stored message is never mutated.
 */
function shrinkToolOutputForReplay(toolName: string, output: unknown): unknown {
  if (toolName !== PROPOSE_CODE_CHANGE_TOOL) return output;
  if (!output || typeof output !== "object") return output;
  const payload = (output as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return output;
  const diff = (payload as { diff?: unknown }).diff;
  if (typeof diff !== "string" || diff.length <= REPLAY_DIFF_CHAR_CAP) {
    return output;
  }
  return {
    ...(output as Record<string, unknown>),
    payload: {
      ...(payload as Record<string, unknown>),
      diff: truncateField(diff, REPLAY_DIFF_CHAR_CAP),
    },
  };
}

/** The stored text of the row that ends a stopped turn (`source.kind: "stopped"`). */
export const STOPPED_TURN_TEXT = "Stopped by user.";

/** Replayed in place of a stopped turn's "Stopped" row, as the user's words. */
export const STOPPED_TURN_NOTICE = "(The user stopped your previous reply at this point.)";

/** The replayed result of a tool call that never produced one (a Stop cut it off). */
export const INTERRUPTED_TOOL_RESULT =
  "Interrupted: the user stopped the turn while this tool was running. It may or may not have taken effect.";

/** What `toModelMessages` reads — a stored row and the client's `CanvasChatMessage` both fit. */
export interface ReplayMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ id: string; toolName: string; input?: unknown; output?: unknown; errorText?: string }>;
  attachments?: AttachmentLike[];
  source?: { kind: string };
}

/**
 * Converts stored canvas/conversation messages into AI SDK `ModelMessage[]`.
 * Used for server-side history and for the history the org-canvas chat
 * sends with each turn. Filters out empty messages, ships user attachments
 * as content parts (see `attachmentParts.ts`), expands assistant tool-call
 * turns into the three-part shape the AI SDK expects (tool-call,
 * tool-result, text), and shrinks oversized tool outputs on the way out
 * (see `shrinkToolOutputForReplay`) — the stored rows are left untouched.
 *
 * Every tool call is replayed with a result — a provider rejects a call
 * without one — so a call that has no output (an interrupted or failed
 * one) gets an error-text result. A stopped turn's "Stopped" row becomes
 * `STOPPED_TURN_NOTICE` from the user, so the model is told it was cut
 * off and never sees (or learns to write) the marker itself.
 */
export function toModelMessages(messages: ReplayMessage[]): ModelMessage[] {
  return messages
    .filter((m) => (m.content?.trim() || m.toolCalls || m.attachments?.length) && m.role)
    .flatMap((m): ModelMessage[] => {
      if (m.source?.kind === "stopped") {
        return [{ role: "user", content: STOPPED_TURN_NOTICE }];
      }
      if (m.role === "user" && m.attachments?.length) {
        return [
          {
            role: "user",
            content: buildUserContent(m.content ?? "", m.attachments),
          } as ModelMessage,
        ];
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const out: ModelMessage[] = [];
        out.push({
          role: "assistant",
          content: m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.toolName,
            input: tc.input || {},
          })),
        });
        out.push({
          role: "tool",
          content: m.toolCalls.map((tc) => {
            const shrunk = shrinkToolOutputForReplay(tc.toolName, tc.output);
            let wrappedOutput = shrunk;
            if (shrunk === undefined) {
              wrappedOutput = { type: "error-text", value: tc.errorText ?? INTERRUPTED_TOOL_RESULT };
            } else if (
              shrunk &&
              typeof shrunk === "object" &&
              !("type" in shrunk)
            ) {
              wrappedOutput = { type: "json", value: shrunk };
            }
            return {
              type: "tool-result" as const,
              toolCallId: tc.id,
              toolName: tc.toolName,
              output: wrappedOutput as never,
            };
          }),
        } as ModelMessage);
        if (m.content) {
          out.push({ role: "assistant", content: m.content });
        }
        return out;
      }
      return [{ role: m.role, content: m.content }];
    });
}

/** Placeholder title for a conversation with no usable first user message. */
export const UNTITLED_CONVERSATION = "Untitled Conversation";

/**
 * Upper bound for stored titles. This is a storage guard, not a display
 * concern — UIs truncate titles visually (CSS `truncate`) so the title is
 * stored whole (no trailing ellipsis) up to this generous single-line cap.
 */
export const TITLE_MAX_LENGTH = 200;

/**
 * Generate a title from the first user message.
 *
 * The full message text is used (whitespace collapsed to a single line) up to
 * {@link TITLE_MAX_LENGTH} characters, with no trailing ellipsis. Display
 * surfaces are responsible for visually truncating long titles.
 */
export function generateTitle(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return UNTITLED_CONVERSATION;
  }

  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) return UNTITLED_CONVERSATION;

  let text = "";
  const m = firstUserMessage as any;
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    const textPart = m.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return UNTITLED_CONVERSATION;
  return normalized.slice(0, TITLE_MAX_LENGTH);
}

/** Return a short preview string from the first user message. */
export function getMessagePreview(messages: unknown[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) return null;

  let text = "";
  const m = firstUserMessage as any;
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    const textPart = m.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  return text.trim() || null;
}

/** Extract a Date from the last message's `createdAt`, falling back to now. */
export function getLastMessageTimestamp(messages: unknown[]): Date {
  if (!Array.isArray(messages) || messages.length === 0) return new Date();
  const lastMessage = messages[messages.length - 1] as any;
  if (lastMessage?.createdAt) return new Date(lastMessage.createdAt);
  return new Date();
}
