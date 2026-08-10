"use client";

import React from "react";

/**
 * `AttentionMapContext` — centralized live-refresh attention state for
 * the org canvas.
 *
 * ## What it does
 * Fetches `/api/orgs/[githubLogin]/attention` once at the higher
 * canvas-scale limit (200) scoped to the visible workspace slugs,
 * builds a `Map<"feature:<id>"|"task:<id>", AttentionItem>`, and
 * exposes `useAttentionType(entityKind, entityId)` for leaf consumers
 * (e.g. `AttentionBadge`).
 *
 * ## Live-refresh strategy (centralized, bounded subscriptions)
 * Rather than one Pusher subscription per rendered card (which would
 * scale with canvas node count), this context owns all subscriptions:
 *
 *   1. **Per-workspace channel** (`workspace-<slug>`) — one per
 *      visible workspace (bounded by workspace count, not node count).
 *      Listens for `WORKSPACE_TASK_TITLE_UPDATE` which fires
 *      unconditionally on every task PATCH, including plain
 *      `{ status: "DONE" }` updates that clear a "ready-to-review"
 *      signal without changing `workflowStatus`.
 *
 *   2. **Per-entity channels** — only for entities currently in the
 *      fetched attention map (i.e. entities that have an active
 *      signal). Binds `WORKFLOW_STATUS_UPDATE`, `FEATURE_UPDATED`,
 *      and `NEW_MESSAGE` so a resolved item's badge clears promptly.
 *      This set is naturally small; it grows only when there are
 *      flagged items.
 *
 *   3. **30-second interval poll** — staleness safety net. Ensures
 *      the map stays fresh even if a Pusher event is missed or an
 *      entity isn't covered by the live-subscription set above (e.g.
 *      a signal appears on a previously-clean entity between fetches).
 *
 * All triggers feed a single `refresh()` with a 2-second trailing
 * debounce so a burst of events collapses into one re-fetch.
 *
 * ## Subscription de-duplication
 * Because subscriptions live here (not in individual rendered nodes),
 * the same entity rendered simultaneously on the root canvas, a
 * workspace sub-canvas, and an initiative sub-canvas is backed by
 * exactly one subscription per workspace/entity — not one per
 * rendered card.
 *
 * ## Graceful degradation
 * When Pusher is unconfigured, `usePusherChannel` returns `null` and
 * the bind effects are no-ops. The badge still reflects the last
 * polled state via the 30s interval — no crash.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AttentionItem } from "@/services/attention/topItems";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import {
  getWorkspaceChannelName,
  getFeatureChannelName,
  getTaskChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Key format used in the attention map. */
export type AttentionMapKey = `feature:${string}` | `task:${string}`;

interface AttentionMapContextValue {
  /**
   * Returns the `AttentionItem["type"]` for the given entity, or
   * `null` if the entity has no active attention signal.
   *
   * Pure read — no subscription side-effect. Consumers re-render only
   * when the context value changes (i.e. after a refresh).
   */
  getAttentionType: (
    entityKind: "feature" | "task",
    entityId: string,
  ) => AttentionItem["type"] | null;
}

const AttentionMapContext = createContext<AttentionMapContextValue>({
  getAttentionType: () => null,
});

// ---------------------------------------------------------------------------
// Hook for leaf consumers
// ---------------------------------------------------------------------------

/**
 * Returns the active `AttentionItem["type"]` for the given entity, or
 * `null` when no signal is active. Reads from the nearest
 * `<AttentionMapProvider>` and triggers a re-render only when the map
 * is refreshed.
 */
export function useAttentionType(
  entityKind: "feature" | "task",
  entityId: string,
): AttentionItem["type"] | null {
  const ctx = useContext(AttentionMapContext);
  return ctx.getAttentionType(entityKind, entityId);
}

// ---------------------------------------------------------------------------
// Internal: per-workspace Pusher subscriber
// ---------------------------------------------------------------------------

/**
 * Subscribes to one workspace's Pusher channel and calls `onEvent`
 * whenever the workspace-level task-update event fires. Extracted
 * as a component so we can conditionally render one per slug inside
 * the provider without violating the rules-of-hooks constraint.
 */
function WorkspaceChannelBinder({
  workspaceSlug,
  onEvent,
}: {
  workspaceSlug: string;
  onEvent: () => void;
}) {
  const channel = usePusherChannel(getWorkspaceChannelName(workspaceSlug));

  useEffect(() => {
    if (!channel) return;
    channel.bind(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, onEvent);
    return () => {
      channel.unbind(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, onEvent);
    };
  }, [channel, onEvent]);

  return null;
}

// ---------------------------------------------------------------------------
// Internal: per-entity Pusher subscriber
// ---------------------------------------------------------------------------

/**
 * Subscribes to one entity's Pusher channel and calls `onEvent` on
 * `WORKFLOW_STATUS_UPDATE`, `FEATURE_UPDATED`, and `NEW_MESSAGE`.
 * Only mounted for entities currently present in the attention map
 * (i.e. entities that have an active signal) — so the subscription
 * count stays proportional to flagged-item count, not canvas-node
 * count.
 */
