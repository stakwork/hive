/**
 * Auto-save + live-sync side effect for the canvas chat.
 *
 * Two responsibilities, sharing one source of truth (`persistedIdsRef`,
 * a per-conversation set of message ids already on the server):
 *
 * 1. **Auto-save** — persists message deltas to
 *    `/api/orgs/[githubLogin]/chat/conversations` with
 *    `source: "org-canvas"`. (See "Persistence rules" below.)
 *
 * 2. **Live-sync** — subscribes to the active conversation's Pusher
 *    channel (`canvas-conversation-<id>`) and, on a
 *    `CANVAS_CONVERSATION_UPDATED` nudge, refetches the conversation and
 *    **merges** server-appended rows into the local message list (by id,
 *    never a wholesale replace). This is how a user *sitting on the page*
 *    sees planner messages and the canvas agent's autonomous responses
 *    appear immediately — the server appends them (planner fan-out,
 *    auto-turn, planner-form answer) and broadcasts a nudge.
 *
 * Why these live together: the auto-save tracks which message *ids* are
 * already persisted (`persistedIdsRef`). The live-sync brings in
 * server-appended rows; it marks their ids persisted so the next
 * auto-save doesn't re-PUT them as duplicates. Both operate on message
 * identity, so a mid-turn nudge can never drop a local message: merge
 * only adds, and the delta only sends ids not yet on the server. The
 * merge runs only when the conversation is **idle** (no unsaved local
 * messages, not streaming, no save in flight); a nudge that arrives
 * mid-turn is deferred and retried after the next successful save.
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
  seedPersistedIds,
  computeUnsaved,
  mergeServerMessages,
} from "./canvasChatPersistence";
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
      timeline: m.timeline as CanvasChatMessage["timeline"],
      artifactIds: m.artifactIds as string[] | undefined,
      approval: m.approval as CanvasChatMessage["approval"],
      rejection: m.rejection as CanvasChatMessage["rejection"],
      approvalResult: m.approvalResult as CanvasChatMessage["approvalResult"],
      source: m.source as CanvasChatMessage["source"],
    }));
}

export function useCanvasChatAutoSave({ githubLogin }: AutoSaveArgs) {
  // Track which message *ids* are already persisted (on the server) per
  // conversation. Identity-based — NOT a count. A count plus a seed-skip
  // offset is fragile: any one-off desync (a Pusher nudge interleaving
  // with a PUT, an ephemeral seed miscount) shifts the save window by
  // one and silently drops the lead message — historically the user's
  // first question. Keying by id makes "already saved?" unambiguous and
  // makes message loss structurally impossible: a message is sent iff
  // its id isn't in this set.
  const persistedIdsRef = useRef<Map<string, Set<string>>>(new Map());
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

    // ─── Persisted-id bookkeeping ────────────────────────────────────
    // Lazily initialize the persisted-id set for a conversation. Leading
    // ephemeral seed messages (the AttentionList intro, or the messages
    // a joined/share conversation already has on the server) are seeded
    // in as "already persisted" so they're never POSTed/PUT again. The
    // seeds are always the leading `ephemeralSeedCount` messages, so we
    // snapshot their ids on first touch.
    const getPersistedIds = (
      conversationId: string,
      conv: { messages: CanvasChatMessage[] },
    ): Set<string> => {
      let set = persistedIdsRef.current.get(conversationId);
      if (!set) {
        const seedSkip =
          useCanvasChatStore.getState().ephemeralSeedCounts[conversationId] ??
          0;
        set = seedPersistedIds(conv.messages, seedSkip);
        persistedIdsRef.current.set(conversationId, set);
      }
      return set;
    };

    // The local messages not yet on the server, in order. The lead of
    // this list is always a genuinely-unsaved message — never an
    // already-saved one — so a creating POST always carries the real
    // first user message (never a placeholder-titled assistant lead).
    const unsavedMessages = (
      conversationId: string,
      conv: { messages: CanvasChatMessage[] },
    ): CanvasChatMessage[] => {
      const persisted = getPersistedIds(conversationId, conv);
      return computeUnsaved(conv.messages, persisted);
    };

    // ─── Idle check ──────────────────────────────────────────────────
    // A conversation is safe to merge server rows into only when it has
    // no unsaved local messages, isn't streaming, and has no save in
    // flight.
    const isIdle = (
      conv: { messages: CanvasChatMessage[]; isStreaming: boolean },
      conversationId: string,
    ): boolean => {
      if (conv.isStreaming) return false;
      if (inFlightRef.current.has(conversationId)) return false;
      return unsavedMessages(conversationId, conv).length === 0;
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

        // State may have changed during the await. Re-read and re-check
        // idleness against the *current* conversation.
        const now =
          useCanvasChatStore.getState().conversations[conversationId];
        if (!now || now.serverConversationId !== serverId) return;
        if (!isIdle(now, conversationId)) {
          pendingSyncRef.current.add(conversationId);
          return;
        }

        // Merge by id, never replace. We keep every local message (so
        // ephemeral seeds and any not-yet-saved local rows survive) and
        // append the server messages we don't already have. Server-
        // appended rows (planner fan-out → `source.kind === "planner"`,
        // autonomous canvas-agent turns, planner-form answers) are always
        // the newest, so appending them in server order is chronological.
        // This is what surfaces the `<SubAgentRunCard>` after an approved
        // feature's planner posts its plan back into the conversation.
        const merged = mergeServerMessages(now.messages, mapped);

        // Mark every server id as persisted BEFORE writing messages. The
        // store's `set` fires subscribers synchronously, re-running
        // `flush`; if these weren't already marked, that flush would
        // re-POST the just-synced rows as a bogus delta.
        const persisted = getPersistedIds(conversationId, now);
        for (const id of merged.serverIds) persisted.add(id);

        if (merged.added.length === 0) return; // in sync, nothing to do
        useCanvasChatStore
          .getState()
          .setConversationMessages(conversationId, merged.messages);
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

      if (conv.messages.length === 0) return;

      const delta = unsavedMessages(conversationId, conv);
      if (delta.length === 0) {
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

      // Snapshot the ids we're about to persist so `afterSave` marks
      // exactly what was sent — independent of any messages appended
      // while the request is in flight (those get the next flush).
      const deltaIds = delta.map((m) => m.id);
      inFlightRef.current.add(conversationId);

      const afterSave = (serverId: string) => {
        const persisted = getPersistedIds(conversationId, conv);
        for (const id of deltaIds) persisted.add(id);
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
      // Reset the persisted-id set when a conversation is dropped or its
      // server row is recycled (clear button) — a recycled row will get
      // a fresh server id, so the old persisted ids no longer apply.
      for (const id of Object.keys(prev.conversations)) {
        const before = prev.conversations[id];
        const after = state.conversations[id];
        if (!after) {
          persistedIdsRef.current.delete(id);
          pendingSyncRef.current.delete(id);
          continue;
        }
        if (
          before.serverConversationId !== null &&
          after.serverConversationId === null
        ) {
          persistedIdsRef.current.delete(id);
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
