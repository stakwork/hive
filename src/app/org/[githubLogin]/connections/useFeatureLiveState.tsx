"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CanvasData } from "system-canvas-react";
import { useEntityChannel } from "@/hooks/useEntityChannel";
import { PUSHER_EVENTS } from "@/lib/pusher";
import {
  initFeatureLiveState,
  mergeWorkflowStatusUpdate,
  resetFromProjection,
  type FeatureLiveState,
  type ProjectionSnapshot,
  type WorkflowStatusUpdateEvent,
} from "@/lib/canvas/feature-live-state";

const FEATURE_ID_PREFIX = "feature:";

export interface FeatureSeed {
  featureId: string;
  snapshot: ProjectionSnapshot;
}

export interface FeatureLiveOverlay {
  plannerRunning: boolean;
  agentsRunningCount: number;
}

interface FeatureCustomData {
  plannerRunning?: boolean;
  agentTasks?: Array<{ id: string; workflowStatus: string | null }>;
  agentsRunningCount?: number;
}

export function deriveFeatureSnapshots(
  canvases: Array<CanvasData | null | undefined>,
): FeatureSeed[] {
  const seen = new Set<string>();
  const out: FeatureSeed[] = [];
  for (const data of canvases) {
    for (const node of data?.nodes ?? []) {
      if (node.category !== "feature") continue;
      if (!node.id.startsWith(FEATURE_ID_PREFIX)) continue;
      const featureId = node.id.slice(FEATURE_ID_PREFIX.length);
      if (seen.has(featureId)) continue;
      seen.add(featureId);
      const cd = (node.customData ?? {}) as FeatureCustomData;
      out.push({
        featureId,
        snapshot: {
          plannerRunning: Boolean(cd.plannerRunning),
          agentTasks: cd.agentTasks ?? [],
          agentsRunningCount: cd.agentsRunningCount ?? 0,
        },
      });
    }
  }
  return out;
}

// Render-only overlay: lands on the data passed to <SystemCanvas>, never on
// the persisted blob (applyMutation reads the undecorated state mirrors).
export function decorateNodesWithLiveState(
  data: CanvasData,
  liveByFeatureId: Map<string, FeatureLiveOverlay>,
): CanvasData {
  const nodes = data.nodes ?? [];
  let changed = false;
  const next = nodes.map((n) => {
    if (n.category !== "feature" || !n.id.startsWith(FEATURE_ID_PREFIX)) return n;
    const featureId = n.id.slice(FEATURE_ID_PREFIX.length);
    const live = liveByFeatureId.get(featureId);
    if (!live) return n;
    const cd = (n.customData ?? {}) as Record<string, unknown>;
    if (
      cd.plannerRunning === live.plannerRunning &&
      cd.agentsRunningCount === live.agentsRunningCount
    ) {
      return n;
    }
    changed = true;
    return {
      ...n,
      customData: {
        ...cd,
        plannerRunning: live.plannerRunning,
        agentsRunningCount: live.agentsRunningCount,
      },
    };
  });
  return changed ? { ...data, nodes: next } : data;
}

function seedSignature(seeds: FeatureSeed[]): string {
  return seeds
    .map(
      (s) =>
        `${s.featureId}:${s.snapshot.plannerRunning}:${s.snapshot.agentsRunningCount}:` +
        s.snapshot.agentTasks.map((t) => `${t.id}=${t.workflowStatus}`).join(","),
    )
    .join("|");
}

function FeatureChannelBinder({
  featureId,
  onEvent,
}: {
  featureId: string;
  onEvent: (featureId: string, event: WorkflowStatusUpdateEvent) => void;
}) {
  const channel = useEntityChannel("feature", featureId);

  useEffect(() => {
    if (!channel) return;
    const handler = (event: WorkflowStatusUpdateEvent) => onEvent(featureId, event);
    channel.bind(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, handler);
    return () => {
      channel.unbind(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, handler);
    };
  }, [channel, featureId, onEvent]);

  return null;
}

export function useFeatureLiveState(seeds: FeatureSeed[]): {
  liveByFeatureId: Map<string, FeatureLiveOverlay>;
  binders: ReactNode;
} {
  const signature = useMemo(() => seedSignature(seeds), [seeds]);
  const [stateMap, setStateMap] = useState<Map<string, FeatureLiveState>>(
    () => new Map(),
  );

  useEffect(() => {
    setStateMap((prev) => {
      const next = new Map<string, FeatureLiveState>();
      for (const seed of seeds) {
        const existing = prev.get(seed.featureId);
        next.set(
          seed.featureId,
          existing
            ? resetFromProjection(existing, seed.snapshot)
            : initFeatureLiveState(seed.featureId, seed.snapshot),
        );
      }
      return next;
    });
    // Reconcile only when the authoritative projector snapshot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const onEvent = useCallback(
    (featureId: string, event: WorkflowStatusUpdateEvent) => {
      setStateMap((prev) => {
        const current = prev.get(featureId);
        if (!current) return prev;
        const merged = mergeWorkflowStatusUpdate(current, event);
        if (merged === current) return prev;
        const next = new Map(prev);
        next.set(featureId, merged);
        return next;
      });
    },
    [],
  );

  const liveByFeatureId = useMemo(() => {
    const map = new Map<string, FeatureLiveOverlay>();
    for (const [featureId, state] of stateMap) {
      map.set(featureId, {
        plannerRunning: state.plannerRunning,
        agentsRunningCount: state.agentsRunningCount,
      });
    }
    return map;
  }, [stateMap]);

  const featureIdKey = useMemo(
    () => seeds.map((s) => s.featureId).sort().join(","),
    [seeds],
  );

  const binders = useMemo(() => {
    const ids = featureIdKey ? featureIdKey.split(",") : [];
    return ids.map((id) => (
      <FeatureChannelBinder key={id} featureId={id} onEvent={onEvent} />
    ));
  }, [featureIdKey, onEvent]);

  return { liveByFeatureId, binders };
}
