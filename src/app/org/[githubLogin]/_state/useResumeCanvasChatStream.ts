/**
 * Reattach an org-canvas chat to an in-flight Jamie turn after refresh.
 *
 * Mounted next to the `?chat=` seed in `OrgCanvasView`. The relay URL uses
 * the `?chat=` id (`serverConversationId`), never the Zustand slot id —
 * the slot id is local and the Redis pointer is keyed by the row id.
 *
 * `markTurnAuthored` runs only after the relay actually returns an SSE
 * body. A 204 / error must still accept `${turnId}-a*` from persist +
 * Pusher, and there is no `unmarkTurnAuthored`.
 */
"use client";

import { useEffect, useRef } from "react";
import { useStreamProcessor } from "@/lib/streaming";
import type { CanvasActiveStream } from "@/types/shared-conversation";
import { useCanvasChatStore, type CanvasChatMessage } from "./canvasChatStore";
import { applyCanvasAssistantStream } from "./applyCanvasAssistantStream";

interface ResumeArgs {
  /** Zustand slot id returned by `startConversation`. */
  conversationId: string | null;
  /** `?chat=` row id. Relay + pointer are keyed by this, never the slot. */
  serverConversationId: string | null;
  githubLogin: string;
  /** From conversation GET. Null when there is nothing to reattach to. */
  activeStream: CanvasActiveStream | null;
  /** Seeded messages from the same GET, used to detect a stale pointer. */
  seededMessages: CanvasChatMessage[] | null;
  /** True once `startConversation` has copied the seed into the store. */
  enabled: boolean;
}

function hasPersistedAssistantRows(
  messages: CanvasChatMessage[] | null,
  turnId: string,
): boolean {
  if (!messages) return false;
  const prefix = `${turnId}-a`;
  return messages.some((m) => m.id.startsWith(prefix));
}

export function useResumeCanvasChatStream({
  conversationId,
  serverConversationId,
  githubLogin,
  activeStream,
  seededMessages,
  enabled,
}: ResumeArgs) {
  const { processStream } = useStreamProcessor();
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !conversationId || !serverConversationId || !activeStream) {
      return;
    }
    const { streamId, turnId } = activeStream;
    if (!streamId || !turnId) return;

    const resumeKey = `${serverConversationId}:${streamId}`;
    if (startedRef.current === resumeKey) return;

    const conv = useCanvasChatStore.getState().conversations[conversationId];
    if (!conv || conv.isStreaming) return;
    // Stale pointer after persist: the completed assistant rows are
    // already in the seed. Don't replay over them.
    if (hasPersistedAssistantRows(seededMessages, turnId)) return;

    startedRef.current = resumeKey;
    const ac = new AbortController();
    let bumped = false;

    const {
      setIsLoading,
      setIsStreaming,
      bumpAgentTurns,
      markTurnAuthored,
      setActiveToolCalls,
      setRunActive,
      replaceAssistantStream,
    } = useCanvasChatStore.getState();

    // Lock the composer BEFORE the relay GET. A second send would
    // overwrite `canvas:active-stream:{rowId}` while the first `after()`
    // persist can later delete the new pointer. Live-sync is idle while
    // `isStreaming` is true, so it will not merge persist rows during replay.
    setIsLoading(conversationId, true);
    setIsStreaming(conversationId, true);
    bumpAgentTurns(conversationId, 1);
    bumped = true;

    const release = () => {
      if (!bumped) return;
      bumped = false;
      setIsLoading(conversationId, false);
      setIsStreaming(conversationId, false);
      bumpAgentTurns(conversationId, -1);
      setRunActive(conversationId, false);
    };

    const run = async () => {
      try {
        const response = await fetch(
          `/api/orgs/${githubLogin}/chat/conversations/${serverConversationId}/stream`,
          { signal: ac.signal },
        );

        // 204 / error: do NOT markTurnAuthored. Fall back to today's load
        // (user row already in the seed; wait for persist + Pusher).
        if (!response.ok || response.status === 204 || !response.body) {
          release();
          return;
        }

        markTurnAuthored(turnId);

        // Fresh live prefix, same shape as send. Never pass `turnId` —
        // `replaceAssistantStream` strips ids with this prefix, which
        // would delete the persisted `${turnId}-u` user row during replay.
        const messageId = (Date.now() + 1).toString();
        let firstChunk = true;

        await processStream(response, messageId, (updatedMessage) => {
          if (firstChunk) {
            firstChunk = false;
            setIsLoading(conversationId, false);
          }
          applyCanvasAssistantStream({
            conversationId,
            messageId,
            updatedMessage,
            setRunActive,
            setActiveToolCalls,
            replaceAssistantStream,
          });
        });

        setActiveToolCalls(conversationId, []);
        setRunActive(conversationId, false);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error("[canvas-chat] resume stream failed:", err);
      } finally {
        if (!ac.signal.aborted) release();
      }
    };

    void run();

    return () => {
      ac.abort();
      release();
    };
  }, [
    enabled,
    conversationId,
    serverConversationId,
    githubLogin,
    activeStream,
    seededMessages,
    processStream,
  ]);
}