function EntityChannelBinder({
  channelName,
  onEvent,
}: {
  channelName: string;
  onEvent: () => void;
}) {
  const channel = usePusherChannel(channelName);

  useEffect(() => {
    if (!channel) return;
    channel.bind(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, onEvent);
    channel.bind(PUSHER_EVENTS.FEATURE_UPDATED, onEvent);
    channel.bind(PUSHER_EVENTS.NEW_MESSAGE, onEvent);
    return () => {
      channel.unbind(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, onEvent);
      channel.unbind(PUSHER_EVENTS.FEATURE_UPDATED, onEvent);
      channel.unbind(PUSHER_EVENTS.NEW_MESSAGE, onEvent);
    };
  }, [channel, onEvent]);

  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AttentionMapProviderProps {
  githubLogin: string;
  /**
   * Visible workspace slugs — the same list already computed by
   * `OrgCanvasView.tsx` for the chat-intro attention fetch. Filters
   * out hidden workspaces so they don't surface attention items on
   * the canvas.
   */
  visibleWorkspaceSlugs: string[];
  children: React.ReactNode;
}

/**
 * Canvas-scale attention map provider. Mount once in `OrgCanvasView`.
 *
 * Children can call `useAttentionType(kind, id)` to read live signal
 * data without triggering a new fetch or subscription.
 */
export function AttentionMapProvider({
  githubLogin,
  visibleWorkspaceSlugs,
  children,
}: AttentionMapProviderProps) {
  // The live attention map: entity key → AttentionItem.
  const [attentionMap, setAttentionMap] = useState<
    Map<AttentionMapKey, AttentionItem>
  >(new Map());

  // Debounce timer ref — reset on every event so a burst collapses
  // into a single re-fetch.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch + build map
  // ---------------------------------------------------------------------------

  const fetchAndUpdate = useCallback(async () => {
    if (visibleWorkspaceSlugs.length === 0) {
      setAttentionMap(new Map());
      return;
    }
    try {
      const slugsParam = visibleWorkspaceSlugs.join(",");
      // Request at the canvas-scale ceiling (200). The route enforces
      // MAX_LIMIT=200 so this is effectively "give me everything up to
      // the bounded cap."
      const res = await fetch(
        `/api/orgs/${githubLogin}/attention?limit=200&workspaceSlugs=${encodeURIComponent(slugsParam)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items: AttentionItem[] };
      const map = new Map<AttentionMapKey, AttentionItem>();
      for (const item of data.items ?? []) {
        const key: AttentionMapKey = `${item.entityKind}:${item.entityId}`;
        map.set(key, item);
      }
      setAttentionMap(map);
    } catch {
      // Silently absorb — the existing map stays valid; the 30s poll
      // will retry.
    }
  }, [githubLogin, visibleWorkspaceSlugs]);

  // ---------------------------------------------------------------------------
  // Debounced refresh — all triggers funnel here
  // ---------------------------------------------------------------------------

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchAndUpdate();
    }, 2000);
  }, [fetchAndUpdate]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Initial fetch + 30s interval poll
  // ---------------------------------------------------------------------------

  useEffect(() => {
    fetchAndUpdate();
    const interval = setInterval(fetchAndUpdate, 30_000);
    return () => clearInterval(interval);
  }, [fetchAndUpdate]);

  // ---------------------------------------------------------------------------
  // Derive entity channel names for entities currently in the map
  // ---------------------------------------------------------------------------

  const entityChannelNames = useMemo(() => {
    const names: string[] = [];
    for (const [key] of attentionMap) {
      const [kind, ...idParts] = key.split(":") as [
        "feature" | "task",
        ...string[],
      ];
      const id = idParts.join(":");
      if (kind === "feature") {
        names.push(getFeatureChannelName(id));
      } else {
        names.push(getTaskChannelName(id));
      }
    }
    return names;
  }, [attentionMap]);

  // ---------------------------------------------------------------------------
  // Context value — stable reference via useCallback
  // ---------------------------------------------------------------------------

  const getAttentionType = useCallback(
    (
      entityKind: "feature" | "task",
      entityId: string,
    ): AttentionItem["type"] | null => {
      const key: AttentionMapKey = `${entityKind}:${entityId}`;
      return attentionMap.get(key)?.type ?? null;
    },
    [attentionMap],
  );

  const contextValue = useMemo<AttentionMapContextValue>(
    () => ({ getAttentionType }),
    [getAttentionType],
  );

  return (
    <AttentionMapContext.Provider value={contextValue}>
      {/* One workspace-channel binder per visible workspace */}
      {visibleWorkspaceSlugs.map((slug) => (
        <WorkspaceChannelBinder
          key={slug}
          workspaceSlug={slug}
          onEvent={scheduleRefresh}
        />
      ))}

      {/* One entity-channel binder per entity currently in the map */}
      {entityChannelNames.map((channelName) => (
        <EntityChannelBinder
          key={channelName}
          channelName={channelName}
          onEvent={scheduleRefresh}
        />
      ))}

      {children}
    </AttentionMapContext.Provider>
  );
}
