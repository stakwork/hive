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
        useCanvasChatStore
          .getState()
          .setConversationMessages(conversationId, reconciled.messages);
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
          after.serverConversationId &&
          pendingSyncRef.current.has(activeId)
        ) {
          void syncFromServer(activeId, after.serverConversationId);
        }
      }

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
