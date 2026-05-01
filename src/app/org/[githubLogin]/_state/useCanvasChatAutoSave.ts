/**
 * Auto-save side effect for the canvas chat.
 *
 * Subscribes to the active conversation's `messages` and `isLoading`
 * and persists deltas to `/api/workspaces/[slug]/chat/conversations`
 * — the same endpoint `DashboardChat` uses, with `source:
 * "org-canvas"` so we can distinguish forks-from-canvas later.
 *
 * Why a subscription, not inline in the store action: persistence is
 * a side effect, not state. The store stays a pure data layer; the
 * write-through happens here. If the request fails, the store is
 * unaffected; if the user clears the conversation, we drop the
 * server id and the next message creates a fresh row.
 *
 * Mounted once per page (in `OrgCanvasView`). The chat tab body can
 * mount/unmount freely without dropping pending saves.
 *
 * Persistence rules (mirrored from `DashboardChat`):
 *   - First message: POST creates the row, server returns id.
 *   - Subsequent messages: PUT *delta only*. The server reads the
 *     existing JSON, concatenates, writes back. Sending the full
 *     array on each PUT would be O(n²) bandwidth.
 *   - Saves fire-and-forget: failures are logged but never block
 *     the UI. A failed save means the user loses refresh-protection
 *     for the messages between the failure and the next successful
 *     save — acceptable.
 *   - The trigger is "messages added & not currently streaming." We
 *     flush after each turn (user message → server creates/appends,
 *     assistant streams → flush again at end) rather than after
 *     every text-delta.
 */
"use client";

import { useEffect, useRef } from "react";
import { useCanvasChatStore } from "./canvasChatStore";

interface AutoSaveArgs {
  /** The current workspace slug — endpoint scope. */
  workspaceSlug: string | null;
}

export function useCanvasChatAutoSave({ workspaceSlug }: AutoSaveArgs) {
  // Track the last-saved message count per conversation so we know
  // exactly which messages are new to send on PUT.
  const savedCountRef = useRef<Map<string, number>>(new Map());
  // Avoid double-saving while a save is in flight for the same convo.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!workspaceSlug) return;

    const flush = (conversationId: string) => {
      if (inFlightRef.current.has(conversationId)) return;

      const conv =
        useCanvasChatStore.getState().conversations[conversationId];
      if (!conv) return;
      // Only save when not actively streaming. Mid-stream the
      // assistant's messages are still being built; we'd be saving
      // partial state. Wait for the stream to finish (`isLoading`
      // flips back to false after `onResponseStart` and again at
      // stream end via `setIsLoading(false)`).
      if (conv.isLoading) return;

      const totalMsgs = conv.messages.length;
      if (totalMsgs === 0) return;

      // Skip ephemeral seed messages (e.g. the synthetic "top items
      // needing your attention" intro). Once set, we treat the seed
      // as already-saved so the first POST/PUT only carries real
      // user/assistant turns. Without this, every page entry would
      // create a fresh `SharedConversation` row containing the
      // synthetic seed — noisy in the DB and leaks the original
      // viewer's intro through `?chat=<shareId>` shares.
      const seedSkip =
        useCanvasChatStore.getState().ephemeralSeedCounts[conversationId] ?? 0;
      const savedRaw = savedCountRef.current.get(conversationId) ?? 0;
      const saved = Math.max(savedRaw, seedSkip);
      if (totalMsgs <= saved) return;

      const delta = conv.messages.slice(saved);
      inFlightRef.current.add(conversationId);

      // First save → POST (create the server row); subsequent → PUT (append).
      // POST body uses `delta` (not `conv.messages`) so seed-skipped
      // messages never persist — the seed is `[0..seedSkip)` and we
      // start from `saved` which is `max(savedRaw, seedSkip)`.
      if (conv.serverConversationId == null) {
        fetch(`/api/workspaces/${workspaceSlug}/chat/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: delta,
            settings: { extraWorkspaceSlugs: conv.context.workspaceSlugs },
            source: "org-canvas",
          }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.id) {
              useCanvasChatStore
                .getState()
                .setServerConversationId(conversationId, data.id);
              savedCountRef.current.set(conversationId, totalMsgs);
            }
          })
          .catch(() => {})
          .finally(() => inFlightRef.current.delete(conversationId));
      } else {
        const serverId = conv.serverConversationId;
        fetch(
          `/api/workspaces/${workspaceSlug}/chat/conversations/${serverId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: delta,
              settings: { extraWorkspaceSlugs: conv.context.workspaceSlugs },
            }),
          },
        )
          .then(() => {
            savedCountRef.current.set(conversationId, totalMsgs);
          })
          .catch(() => {})
          .finally(() => inFlightRef.current.delete(conversationId));
      }
    };

    // Subscribe imperatively — we want fine-grained reaction to a
    // specific shape of state change, not a re-render.
    const unsub = useCanvasChatStore.subscribe((state, prev) => {
      // When a conversation's serverConversationId is reset to null
      // (clear button) or the conversation is dropped, reset our
      // counter so the next message creates a fresh row.
      for (const id of Object.keys(prev.conversations)) {
        const before = prev.conversations[id];
        const after = state.conversations[id];
        if (!after) {
          savedCountRef.current.delete(id);
          continue;
        }
        // Auto-save row recycled → reset our counter.
        if (
          before.serverConversationId !== null &&
          after.serverConversationId === null
        ) {
          savedCountRef.current.delete(id);
        }
      }

      // Try to flush the active conversation. If nothing changed
      // that warrants a save (no new messages, or still streaming),
      // `flush` is a noop.
      const activeId = state.activeConversationId;
      if (activeId) flush(activeId);
    });

    return () => unsub();
  }, [workspaceSlug]);
}
