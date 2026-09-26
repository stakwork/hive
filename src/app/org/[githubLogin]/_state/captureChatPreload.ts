import type { CanvasChatMessage } from "./canvasChatStore";
import type { CanvasActiveStream } from "@/types/shared-conversation";

export interface ChatPreload {
  messages: CanvasChatMessage[] | null;
  title: string | null;
  activeStream: CanvasActiveStream | null;
}

/**
 * Pull messages, title, and the in-flight stream pointer off a
 * conversation GET body. `activeStream` is owner-only and optional —
 * a missing or malformed pointer means "load history as today".
 */
export function captureChatPreload(data: {
  messages?: unknown;
  title?: unknown;
  activeStream?: unknown;
} | null): ChatPreload {
  if (!data) return { messages: null, title: null, activeStream: null };

  const messages = Array.isArray(data.messages)
    ? (data.messages as CanvasChatMessage[]).map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp as unknown as string),
      }))
    : null;
  const title = typeof data.title === "string" ? data.title : null;
  const pointer = data.activeStream as
    | { streamId?: unknown; turnId?: unknown }
    | null
    | undefined;
  const activeStream =
    pointer &&
    typeof pointer.streamId === "string" &&
    pointer.streamId.length > 0 &&
    typeof pointer.turnId === "string" &&
    pointer.turnId.length > 0
      ? { streamId: pointer.streamId, turnId: pointer.turnId }
      : null;

  return { messages, title, activeStream };
}
