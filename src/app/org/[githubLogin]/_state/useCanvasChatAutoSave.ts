/**
 * Auto-save + live-sync side effect for the canvas chat.
 *
 * Two responsibilities, sharing one source of truth (`savedCountRef`):
 *
 * 1. **Auto-save** — persists message deltas to
 *    `/api/orgs/[githubLogin]/chat/conversations` with
 *    `source: "org-canvas"`. (See "Persistence rules" below.)
 *
 * 2. **Live-sync** — subscribes to the active conversation's Pusher
 *    channel (`canvas-conversation-<id>`) and, on a
 *    `CANVAS_CONVERSATION_UPDATED` nudge, refetches the conversation and
 *    replaces the local message list with the server's authoritative
 *    copy. This is how a user *sitting on the page* sees planner
 *    messages and the canvas agent's autonomous responses appear
 *    immediately — the server appends them (planner fan-out, auto-turn,
 *    planner-form answer) and broadcasts a nudge.
 *
 * Why these live together: the auto-save tracks "how many messages are
 * already persisted" as a count (`savedCountRef`). The live-sync brings
 * in server-appended rows; if it didn't coordinate that count, the next
 * auto-save would re-PUT those rows as duplicates. By replacing the
 * local list with the server copy and setting `savedCount = length`, the
 * two stay consistent. The replace only runs when the conversation is
 * **idle** (no unsaved local messages, not streaming, no save in
 * flight) — so the server copy is always a strict superset and nothing
 * local is dropped. A nudge that arrives mid-turn is deferred and
 * retried after the next successful save.
 *
 * Persistence rules (mirrored from `DashboardChat`):
 *   - First message: POST creates the row, server returns id.
 *   - Subsequent messages: PUT *delta only*.
 *   - Saves fire-and-forget: failures are logged but never block the UI.
 *   - Trigger: "messages added & not currently streaming."
 *
 * Mounted once per page (in `OrgCanvasView`).
 */
"use client";

import { useEffect, useRef } from "react";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "./canvasChatStore";
import {
  getPusherClient,
  getCanvasConversationChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import type { Channel } from "pusher-js";

interface AutoSaveArgs {
  /** The GitHub login (org slug) — endpoint scope. */
  githubLogin: string | null;
}

/**
 * Map raw `SharedConversation.messages` JSON into store-shaped
 * `CanvasChatMessage[]` (timestamps → `Date`). Mirrors the hydration in
 * `CanvasHistoryPopover.handleItemClick`.
 */
function hydrateServerMessages(raw: unknown[]): CanvasChatMessage[] {
  return raw
    .filter(
      (m): m is Record<string, unknown> =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: string }).role === "user" ||
          (m as { role?: string }).role === "assistant"),
    )
    .map((m, idx) => ({
      id: (m.id as string) || `synced-${idx}`,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
      toolCalls: m.toolCalls as CanvasChatMessage["toolCalls"],
      artifactIds: m.artifactIds as string[] | undefined,
      approval: m.approval as CanvasChatMessage["approval"],
      rejection: m.rejection as CanvasChatMessage["rejection"],
      approvalResult: m.approvalResult as CanvasChatMessage["approvalResult"],
      source: m.source as CanvasChatMessage["source"],
    }));
}

