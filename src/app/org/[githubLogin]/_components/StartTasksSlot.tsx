"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Play,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";
import {
  buildTaskList,
  countTasks,
  useFeatureTaskCount,
  type TaskView,
  type TaskCounts,
  type FeatureTasksResponse,
} from "./useFeatureTaskCount";

// Re-export shared utilities so existing imports from this file continue
// to work (StartTasksSlot was previously the canonical location).
export { buildTaskList, countTasks };
export type { TaskView, TaskCounts, FeatureTasksResponse };

/**
 * StartTasksSlot — the canvas-chat "Tasks" status card.
 *
 * Sits beside the `SubAgentRunCard` once a feature's planner has
 * replied. It does two jobs:
 *
 *   1. **Monitor** — a persistent, glanceable view of the feature's task
 *      progress (done / in-progress / pending), shown as a segmented bar
 *      when collapsed and a per-task checklist when expanded.
 *   2. **Start** — lets the user kick off execution (assigning the
 *      feature's ready tasks to the Task Coordinator) without leaving
 *      canvas chat, mirroring the "Start Tasks" button on the full plan
 *      page (`/w/<slug>/plan/<featureId>`).
 *
 * **Starting tasks is a user decision, never the canvas agent's** — it
 * spins up real compute (pods / workflow runs). So the Start affordance
 * is a plain button, not an agent tool.
 *
 * **Live data is the source of truth, NOT a chat artifact.** Tasks
 * created by the remote planner over MCP (`create_task` /
 * `create_feature_task`) land in the DB with no `TASKS` artifact, so the
 * artifact-derived `run.hasGeneratedTasks` flag can't see them. This
 * card asks the DB directly, so it surfaces tasks no matter how they
 * were created.
 *
 * Data flow (both fetched on mount, on `revalidateKey` change, and on
 * window focus):
 *   - GET `…/tasks/assign-all` → `{ readyCount }` (unassigned TODO tasks
 *     in the feature's first phase — the exact set the POST will assign).
 *     This scopes the Start button.
 *   - GET `/api/features/<id>?sortBy=order` → the feature's full task
 *     list with per-task `status`. This drives the bar + checklist. Note
 *     the API upgrades `status` to `DONE` when a task's PR is merged, so
 *     "done" (purple) reflects merged work, not just the raw column.
 *
 * Renders nothing when there are no tasks at all and nothing is ready /
 * started — i.e. a feature whose planner replied but hasn't produced
 * tasks yet shows no card.
 */

/** Tailwind bg for a task's status — done emerald, running amber, pending grey.
 * Matches the app-wide task status dots (see CompactTasksList STATUS_DOT). */
const STATUS_BG: Record<"done" | "inProgress" | "pending", string> = {
  done: "bg-emerald-500",
  inProgress: "bg-amber-500",
  pending: "bg-zinc-300 dark:bg-zinc-600",
};

function bucketOf(
  status: TaskView["status"],
): "done" | "inProgress" | "pending" | null {
  if (status === "DONE") return "done";
  if (status === "IN_PROGRESS") return "inProgress";
  if (status === "TODO" || status === "BLOCKED") return "pending";
  return null; // CANCELLED
}

/** A thin segmented progress bar, proportional to the three buckets. */
function SegmentedBar({ counts }: { counts: TaskCounts }) {
  const { done, inProgress, pending, total } = counts;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {done > 0 && <div className={STATUS_BG.done} style={{ width: pct(done) }} />}
      {inProgress > 0 && (
        <div className={STATUS_BG.inProgress} style={{ width: pct(inProgress) }} />
      )}
      {pending > 0 && (
        <div className={STATUS_BG.pending} style={{ width: pct(pending) }} />
      )}
    </div>
  );
}

