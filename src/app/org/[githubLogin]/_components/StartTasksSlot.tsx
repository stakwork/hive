"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * StartTasksSlot — the canvas-chat "Start Tasks" affordance.
 *
 * Once a feature's planner has generated a task breakdown
 * (`run.hasGeneratedTasks`), this slot sits beside the
 * `SubAgentRunCard` and lets the user kick off execution — assigning
 * the feature's ready tasks to the Task Coordinator — without leaving
 * canvas chat. It mirrors the "Start Tasks" button on the full plan
 * page (`/w/<slug>/plan/<featureId>`).
 *
 * **Starting tasks is a user decision, never the canvas agent's** — it
 * spins up real compute (pods / workflow runs). So this is a plain
 * button, not an agent tool.
 *
 * Data flow:
 *   - On mount, GET `…/tasks/assign-all` → `{ readyCount }` (unassigned
 *     TODO tasks in the feature's first phase — the exact set the POST
 *     will assign).
 *   - Renders nothing while loading or when `readyCount === 0`
 *     (e.g. all tasks already started elsewhere).
 *   - Click → POST `…/tasks/assign-all` → `{ success, count }`, then
 *     show a confirmation. The count is read live, so it's always
 *     accurate even if tasks were started from another surface.
 */
interface StartTasksSlotProps {
  featureId: string;
  featureTitle?: string;
}

export function StartTasksSlot({ featureId, featureTitle }: StartTasksSlotProps) {
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startedCount, setStartedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/features/${encodeURIComponent(featureId)}/tasks/assign-all`,
      );
      if (!res.ok) return; // silent — the slot just stays hidden
      const data = (await res.json()) as { readyCount?: number };
      setReadyCount(typeof data.readyCount === "number" ? data.readyCount : 0);
    } catch {
      // Network hiccup → leave hidden; the user can still use the plan page.
    }
  }, [featureId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start tasks");
    } finally {
      setStarting(false);
    }
  };

  // Confirmation after a successful start.
  if (startedCount !== null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Started {startedCount} task{startedCount === 1 ? "" : "s"} — the
          coordinator is picking them up.
        </span>
      </div>
    );
  }

  // Nothing to start (still loading, or all tasks already assigned).
  if (readyCount === null || readyCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="min-w-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {readyCount} task{readyCount === 1 ? "" : "s"} ready
        </span>
        {featureTitle && (
          <>
            <span aria-hidden="true" className="mx-1">
              ·
            </span>
            <span className="truncate">{featureTitle}</span>
          </>
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        onClick={handleStart}
        disabled={starting}
        className="h-7 flex-shrink-0 gap-1 px-2.5 text-xs"
      >
        {starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Start tasks
      </Button>
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      )}
    </div>
  );
}

export default StartTasksSlot;
