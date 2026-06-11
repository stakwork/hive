"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * StartTasksSlot — the canvas-chat "Start Tasks" affordance.
 *
 * Sits beside the `SubAgentRunCard` once a feature's planner has
 * replied, and lets the user kick off execution — assigning the
 * feature's ready tasks to the Task Coordinator — without leaving
 * canvas chat. It mirrors the "Start Tasks" button on the full plan
 * page (`/w/<slug>/plan/<featureId>`).
 *
 * **Starting tasks is a user decision, never the canvas agent's** — it
 * spins up real compute (pods / workflow runs). So this is a plain
 * button, not an agent tool.
 *
 * **The live `readyCount` is the source of truth, NOT a chat
 * artifact.** Tasks created by the remote planner over MCP
 * (`create_task` / `create_feature_task`) land in the DB with no
 * `TASKS` artifact, so the artifact-derived `run.hasGeneratedTasks`
 * flag can't see them. This slot instead asks the DB directly, so it
 * surfaces tasks no matter how they were created.
 *
 * Data flow:
 *   - GET `…/tasks/assign-all` → `{ readyCount }` (unassigned TODO
 *     tasks in the feature's first phase — the exact set the POST will
 *     assign). Re-runs on mount, whenever `revalidateKey` changes (the
 *     parent passes the run's anchor, which moves on each new planner
 *     reply — so a closing "tasks created" message refreshes the count),
 *     and on window focus (covers MCP creates with no closing message).
 *   - Renders nothing while loading or when `readyCount === 0`
 *     (e.g. all tasks already started elsewhere).
 *   - Click → POST `…/tasks/assign-all` → `{ success, count }`, then
 *     show a confirmation. The count is read live, so it's always
 *     accurate even if tasks were started from another surface.
 */
interface StartTasksSlotProps {
  featureId: string;
  featureTitle?: string;
  /**
   * Changes whenever the owning run sees new planner activity (the
   * parent passes `run.anchorMessageId`). A change re-queries the live
   * ready-count, so tasks the planner just created (incl. via MCP, with
   * no artifact) surface without a manual refresh.
   */
  revalidateKey?: string;
}

export function StartTasksSlot({
  featureId,
  featureTitle,
  revalidateKey,
}: StartTasksSlotProps) {
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

  // Re-query on mount and whenever the run advances (`revalidateKey`).
  // A new planner reply — including the closing message after the agent
  // created tasks over MCP — bumps the key, so the count refreshes and
  // the button appears without the user touching anything.
  useEffect(() => {
    void refresh();
  }, [refresh, revalidateKey]);

  // Also revalidate when the user returns to the tab. Covers the case
  // where tasks were created (MCP or elsewhere) while the conversation
  // was idle and produced no new message to bump `revalidateKey`. Only
  // worth polling for while nothing is started yet.
  useEffect(() => {
    if (startedCount !== null) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, startedCount]);

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
    <div className="rounded-lg border border-primary/40 bg-primary/[0.06] px-3 py-2.5 ring-1 ring-inset ring-primary/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Zap className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            <span>
              {readyCount} task{readyCount === 1 ? "" : "s"} ready to run
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Starts agents on real compute
            {featureTitle ? ` · ${featureTitle}` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={handleStart}
          disabled={starting}
          className="h-8 flex-shrink-0 gap-1.5 px-3 text-xs font-semibold shadow-sm"
        >
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Start {readyCount} task{readyCount === 1 ? "" : "s"}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default StartTasksSlot;
