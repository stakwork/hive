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
import { compareFixRows } from "@/lib/harvey-lab/fix-sort";

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
  /** Accept a proposed fix by ref_id */
  accept?: (refId: string) => Promise<void>;
  /** Reject a proposed fix by ref_id */
  reject?: (refId: string) => Promise<void>;
  /** Set of refIds currently being processed (guards double-submission) */
  pendingRefIds?: Set<string>;
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
    // Primary: unresolved (null resolved_at) first, then resolved newest-first
    const aUnresolved = a.resolved_at == null;
    const bUnresolved = b.resolved_at == null;
    if (aUnresolved && !bUnresolved) return -1;
    if (!aUnresolved && bUnresolved) return 1;
    if (!aUnresolved && !bUnresolved) {
      const byTime = new Date(b.resolved_at!).getTime() - new Date(a.resolved_at!).getTime();
      if (byTime !== 0) return byTime;
    }
    // Secondary: deterministic tiebreak (target_name → criterion_id → ref_id)
    return compareFixRows(a, b);
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
  accept,
  reject,
  pendingRefIds = new Set(),
}: EvalRunsBoxProps) {
  const { workspace } = useWorkspace();
  const { runEval, isSubmitting } = useLegalBenchmarkEval();
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [optimisticEntry, setOptimisticEntry] = useState<boolean>(false);
  const [recursionPending, setRecursionPending] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    action: "accept" | "reject";
    fix: ProposedFix;
  } | null>(null);

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

  const handleAction = async (action: "accept" | "reject", fix: ProposedFix) => {
    const effectiveStatus = fix.eval_status ?? fix.status;
    const isConceptFix = (fix.target_type ?? fix.fix_type ?? "").trim().toLowerCase() === "concept";

    if (action === "reject" && effectiveStatus === "accepted" && isConceptFix) {
      // Show confirmation for rejecting auto-accepted concept fix
      setConfirmDialog({ action, fix });
      return;
    }

    if (!fix.ref_id) return;
    try {
      if (action === "accept") {
        await accept?.(fix.ref_id);
      } else {
        await reject?.(fix.ref_id);
      }
      // Single refetch after action (not per-mutation)
      refetch();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        const { toast } = await import("sonner");
        toast.error("Too many requests — please try again in a moment.", { description: "Rate limit reached." });
      }
    }
  };

  const handleConfirmedAction = async () => {
    if (!confirmDialog) return;
    const { action, fix } = confirmDialog;
    setConfirmDialog(null);
    if (!fix.ref_id) return;
    try {
      if (action === "reject") {
        await reject?.(fix.ref_id);
      }
      refetch();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        const { toast } = await import("sonner");
        toast.error("Too many requests — please try again in a moment.");
      }
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
              <th className="px-4 py-2 text-left font-medium">Actions</th>
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
                    <td className="px-4 py-3" colSpan={isSuperAdmin ? 8 : 7}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              </>
            ) : sorted.length === 0 && !optimisticEntry ? (
              <tr>
                <td colSpan={isSuperAdmin ? 8 : 7} className="px-4 py-6 text-center text-sm text-muted-foreground">
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
                    <td className="px-4 py-3" />
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
                {sorted.map((fix, index) => {
                  const key = fix.ref_id ?? `${fix.target_name ?? ""}:${fix.criterion_id ?? ""}:${index}`;
                  const isExpanded = expandedKey === key;
                  return (
                    <React.Fragment key={key}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span>{fix.criterion_title ?? fix.criterion_id ?? fix.target_name ?? "—"}</span>
                            {fix.target_type && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 px-1 h-4 text-muted-foreground border-muted-foreground/40 shrink-0"
                                data-testid={`fix-kind-badge-${fix.ref_id ?? "unknown"}`}
                              >
                                {fix.target_type.toLowerCase()}
                              </Badge>
                            )}
                          </div>
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
                        <td className="px-4 py-3">
                          {(() => {
                            const effectiveStatus = fix.eval_status ?? fix.status;
                            const isConceptFix = (fix.target_type ?? fix.fix_type ?? "").trim().toLowerCase() === "concept";
                            const isPending = pendingRefIds.has(fix.ref_id ?? "");

                            if (effectiveStatus === "rejected" || !fix.ref_id) return null;

                            if (effectiveStatus === "accepted") {
                              // Only concept fixes can be rejected after auto-accept
                              if (!isConceptFix) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAction("reject", fix)}
                                  disabled={isPending}
                                  className="text-xs h-7 px-2"
                                  data-testid={`fix-reject-btn-${fix.ref_id}`}
                                >
                                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject"}
                                </Button>
                              );
                            }

                            // Pending fix: show both Accept and Reject
                            if (effectiveStatus === "pending" || effectiveStatus == null) {
                              return (
                                <div className="flex gap-1">
                                  {accept && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleAction("accept", fix)}
                                      disabled={isPending}
                                      className="text-xs h-7 px-2"
                                      data-testid={`fix-accept-btn-${fix.ref_id}`}
                                    >
                                      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Accept"}
                                    </Button>
                                  )}
                                  {reject && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleAction("reject", fix)}
                                      disabled={isPending}
                                      className="text-xs h-7 px-2 text-destructive hover:text-destructive"
                                      data-testid={`fix-reject-btn-${fix.ref_id}`}
                                    >
                                      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject"}
                                    </Button>
                                  )}
                                </div>
                              );
                            }

                            return null;
                          })()}
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
                          <td colSpan={isSuperAdmin ? 8 : 7} className="px-4 py-3 text-sm space-y-2">
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

      {/* Confirmation dialog for rejecting an auto-accepted concept fix */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          data-testid="reject-confirm-dialog"
        >
          <div className="bg-card rounded-lg border shadow-lg p-6 max-w-sm mx-4 space-y-4">
            <h3 id="confirm-dialog-title" className="font-semibold text-sm">
              Reject this concept fix?
            </h3>
            <p className="text-sm text-muted-foreground">
              This records a review decision and does{" "}
              <strong>not</strong> undo the workflow&apos;s already-applied graph
              write. The concept change remains in the knowledge graph.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDialog(null)}
                data-testid="reject-confirm-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmedAction}
                data-testid="reject-confirm-confirm"
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