export function useCanvasChatAutoSave({ githubLogin }: AutoSaveArgs) {
  // Track the last-saved message count per conversation so we know
  // exactly which messages are new to send on PUT.
  const savedCountRef = useRef<Map<string, number>>(new Map());
  // Avoid double-saving while a save is in flight for the same convo.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Conversations that got a live-sync nudge while busy — synced after
  // the next successful save.
  const pendingSyncRef = useRef<Set<string>>(new Set());
  // Conversations with a sync fetch in flight (avoid overlap).
  const syncInFlightRef = useRef<Set<string>>(new Set());
  // The Pusher channel we're currently subscribed to (active convo).
  const subRef = useRef<{ serverId: string | null; channel: Channel | null }>({
    serverId: null,
    channel: null,
  });

  useEffect(() => {
    if (!githubLogin) return;

    // ─── Idle check ──────────────────────────────────────────────────
    // A conversation is safe to replace from the server only when it has
    // no unsaved local messages, isn't streaming, and has no save in
    // flight.
    const isIdle = (
      conv: { messages: unknown[]; isStreaming: boolean },
      conversationId: string,
    ): boolean => {
      if (conv.isStreaming) return false;
      if (inFlightRef.current.has(conversationId)) return false;
      const seedSkip =
        useCanvasChatStore.getState().ephemeralSeedCounts[conversationId] ?? 0;
      const saved = Math.max(
        savedCountRef.current.get(conversationId) ?? 0,
        seedSkip,
      );
      return conv.messages.length <= saved;
    };

    // ─── Live-sync ───────────────────────────────────────────────────
    const syncFromServer = async (
      conversationId: string,
      serverId: string,
    ): Promise<void> => {
      if (syncInFlightRef.current.has(conversationId)) {
        pendingSyncRef.current.add(conversationId);
        return;
      }
      const conv =
        useCanvasChatStore.getState().conversations[conversationId];
      if (!conv || conv.serverConversationId !== serverId) return;
      if (!isIdle(conv, conversationId)) {
        // Busy (user mid-turn) — defer; the flush `.then` re-triggers.
        pendingSyncRef.current.add(conversationId);
        return;
      }

      const lenBefore = conv.messages.length;
      syncInFlightRef.current.add(conversationId);
      pendingSyncRef.current.delete(conversationId);
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/chat/conversations/${serverId}`,
        );
        if (!res.ok) return;
        const body = await res.json();
        const mapped = hydrateServerMessages(
          Array.isArray(body.messages) ? body.messages : [],
        );

        // State may have changed during the await. Only replace if still
        // idle, still the same conversation, and the local list didn't
        // grow (user didn't just type). Otherwise re-defer.
        const now =
          useCanvasChatStore.getState().conversations[conversationId];
        if (!now || now.serverConversationId !== serverId) return;
        if (
          !isIdle(now, conversationId) ||
          now.messages.length !== lenBefore ||
          mapped.length < now.messages.length // safety: never shrink
        ) {
          pendingSyncRef.current.add(conversationId);
          return;
        }

        // Bump the saved counter BEFORE replacing the messages. The
        // store's `set` fires subscribers synchronously, which re-runs
        // `flush`; if `savedCount` weren't already `mapped.length`, that
        // flush would re-PUT the just-synced rows as a bogus delta.
        savedCountRef.current.set(conversationId, mapped.length);
        useCanvasChatStore
          .getState()
          .setConversationMessages(conversationId, mapped);
      } catch {
        // Network hiccup — a later nudge (or the next planner message)
        // will resync.
      } finally {
        syncInFlightRef.current.delete(conversationId);
        // A nudge that landed during the fetch → run once more.
        if (pendingSyncRef.current.has(conversationId)) {
          const c =
            useCanvasChatStore.getState().conversations[conversationId];
          if (c?.serverConversationId) {
            const sid = c.serverConversationId;
            void Promise.resolve().then(() =>
              syncFromServer(conversationId, sid),
            );
          }
        }
      }
    };

    // ─── Auto-save flush ─────────────────────────────────────────────
    const flush = (conversationId: string) => {
      if (inFlightRef.current.has(conversationId)) return;

      const conv =
        useCanvasChatStore.getState().conversations[conversationId];
      if (!conv) return;
      // Only save once the stream has fully settled (see store comment).
      if (conv.isStreaming) return;

      const totalMsgs = conv.messages.length;
      if (totalMsgs === 0) return;

      const seedSkip =
        useCanvasChatStore.getState().ephemeralSeedCounts[conversationId] ?? 0;
      const savedRaw = savedCountRef.current.get(conversationId) ?? 0;
      const saved = Math.max(savedRaw, seedSkip);
      if (totalMsgs <= saved) {
        // Nothing to save. If a sync was deferred (e.g. we just settled
        // from a stream), run it now.
        if (
          pendingSyncRef.current.has(conversationId) &&
          conv.serverConversationId
        ) {
          syncFromServer(conversationId, conv.serverConversationId);
        }
        return;
      }

      const delta = conv.messages.slice(saved);
      inFlightRef.current.add(conversationId);

      const afterSave = (serverId: string) => {
        savedCountRef.current.set(conversationId, totalMsgs);
        // A live-sync nudge that arrived while we were busy can run now.
        if (pendingSyncRef.current.has(conversationId)) {
          syncFromServer(conversationId, serverId);
        }
      };

      if (conv.serverConversationId == null) {
        fetch(`/api/orgs/${githubLogin}/chat/conversations`, {
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
              afterSave(data.id);
            }
          })
          .catch(() => {})
          .finally(() => inFlightRef.current.delete(conversationId));
      } else {
        const serverId = conv.serverConversationId;
        fetch(`/api/orgs/${githubLogin}/chat/conversations/${serverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: delta,
            settings: { extraWorkspaceSlugs: conv.context.workspaceSlugs },
          }),
        })
          .then(() => afterSave(serverId))
          .catch(() => {})
          .finally(() => inFlightRef.current.delete(conversationId));
      }
    };

    // ─── Pusher subscription management ───────────────────────────────
    // Subscribe to the active conversation's channel; resubscribe when
    // the active conversation (or its server id) changes. Wrapped in
    // try/catch so a missing Pusher config disables live-sync without
    // breaking auto-save.
    const syncActiveSubscription = (activeServerId: string | null) => {
      if (activeServerId === subRef.current.serverId) return;
      // Tear down the old subscription.
      if (subRef.current.channel && subRef.current.serverId) {
        try {
          subRef.current.channel.unbind_all();
          getPusherClient().unsubscribe(
            getCanvasConversationChannelName(subRef.current.serverId),
          );
        } catch {
          /* ignore */
        }
      }
      subRef.current = { serverId: activeServerId, channel: null };
      if (!activeServerId) return;
      try {
        const channelName = getCanvasConversationChannelName(activeServerId);
        const channel = getPusherClient().subscribe(channelName);
        channel.bind(PUSHER_EVENTS.CANVAS_CONVERSATION_UPDATED, () => {
          // Resolve the local conversation for this server id at call
          // time (the active conversation may have changed).
          const s = useCanvasChatStore.getState();
          const cid = Object.keys(s.conversations).find(
            (k) =>
              s.conversations[k].serverConversationId === activeServerId,
          );
          if (cid) void syncFromServer(cid, activeServerId);
        });
        subRef.current = { serverId: activeServerId, channel };
      } catch {
        // Pusher unavailable — live-sync disabled; auto-save still works.
      }
    };

    // Imperative subscription — fine-grained reaction without re-render.
    const unsub = useCanvasChatStore.subscribe((state, prev) => {
      // Reset the saved counter when a conversation is dropped or its
      // server row is recycled (clear button).
      for (const id of Object.keys(prev.conversations)) {
        const before = prev.conversations[id];
        const after = state.conversations[id];
        if (!after) {
          savedCountRef.current.delete(id);
          pendingSyncRef.current.delete(id);
          continue;
        }
        if (
          before.serverConversationId !== null &&
          after.serverConversationId === null
        ) {
          savedCountRef.current.delete(id);
        }
      }

      const activeId = state.activeConversationId;
      if (activeId) flush(activeId);

      // Keep the live-sync subscription pointed at the active convo.
      const activeServerId = activeId
        ? state.conversations[activeId]?.serverConversationId ?? null
        : null;
      syncActiveSubscription(activeServerId);
    });

    return () => {
      unsub();
      // Tear down any live Pusher subscription on unmount.
      if (subRef.current.channel && subRef.current.serverId) {
        try {
          subRef.current.channel.unbind_all();
          getPusherClient().unsubscribe(
            getCanvasConversationChannelName(subRef.current.serverId),
          );
        } catch {
          /* ignore */
        }
      }
      subRef.current = { serverId: null, channel: null };
    };
  }, [githubLogin]);
}
