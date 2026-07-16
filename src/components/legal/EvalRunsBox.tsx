"use client";

import React, { useState, useRef, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";
import { useLegalBenchmarkEval, type EvalResult } from "@/hooks/useLegalBenchmarkEval";
import type { EvalRunHistoryEntry } from "@/types/legal";

interface EvalRunsBoxProps {
  /** The task slug identifying which task's eval runs to show */
  taskSlug: string;
  /** The run ID used to dispatch new evals */
  runId: string;
  /** Controls whether the super-admin Stakwork links are shown */
  isSuperAdmin: boolean;
  /** Parent decides based on role/feature flags — hides the Run Eval button when false */
  showRunEvalButton: boolean;
  /** When true, shows the Recursion enroll button alongside Run Eval */
  showRecursionButton?: boolean;
}

function SummaryCell({ entry }: { entry: EvalRunHistoryEntry }) {
  const { output, projectId } = entry;

  if (output === null && projectId !== null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Evaluating…
      </span>
    );
  }

  if (output === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (output.result === "fail") {
    const label = output.judge_notes?.trim() ? output.judge_notes : "Failed";
    return <span className="text-red-600 dark:text-red-400">{label}</span>;
  }

  // pass
  return <span>{output.judge_notes ?? "—"}</span>;
}

export function EvalRunsBox({
  taskSlug,
  runId,
  isSuperAdmin,
  showRunEvalButton,
  showRecursionButton = false,
}: EvalRunsBoxProps) {
  const { history, isLoading, refetch } = useEvalRunHistory(taskSlug);
  const { runEval, isSubmitting } = useLegalBenchmarkEval();
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [optimisticEntry, setOptimisticEntry] = useState<EvalRunHistoryEntry | null>(null);
  const [recursionPending, setRecursionPending] = useState(false);

  // Refs for polling
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyLengthBeforeRef = useRef<number>(0);
  const initialLoadComplete = useRef<boolean>(false);

  // Track when first load settles
  useEffect(() => {
    if (!isLoading) initialLoadComplete.current = true;
  }, [isLoading]);

  const stopPolling = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  };

  const startPolling = () => {
    intervalRef.current = setInterval(() => refetch(), 10_000);
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setOptimisticEntry(null); // workflow failed or timed out — clear stale spinner
    }, 3 * 60 * 1000);
  };

  // Real-data detection: dismiss optimistic entry when history grows past pre-run snapshot
  useEffect(() => {
    if (!optimisticEntry || !initialLoadComplete.current) return;
    if (history.length > historyLengthBeforeRef.current) {
      setOptimisticEntry(null);
      stopPolling();
    }
  }, [history, optimisticEntry]);

  // Unmount cleanup
  useEffect(() => () => stopPolling(), []);

  const handleRunEval = async () => {
    const result = await runEval(runId);
    setEvalResult(result);
    if (result.status === "started" && result.projectId && initialLoadComplete.current) {
      historyLengthBeforeRef.current = history.length;
      setOptimisticEntry({
        triggerId: `optimistic-${result.projectId}`,
        output: null,
        projectId: result.projectId,
        createdAt: new Date().toISOString(),
      });
      startPolling();
    }
  };

  const evalButtonDisabled =
    isSubmitting ||
    evalResult?.status === "started" ||
    evalResult?.status === "active" ||
    (evalResult?.status === "skipped" && evalResult.reason === "already_ran");

  const handleEnrollRecursion = async () => {
    setRecursionPending(true);
    try {
      const res = await fetch("/api/workspaces/openlaw/legal/benchmarks/recursion/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskSlug }),
      });
      if (res.ok) {
        const { toast } = await import("sonner");
        toast.success("Enrolled in recursion loop");
      } else {
        const { toast } = await import("sonner");
        toast.error("Failed to enroll");
      }
    } catch {
      const { toast } = await import("sonner");
      toast.error("Failed to enroll");
    } finally {
      setRecursionPending(false);
    }
  };

  // Merge optimistic entry at the top for display
  const displayHistory = optimisticEntry ? [optimisticEntry, ...history] : history;

  return (
    <div className="rounded-lg border bg-card">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <h3 className="font-semibold text-sm shrink-0">Eval Runs</h3>

        {/* Inline feedback message */}
        {evalResult && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{evalResult.message}</span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {showRunEvalButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunEval}
              disabled={evalButtonDisabled}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Running…
                </>
              ) : (
                "Run Eval"
              )}
            </Button>
          )}

          {showRecursionButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnrollRecursion}
              disabled={recursionPending}
            >
              {recursionPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Enrolling…
                </>
              ) : (
                "Recursion"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Summary</th>
              <th className="px-4 py-2 text-left font-medium">Score</th>
              <th className="px-4 py-2 text-left font-medium">Stakwork</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && history.length === 0 && !optimisticEntry ? (
              <>
                {[0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td className="px-4 py-3" colSpan={4}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              </>
            ) : displayHistory.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No runs yet.
                </td>
              </tr>
            ) : (
              displayHistory.map((entry) => (
                <tr key={entry.triggerId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {entry.createdAt
                      ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <SummaryCell entry={entry} />
                  </td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    {entry.output?.score != null
                      ? `${Math.round(entry.output.score * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StakworkRunLink projectId={entry.projectId} isSuperAdmin={isSuperAdmin} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
