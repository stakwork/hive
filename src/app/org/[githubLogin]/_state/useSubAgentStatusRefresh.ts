/**
 * Background status refresh for SubAgentRunCard status pills.
 *
 * Planner fan-out writes `workflowStatus` into `source` at message time,
 * but the workflow may progress (or the tab may have been hidden) without
 * triggering a new fan-out. This hook closes that gap:
 *
 *  - On tab focus (`visibilitychange` → `"visible"`) it re-queries every
 *    feature referenced by a planner row in the active conversation.
 *  - While the tab is visible AND at least one planner row is in a
 *    non-terminal state, it polls every `SUBAGENT_POLL_INTERVAL_MS` ms.
 *  - Refreshed status is patched in-place via `applyFeatureStatusPatch`
 *    + `setConversationMessages` — conversation history is never discarded.
 *
 * Mounted once per page in `OrgCanvasView`, directly below
 * `useCanvasChatAutoSave`.
 */
"use client";

import { useEffect, useRef } from "react";
import { useCanvasChatStore } from "./canvasChatStore";
import { applyFeatureStatusPatch } from "./canvasChatPersistence";

export const SUBAGENT_POLL_INTERVAL_MS = 30_000;
const IN_FLIGHT_STATUSES = new Set(["IN_PROGRESS", "PENDING"]);

export function useSubAgentStatusRefresh({
  githubLogin,
}: {
  githubLogin: string;
}): void {
  const featureIdsRef = useRef<Set<string>>(new Set());
  const conversationIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    // ── refresh() ────────────────────────────────────────────────────
    // Fetches plan-status for every referenced featureId and patches
    // planner rows in-place. Never throws — network errors are silent.
    const refresh = async (): Promise<void> => {
      const featureIds = featureIdsRef.current;
      const conversationId = conversationIdRef.current;
      if (!featureIds.size || !conversationId) return;
      if (document.visibilityState !== "visible") return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        const results = await Promise.allSettled(
          Array.from(featureIds).map((id) =>
            fetch(`/api/features/${id}/plan-status`)
              .then((r) => (r.ok ? r.json() : null))
              .then(
                (data) =>
                  data as { workflowStatus?: string; hasLogs?: boolean } | null,
              )
              .then((data) => ({ id, data })),
          ),
        );

        const patchMap = new Map<
          string,
          { workflowStatus?: string; hasLogs?: boolean }
        >();
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.data) {
            patchMap.set(result.value.id, result.value.data);
          }
        }
        if (!patchMap.size) return;

        const conv =
          useCanvasChatStore.getState().conversations[conversationId];
        if (!conv) return;

        const { messages, changed } = applyFeatureStatusPatch(
          conv.messages,
          patchMap,
        );
        if (changed) {
          useCanvasChatStore
            .getState()
            .setConversationMessages(conversationId, messages);
        }
      } catch {
        // Network hiccup — a later poll will retry.
      } finally {
        inFlightRef.current = false;
      }
    };

    // ── syncInterval() ───────────────────────────────────────────────
    // Starts the polling interval when in-flight rows exist + tab is
    // visible; clears it otherwise.
    const syncInterval = (): void => {
      const conversationId = conversationIdRef.current;
      const conv = conversationId
        ? useCanvasChatStore.getState().conversations[conversationId]
        : null;

      const isInFlight = (conv?.messages ?? []).some((m) => {
        const src = m.source as
          | { kind?: string; workflowStatus?: string }
          | null
          | undefined;
        return (
          src?.kind === "planner" &&
          src.workflowStatus !== undefined &&
          IN_FLIGHT_STATUSES.has(src.workflowStatus)
        );
      });

      const isVisible = document.visibilityState === "visible";

      if (isInFlight && isVisible) {
        if (!intervalRef.current) {
          intervalRef.current = setInterval(() => {
            void refresh();
          }, SUBAGENT_POLL_INTERVAL_MS);
        }
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    // ── Store subscription ────────────────────────────────────────────
    // Imperative (not reactive) — mirrors the useCanvasChatAutoSave
    // pattern. Extracts featureIds from planner rows each time the store
    // changes, then syncs the polling interval.
    const extractFeatureIds = (state: ReturnType<typeof useCanvasChatStore.getState>) => {
      const conv = state.activeConversationId
        ? state.conversations[state.activeConversationId]
        : null;
      const featureIds = new Set<string>();
      for (const m of conv?.messages ?? []) {
        const src = m.source as
          | { kind?: string; featureId?: string }
          | null
          | undefined;
        if (src?.kind === "planner" && src.featureId) {
          featureIds.add(src.featureId);
        }
      }
      return { featureIds, conversationId: state.activeConversationId };
    };

    // Seed refs with current state at mount (subscribe doesn't fire for
    // the initial state, so we need to read it explicitly).
    {
      const initial = extractFeatureIds(useCanvasChatStore.getState());
      featureIdsRef.current = initial.featureIds;
      conversationIdRef.current = initial.conversationId;
      syncInterval();
    }

    const unsubscribe = useCanvasChatStore.subscribe((state) => {
      const { featureIds, conversationId } = extractFeatureIds(state);
      featureIdsRef.current = featureIds;
      conversationIdRef.current = conversationId;
      syncInterval();
    });

    // ── visibilitychange listener (GatewayView pattern) ───────────────
    const handleVisibility = (): void => {
      if (document.visibilityState !== "visible") {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        return;
      }
      // Tab just became visible — refresh immediately, then restart
      // the polling interval based on current in-flight state.
      void refresh();
      syncInterval();
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      unsubscribe();
    };
    // githubLogin is stable for the lifetime of the page; effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin]);
}
