/**
 * Live-sync side effect for the canvas chat.
 *
 * **Backend-driven turns** (docs/plans/backend-driven-canvas-turns.md):
 * the SERVER is the single writer for org-canvas conversations. It
 * persists the user message synchronously and the assistant turn in
 * `after()` (both in `/api/ask/quick`), planner fan-out / auto-turn /
 * planner-form answers write their own rows, and every server-side
 * append fires a `CANVAS_CONVERSATION_UPDATED` Pusher nudge. This hook no
 * longer POSTs/PUTs anything — it ONLY live-syncs: on a nudge it refetches
 * the conversation and **merges** server-appended rows into the local
 * list (by id, never a wholesale replace).
 *
 * The merge filters out rows for turns THIS tab authored
 * (`locallyAuthoredTurnIds`, by `${turnId}-` prefix): the tab that sent a
 * turn is already showing its own optimistic stream for it, so re-merging
 * the server's copy would double-render. Other tabs / a reopened tab
 * authored nothing, so they merge everything — which is how a user who
 * closed the tab mid-turn sees the completed turn when they return, and
 * how a second viewer of a shared room sees turns appear live.
 *
 * The merge runs only when the conversation is **idle** (not streaming);
 * a nudge that arrives mid-stream is deferred and retried when the stream
 * settles. Merging is identity-based (append-only), so a mid-turn nudge
 * can never drop a local message.
 *
 * **Catch-up — Pusher has no replay.** Live nudges only cover the window
 * we're actively subscribed AND the socket is up. To stay correct across
 * the gaps we refetch-and-merge the active conversation: (a) immediately
 * on every (re)subscribe, (b) once at mount seeded from current store
 * state (a remount where the module-level store still holds the active
 * convo never triggers the change-driven `subscribe` callback), (c) on
 * `visibilitychange` → visible (backgrounded tabs suspend their socket),
 * and (d) on Pusher `connected` (reconnect after a network blip). Without
 * these, planner / sub-agent rows that fan out while you're away on
 * another tab/chat stay invisible until the *next* live nudge happens to
 * land — the "I rejoined the canvas chat and the sub-agent messages were
 * missing until I left and came back" bug. Every catch-up routes through
 * the same idempotent merge, so it can neither double-render nor drop.
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
  mergeServerMessages,
  reconcilePlannerSources,
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
      attachments: m.attachments as CanvasChatMessage["attachments"],
      approval: m.approval as CanvasChatMessage["approval"],
      rejection: m.rejection as CanvasChatMessage["rejection"],
      approvalResult: m.approvalResult as CanvasChatMessage["approvalResult"],
      deferredCheck: m.deferredCheck as CanvasChatMessage["deferredCheck"],
      source: m.source as CanvasChatMessage["source"],
    }));
}

export function useCanvasChatAutoSave({ githubLogin }: AutoSaveArgs) {
  // Conversations that got a live-sync nudge while busy (streaming) —
  // synced after the stream settles.
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
    // Safe to merge server rows only when the conversation isn't
    // mid-stream (so we never clobber the optimistic stream the user is
    // watching). With server-side persistence there's no client save in
    // flight to coordinate with — streaming is the only busy state.
    const isIdle = (conv: { isStreaming: boolean }): boolean =>
      !conv.isStreaming;

    // Clear a conversation's unread flag server-side. Called for the chat
    // the user is actively viewing (the active conversation): when its own
    // turn settles, and when a live-sync lands new server rows into it —
    // so watching a planner/sub-agent fan out keeps it "seen". A
    // backgrounded chat is never marked here, so it stays unread until the
    // user opens it. Fire-and-forget; owner-only on the server.
    const markSeen = (serverId: string): void => {
      void fetch(
        `/api/orgs/${githubLogin}/chat/conversations/${serverId}/seen`,
        { method: "POST" },
      ).catch(() => {});
    };

    // Prefixes for turns this tab authored — their server rows are
    // filtered out of the merge (we already show them optimistically).
    const authoredPrefixes = (): string[] =>
      Array.from(useCanvasChatStore.getState().locallyAuthoredTurnIds).map(
        (t) => `${t}-`,
      );

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
      if (!isIdle(conv)) {
        // Busy (user mid-turn) — defer; the settle handler re-triggers.
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
        if (!isIdle(now)) {
          pendingSyncRef.current.add(conversationId);
          return;
        }

        // Merge by id, never replace. Keep every local message (the
        // optimistic stream for turns this tab authored, ephemeral seeds,
        // anything not yet on the server) and append server rows we don't
        // already have — EXCEPT rows for turns this tab authored, which
        // we're already showing live (filtered by `${turnId}-` prefix).
        const merged = mergeServerMessages(
          now.messages,
          mapped,
          authoredPrefixes(),
        );

        // Append-only merge can't refresh an existing row — so a planner
        // row whose `source.workflowStatus` the server patched in place
        // (the `"workflow-status"` nudge: a feature's run reached a
        // terminal status after its message fanned out) would stay stale.
        // Reconcile those existing planner rows from the server copy so
        // the `SubAgentRunCard` pill re-derives live. Never drops/reorders
        // rows, so the no-message-loss invariant holds.
        const reconciled = reconcilePlannerSources(merged.messages, mapped);

        if (merged.added.length === 0 && !reconciled.changed) return; // in sync
        const store = useCanvasChatStore.getState();
        store.setConversationMessages(conversationId, reconciled.messages);

        // The user is looking at this chat (only the active conv is
        // subscribed/synced live), and we just merged new server content
        // into it — so it's been seen. Clear its unread flag.
        if (store.activeConversationId === conversationId) markSeen(serverId);
      } catch {
        // Network hiccup — a later nudge (or the next server append) will
        // resync.
      } finally {
        syncInFlightRef.current.delete(conversationId);
        // A nudge that landed during the fetch → run once more.
        if (pendingSyncRef.current.has(conversationId)) {
          const c =
            useCanvasChatStore.getState().conversations[conversationId];
          if (c?.serverConversationId && isIdle(c)) {
            const sid = c.serverConversationId;
            void Promise.resolve().then(() =>
              syncFromServer(conversationId, sid),
            );
          }
        }
      }
    };

    // ─── Catch-up sync ────────────────────────────────────────────────
    // Resolve the local conversation for a server id (the active convo may
    // have changed by call time) and merge whatever the server has now.
    // The merge is idempotent (by id), so calling this defensively can
    // never double-render or drop a message.
    const syncByServerId = (serverId: string): void => {
      const s = useCanvasChatStore.getState();
      const cid = Object.keys(s.conversations).find(
        (k) => s.conversations[k].serverConversationId === serverId,
      );
      if (cid) void syncFromServer(cid, serverId);
    };

    // Catch up the currently-active conversation. Used by the
    // visibility/reconnect handlers below — Pusher delivers no replay, so
    // any nudge fired while the tab was hidden or the socket was down is
    // lost; an explicit refetch on return closes that gap.
    const catchUpActive = (): void => {
      const s = useCanvasChatStore.getState();
      const activeId = s.activeConversationId;
      if (!activeId) return;
      const serverId = s.conversations[activeId]?.serverConversationId;
      if (serverId) syncByServerId(serverId);
    };

    // ─── Pusher subscription management ───────────────────────────────
    // Subscribe to the active conversation's channel; resubscribe when
    // the active conversation (or its server id) changes. Wrapped in
    // try/catch so a missing Pusher config disables live-sync without
    // breaking the page.
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
          syncByServerId(activeServerId);
        });
        // Broadcast from server when a repo_agent run starts or ends.
        // Updates runActive for all participants (incl. non-initiators).
        channel.bind(PUSHER_EVENTS.CANVAS_RUN_ACTIVE, (data: { active: boolean }) => {
          const s = useCanvasChatStore.getState();
          const cid = Object.keys(s.conversations).find(
            (k) => s.conversations[k].serverConversationId === activeServerId,
          );
          if (cid) s.setRunActive(cid, data.active);
        });
        subRef.current = { serverId: activeServerId, channel };
        // Catch up immediately on (re)subscribe: Pusher has no replay, so
        // anything appended while we weren't subscribed to this channel
        // (a reopened tab, a switch back to this conversation, the initial
        // mount with the conversation already active) would otherwise stay
        // invisible until the *next* live nudge. The fetch is idempotent.
        syncByServerId(activeServerId);
      } catch {
        // Pusher unavailable — live-sync disabled.
      }
    };

    // Imperative subscription — fine-grained reaction without re-render.
    const unsub = useCanvasChatStore.subscribe((state, prev) => {
      // Forget pending syncs for dropped conversations.
      for (const id of Object.keys(prev.conversations)) {
        if (!state.conversations[id]) {
          pendingSyncRef.current.delete(id);
        }
      }

      const activeId = state.activeConversationId;

      // A stream that just settled (isStreaming true → false) may have a
      // deferred nudge waiting — run it now that we're idle.
      if (activeId) {
        const before = prev.conversations[activeId];
        const after = state.conversations[activeId];
        if (
          before?.isStreaming &&
          after &&
          !after.isStreaming &&
          after.serverConversationId
        ) {
          // The active chat's own turn just finished and the user is
          // looking at it — mark it seen so it doesn't flag itself unread.
          markSeen(after.serverConversationId);
          if (pendingSyncRef.current.has(activeId)) {
            void syncFromServer(activeId, after.serverConversationId);
          }
        }
      }

      // Keep the live-sync subscription pointed at the active convo.
      const activeServerId = activeId
        ? state.conversations[activeId]?.serverConversationId ?? null
        : null;
      syncActiveSubscription(activeServerId);
    });

    // Seed the subscription from current state at mount. `subscribe` only
    // fires on *changes*, so a remount where the (module-level) store
    // already holds an active conversation — e.g. navigating away from the
    // canvas and back while the planner keeps fanning out — would never
    // subscribe until some unrelated store mutation happened. This also
    // performs the initial catch-up fetch (via `syncActiveSubscription`).
    {
      const s = useCanvasChatStore.getState();
      const activeServerId = s.activeConversationId
        ? s.conversations[s.activeConversationId]?.serverConversationId ?? null
        : null;
      syncActiveSubscription(activeServerId);
    }

    // ─── Visibility / reconnect catch-up ──────────────────────────────
    // Browsers suspend backgrounded-tab websockets and Pusher drops on
    // network blips; in both cases the nudges fired during the gap are
    // never replayed. On return (tab visible again, socket reconnected)
    // refetch the active conversation so missed planner / sub-agent rows
    // appear. Mirrors the `visibilitychange` catch-up in the sibling
    // `useSubAgentStatusRefresh`.
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") catchUpActive();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const onReconnect = (): void => catchUpActive();
    let pusherConnection: ReturnType<
      typeof getPusherClient
    >["connection"] | null = null;
    try {
      pusherConnection = getPusherClient().connection;
      // `connected` fires on the initial connect AND on every reconnect.
      pusherConnection.bind("connected", onReconnect);
    } catch {
      // Pusher unavailable — reconnect catch-up disabled.
    }

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (pusherConnection) {
        try {
          pusherConnection.unbind("connected", onReconnect);
        } catch {
          /* ignore */
        }
      }
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
