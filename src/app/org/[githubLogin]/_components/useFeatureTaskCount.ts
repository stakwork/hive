"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Shared types — also consumed by StartTasksSlot and SubAgentRunCard.
// ---------------------------------------------------------------------------

interface PrArtifactView {
  content: {
    url: string;
    status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    progress?: {
      ciStatus?: "pending" | "success" | "failure";
      ciSummary?: string;
    };
  };
}

export interface TaskView {
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "BLOCKED";
  prArtifact?: {
    url: string;
    status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    ciStatus?: "pending" | "success" | "failure";
    ciSummary?: string;
  } | null;
}

export interface TaskCounts {
  done: number;
  inProgress: number;
  pending: number;
  /** done + inProgress + pending. Excludes CANCELLED. */
  total: number;
}

export interface FeatureTasksResponse {
  data?: {
    phases?: {
      tasks?: {
        title?: string | null;
        status?: string | null;
        prArtifact?: PrArtifactView | null;
      }[];
    }[];
    tasks?: {
      title?: string | null;
      status?: string | null;
      prArtifact?: PrArtifactView | null;
    }[];
  } | null;
}

/**
 * Flatten the feature payload into an ordered task list. Phases come
 * back ordered by `order`; their tasks are ordered by the `sortBy=order`
 * query. Top-level (phase-less) tasks trail the phased ones.
 */
export function buildTaskList(
  feature: NonNullable<FeatureTasksResponse["data"]>,
): TaskView[] {
  const out: TaskView[] = [];
  const push = (t: {
    title?: string | null;
    status?: string | null;
    prArtifact?: PrArtifactView | null;
  }) => {
    out.push({
      title: t.title?.trim() || "Untitled task",
      status: (t.status as TaskView["status"]) ?? "TODO",
      prArtifact: t.prArtifact
        ? {
            url: t.prArtifact.content.url,
            status: t.prArtifact.content.status,
            ciStatus: t.prArtifact.content.progress?.ciStatus,
            ciSummary: t.prArtifact.content.progress?.ciSummary,
          }
        : null,
    });
  };
  for (const phase of feature.phases ?? []) {
    for (const t of phase.tasks ?? []) push(t);
  }
  for (const t of feature.tasks ?? []) push(t);
  return out;
}

export function countTasks(tasks: TaskView[]): TaskCounts {
  let done = 0;
  let inProgress = 0;
  let pending = 0;
  for (const t of tasks) {
    if (t.status === "DONE") done++;
    else if (t.status === "IN_PROGRESS") inProgress++;
    else if (t.status === "TODO" || t.status === "BLOCKED") pending++;
    // CANCELLED is intentionally excluded from the rollup.
  }
  return { done, inProgress, pending, total: done + inProgress + pending };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches the live total task count (done + in-progress + pending,
 * excluding cancelled) for a feature from
 * `GET /api/features/{id}?sortBy=order`.
 *
 * Returns `undefined` while loading or on fetch failure, so callers can
 * treat `undefined` as "still resolving" without throwing.
 *
 * Re-runs whenever `revalidateKey` changes (e.g. a new planner message
 * arrived) and on window `focus`, so the count stays fresh as the
 * planner creates tasks via MCP.
 */
export function useFeatureTaskCount(
  featureId: string | undefined,
  revalidateKey?: string,
): number | undefined {
  const [total, setTotal] = useState<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!featureId) return;
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}?sortBy=order`,
      );
      if (!res.ok) return; // leave total as-is (undefined)
      const json = (await res.json()) as FeatureTasksResponse;
      if (json.data) {
        setTotal(countTasks(buildTaskList(json.data)).total);
      }
    } catch {
      // On any error leave count undefined — the card falls back to "Replied".
    }
  }, [featureId]);

  useEffect(() => {
    void refresh();
  }, [refresh, revalidateKey]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return total;
}
