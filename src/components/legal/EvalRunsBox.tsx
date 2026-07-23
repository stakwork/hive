"use client";

import React, { useState, useRef, useEffect } from "react";
import { Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalBenchmarkEval, type EvalResult } from "@/hooks/useLegalBenchmarkEval";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ProposedFix } from "@/types/legal";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";

interface EvalRunsBoxProps {
  /** The task slug identifying which task's eval runs to show */
  taskSlug: string;
  /** The run ID used to dispatch new evals and guard Pusher events */
  runId: string;
  /** Parent decides based on role/feature flags — hides the Run Eval button when false */
  showRunEvalButton: boolean;
  /** When true, shows the Recursion enroll button alongside Run Eval */
  showRecursionButton?: boolean;
  /** ProposedFix nodes threaded down from the parent (via useProposedFixes) */
  fixes?: ProposedFix[];
  /** Loading state from the parent's useProposedFixes call */
  isLoading?: boolean;
  /** Refetch callback from the parent's useProposedFixes call */
  refetch?: () => void;
  /** Whether the current user is a super admin — gates the entire Stakwork column */
  isSuperAdmin?: boolean;
}

function StatusBadge({ status }: { status?: string | null }) {
  if (status === "accepted") {
    return (
      <Badge className="border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        Accepted
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Pending
    </Badge>
  );
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function scoreDisplay(fix: ProposedFix): string {
  const hasBefore = fix.before_score != null && fix.before_score !== "";
  const hasAfter  = fix.after_score  != null && fix.after_score  !== "";
  if (hasBefore && hasAfter) return `${fix.before_score} → ${fix.after_score}`;
  return fix.score_delta ?? "—";
}

/** Sort: unresolved (null resolved_at) first, then resolved newest-first */
function sortFixes(fixes: ProposedFix[]): ProposedFix[] {
  return [...fixes].sort((a, b) => {
    if (a.resolved_at == null && b.resolved_at == null) return 0;
    if (a.resolved_at == null) return -1;
    if (b.resolved_at == null) return 1;
    return new Date(b.resolved_at).getTime() - new Date(a.resolved_at).getTime();
  });
}

export function EvalRunsBox({
  taskSlug,
  runId,
  showRunEvalButton,
  showRecursionButton = false,
  fixes = [],
  isLoading = false,
  refetch = () => {},
  isSuperAdmin = false,
}: EvalRunsBoxProps) {
  const { workspace } = useWorkspace();
  const { runEval, isSubmitting } = useLegalBenchmarkEval();
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [optimisticEntry, setOptimisticEntry] = useState<boolean>(false);
  const [recursionPending, setRecursionPending] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const activeProjectIdRef = useRef<number | null>(null);
  const fixesLengthAtLaunchRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setOptimisticEntry(false);
    }, 3 * 60 * 1000);
  };

  // Primary completion detection: Pusher (mirrors useLegalBenchmarkRun pattern)
  useEffect(() => {
    if (!workspace?.slug) return;
    const pusher = getPusherClient();
    const channel = pusher.subscribe(getWorkspaceChannelName(workspace.slug));
    channel.bind(
      PUSHER_EVENTS.STAKWORK_RUN_UPDATE,
      (data: { type: string; runId: string; status: string }) => {
        if (
          data.type === "LEGAL_BENCHMARK_EVAL" &&
          data.runId === runId &&
          ["COMPLETED", "FAILED", "ERROR", "HALTED"].includes(data.status)
        ) {
          stopPolling();
          setOptimisticEntry(false);
          refetch();
        }
      },
    );
    return () => { channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE); };
  }, [workspace?.slug, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback completion detection: new ProposedFix nodes arrived
  useEffect(() => {
    if (!optimisticEntry) return;
    if (fixes.length > fixesLengthAtLaunchRef.current) {
      stopPolling();
      setOptimisticEntry(false);
    }
  }, [fixes, optimisticEntry]);

  // Unmount cleanup
  useEffect(() => () => stopPolling(), []);

  const handleRunEval = async () => {
    const result = await runEval(runId);
    setEvalResult(result);
    if (result.status === "started") {
      activeProjectIdRef.current = result.projectId ?? null;
      fixesLengthAtLaunchRef.current = fixes.length;
      setOptimisticEntry(true);
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
      const res = await fetch(
        `/api/workspaces/${workspace?.slug}/legal/benchmarks/recursion/enable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskSlug }),
        },
      );
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

  const sorted = sortFixes(fixes);

  return (
    <div className="rounded-lg border bg-card">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <h3 className="font-semibold text-sm shrink-0">Eval Runs</h3>

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
              <th className="px-4 py-2 text-left font-medium">Criterion</th>
              <th className="px-4 py-2 text-left font-medium">Prompt</th>
              <th className="px-4 py-2 text-left font-medium">Change</th>
              <th className="px-4 py-2 text-left font-medium">Score</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              {isSuperAdmin && (
                <th className="px-4 py-2 text-left font-medium">Stakwork</th>
              )}
              <th className="px-4 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && fixes.length === 0 && !optimisticEntry ? (
              <>
                {[0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td className="px-4 py-3" colSpan={isSuperAdmin ? 7 : 6}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              </>
            ) : sorted.length === 0 && !optimisticEntry ? (
              <tr>
                <td colSpan={isSuperAdmin ? 7 : 6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No eval results yet.
                </td>
              </tr>
            ) : (
              <>
                {optimisticEntry && (
                  <tr>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        Evaluating…
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3">
                        <StakworkRunLink
                          projectId={activeProjectIdRef.current}
                          isSuperAdmin={isSuperAdmin}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3" />
                  </tr>
                )}
                {sorted.map((fix) => {
                  const key = fix.ref_id ?? fix.criterion_id ?? String(Math.random());
                  const isExpanded = expandedKey === key;
                  return (
                    <React.Fragment key={key}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          {fix.criterion_title ?? fix.criterion_id ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {fix.prompt_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-xs">
                          {truncate(fix.delta, 80)}
                        </td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                          {scoreDisplay(fix)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={fix.eval_status ?? fix.status} />
                        </td>
                        {isSuperAdmin && (
                          <td className="px-4 py-3">
                            <StakworkRunLink projectId={fix.project_id ?? null} isSuperAdmin={isSuperAdmin} />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpandedKey(isExpanded ? null : key)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={isSuperAdmin ? 7 : 6} className="px-4 py-3 text-sm space-y-2">
                            {fix.passing_value != null && (
                              <div>
                                <p className="font-medium text-xs text-muted-foreground mb-1">
                                  Proposed Prompt
                                </p>
                                <p className="whitespace-pre-wrap">{fix.passing_value}</p>
                              </div>
                            )}
                            {fix.failing_value != null && (
                              <div>
                                <p className="font-medium text-xs text-muted-foreground mb-1">
                                  Previous Prompt
                                </p>
                                <p className="whitespace-pre-wrap">{fix.failing_value}</p>
                              </div>
                            )}
                            {fix.reasoning != null && (
                              <div>
                                <p className="font-medium text-xs text-muted-foreground mb-1">
                                  Reasoning
                                </p>
                                <p className="whitespace-pre-wrap">{fix.reasoning}</p>
                              </div>
                            )}
                            {fix.resolved_at != null && (
                              <p className="text-xs text-muted-foreground">
                                Resolved by {fix.resolved_by} on {fix.resolved_at}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