/** "3 done · 1 running · 1 todo" — only non-zero buckets. */
function summaryText(counts: TaskCounts): string {
  const parts: string[] = [];
  if (counts.done > 0) parts.push(`${counts.done} done`);
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} running`);
  if (counts.pending > 0) parts.push(`${counts.pending} todo`);
  return parts.join(" · ");
}

interface StartTasksSlotProps {
  featureId: string;
  featureTitle?: string;
  /**
   * Changes whenever the owning run sees new planner activity (the
   * parent passes `run.anchorMessageId`). A change re-queries the live
   * ready-count + task list, so tasks the planner just created (incl. via
   * MCP, with no artifact) surface without a manual refresh.
   */
  revalidateKey?: string;
}

export function StartTasksSlot({
  featureId,
  featureTitle,
  revalidateKey,
}: StartTasksSlotProps) {
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [startedCount, setStartedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Use the shared hook for the total task count (drives the bar + checklist).
  const taskTotal = useFeatureTaskCount(featureId, revalidateKey);

  // Keep a local copy of the task list for bar/checklist rendering.
  // We still need the raw TaskView[] for the segmented bar and checklist,
  // which the shared hook doesn't expose directly — so we fetch the list
  // separately here and keep it in sync.
  const refreshList = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}?sortBy=order`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as FeatureTasksResponse;
      if (json.data) setTasks(buildTaskList(json.data));
    } catch {
      // leave as-is
    }
  }, [featureId]);

  const refreshReady = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}/tasks/assign-all`,
      );
      if (res.ok) {
        const data = (await res.json()) as { readyCount?: number };
        setReadyCount(typeof data.readyCount === "number" ? data.readyCount : 0);
      }
    } catch {
      // leave as-is
    }
  }, [featureId]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshReady(), refreshList()]);
  }, [refreshReady, refreshList]);

  useEffect(() => {
    void refresh();
  }, [refresh, revalidateKey]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const counts = useMemo(
    () => (tasks ? countTasks(tasks) : null),
    [tasks],
  );

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}/tasks/assign-all`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { count?: number };
      setStartedCount(typeof data.count === "number" ? data.count : 0);
      setReadyCount(0);
      // Pull fresh statuses so the bar reflects the just-assigned tasks.
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start tasks");
    } finally {
      setStarting(false);
    }
  };

  const total = taskTotal ?? 0;
  const showStart = (readyCount ?? 0) > 0 && startedCount === null;

  // Nothing to show: no tasks at all, nothing ready, nothing just
  // started (covers the still-loading and the empty-feature cases).
  if (total === 0 && !showStart && startedCount === null) return null;

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <div className="flex items-start gap-2 px-3 py-2.5">
        {/* Collapse toggle — only meaningful when there are tasks to list. */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          disabled={total === 0}
          className="mt-0.5 flex-shrink-0 text-muted-foreground disabled:opacity-0"
          title={expanded ? "Hide tasks" : "Show tasks"}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
              <span className="font-semibold text-foreground">Tasks</span>
              {counts && total > 0 && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="truncate text-muted-foreground">
                    {summaryText(counts)}
                  </span>
                </>
              )}
            </div>

            {showStart && (
              <Button
                size="sm"
                variant="default"
                onClick={handleStart}
                disabled={starting}
                className="h-7 flex-shrink-0 gap-1.5 px-2.5 text-xs font-semibold shadow-sm"
              >
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Start {readyCount}
              </Button>
            )}
          </div>

          {counts && <SegmentedBar counts={counts} />}

          {/* Expanded: the per-task checklist (name + status-colored dot). */}
          {expanded && tasks && tasks.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
              {tasks.map((t, i) => {
                const bucket = bucketOf(t.status);
                if (!bucket) return null; // skip CANCELLED
                return (
                  <li
                    key={`${i}-${t.title}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_BG[bucket]}`}
                    />
                    <span
                      className={
                        bucket === "done"
                          ? "truncate text-muted-foreground line-through"
                          : "truncate text-foreground/80"
                      }
                    >
                      {t.title}
                    </span>
                    {t.prArtifact && (
                      <PRStatusBadge
                        url={t.prArtifact.url}
                        status={t.prArtifact.status}
                        ciStatus={t.prArtifact.ciStatus}
                        ciSummary={t.prArtifact.ciSummary}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {startedCount !== null && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Started {startedCount} task{startedCount === 1 ? "" : "s"} — the
                coordinator is picking them up
                {featureTitle ? ` · ${featureTitle}` : ""}.
              </span>
            </div>
          )}

          {error && (
            <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default StartTasksSlot;
