"use client";

import React, { useState, useMemo } from "react";
import { Loader2, AlertCircle, Copy, Download, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import { useProposedFixes } from "@/hooks/useProposedFixes";
import { useWorkspace } from "@/hooks/useWorkspace";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { EvalRunsBox } from "@/components/legal/EvalRunsBox";
import { BenchmarkRunAgentLogs } from "@/components/legal/BenchmarkRunAgentLogs";
import { BenchmarkRunCascade } from "@/components/legal/RunCascade";
import { resolveJudgeDispute, resolveContestReason } from "@/lib/harvey-lab/eval-normalizers";
import { CriterionMarkers } from "@/components/run-report/CriterionMarkers";
import { useBenchmarkRubrics } from "@/hooks/useBenchmarkRubrics";
import {
  buildContestedIndex,
  computeBenchmarkScore,
  criterionStatus,
  formatBenchmarkScore,
  contestedOriginIndex,
  contestedOrigin,
  contestedOriginToken,
} from "@/lib/harvey-lab/rubric-scoring";
import { contestedNotice } from "@/lib/harvey-lab/contested-copy";

/** Strip provider prefix for display, e.g. "anthropic/claude-sonnet-5" → "claude-sonnet-5" */
function displayModelName(value: string | undefined): string {
  if (!value) return "—";
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

interface LegalBenchmarkResultsProps {
  runId: string;
  onReset: () => void;
  isSuperAdmin?: boolean;
}

function SpinnerMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function LegalBenchmarkResults({ runId, onReset, isSuperAdmin = false }: LegalBenchmarkResultsProps) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug ?? "";
  const { run, isLoading, isStale, refetch } = useLegalBenchmarkRun(runId);
  const {
    fixes,
    isLoading: fixesLoading,
    refetch: refetchFixes,
  } = useProposedFixes(runId);

  const allPass = run?.runnerRun?.result?.all_pass;
  const criteriaResults = run?.runnerRun?.result?.criteria_results;

  // Graph rubric roster — the source of truth for the score denominator and
  // contested definitions. Null (no roster / still loading) falls back to
  // run-local scoring.
  const { rubrics: graphRubrics } = useBenchmarkRubrics(run?.taskSlug);
  const contestedIndex = useMemo(() => buildContestedIndex(graphRubrics), [graphRubrics]);
  // Origin index: separates id vs title matches for provenance-aware copy.
  // Built alongside contestedIndex; never touches scoring paths.
  const originIdx = useMemo(() => contestedOriginIndex(graphRubrics), [graphRubrics]);

  const [isOpen, setIsOpen] = useState<boolean>(!allPass);
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedFiltered = useMemo(() => {
    if (!criteriaResults || criteriaResults.length === 0) return [];
    const q = filterQuery.toLowerCase();
    const filtered = q
      ? criteriaResults.filter(
          (c) => {
            if (
              c.id?.toLowerCase().includes(q) ||
              c.title?.toLowerCase().includes(q) ||
              c.reasoning?.toLowerCase().includes(q) ||
              resolveJudgeDispute(c)?.displayText.toLowerCase().includes(q)
            ) return true;
            // Match both "contested" (existing) and the resolved chip label
            // e.g. "prior" / "prior contest" / "roster" for PRIOR CONTEST rows.
            if (criterionStatus(c, contestedIndex) === "CONTESTED") {
              if ("contested".includes(q)) return true;
              const originInfo = contestedOrigin(c, originIdx);
              if (originInfo) {
                const token = contestedOriginToken(originInfo);
                if (token) {
                  const { label } = contestedNotice({ origin: token });
                  if (label.toLowerCase().includes(q)) return true;
                }
              }
            }
            return false;
          },
        )
      : criteriaResults;
    // Review order: FAIL first, then CONTESTED, passes last.
    const rank = { FAIL: 0, CONTESTED: 1, PASS: 2 } as const;
    return [...filtered].sort(
      (a, b) =>
        rank[criterionStatus(a, contestedIndex)] - rank[criterionStatus(b, contestedIndex)],
    );
  }, [criteriaResults, filterQuery, contestedIndex, originIdx]);

  const handleCopy = () => {
    if (run?.runnerOutputText) {
      navigator.clipboard.writeText(run.runnerOutputText);
    }
  };

  const handleCopyRubric = () => {
    if (!sortedFiltered || sortedFiltered.length === 0) return;
    const sanitize = (s: string) => s.replace(/\t/g, " ").replace(/[\n\r]/g, " ");
    // Split into separate Disputed (boolean) and Judge Reason columns so
    // reviewers can distinguish a flagged dispute from a conceded note.
    // The existing `Contested` column stays unchanged (boolean "true"/"") so
    // any TSV consumer parsing it is unaffected. A new `Contest Origin` column
    // appended to the right carries the fine-grained origin token.
    const header = "Verdict\tID\tTitle\tReasoning\tDisputed\tJudge Reason\tContested\tContest Origin";
    const rows = sortedFiltered.map((c) => {
      const dispute = resolveJudgeDispute(c);
      const isContested = criterionStatus(c, contestedIndex) === "CONTESTED";
      let originTokenStr = "";
      if (isContested) {
        const originInfo = contestedOrigin(c, originIdx);
        if (originInfo) {
          originTokenStr = contestedOriginToken(originInfo) ?? "";
        }
      }
      return [
        sanitize(c.verdict),
        sanitize(c.id),
        sanitize(c.title),
        sanitize(c.reasoning),
        dispute?.isDispute ? "true" : "",
        sanitize(dispute?.displayText ?? ""),
        isContested ? "true" : "",
        originTokenStr,
      ].join("\t");
    });
    navigator.clipboard.writeText([header, ...rows].join("\n"));
  };

  const handleDownload = () => {
    if (!run?.runnerOutputText) return;
    const blob = new Blob([run.runnerOutputText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.taskSlug.replace(/\//g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && !run) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!run) return null;

  const renderStaleWarning = () => {
    if (!isStale) return null;
    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md mb-4 text-sm text-amber-800 dark:text-amber-200">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1">Taking longer than expected…</span>
        <Button size="sm" variant="outline" onClick={refetch} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>
    );
  };

  if (run.status === "running") {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-lg border bg-card p-4">
          {renderStaleWarning()}
          <SpinnerMessage message="Running task… (document ingestion & analysis)" />
          <StakworkRunLink projectId={run.runnerRun.projectId} isSuperAdmin={isSuperAdmin} />
        </div>
        {/* Live trace — rows appear as the agents work; the pill pops in once
            the run's first session exists. */}
        <div className="flex flex-wrap items-start gap-2 empty:hidden">
          <BenchmarkRunCascade runId={run.id} runStatus={run.runnerRun.status} />
        </div>
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <p className="font-medium text-destructive">Run failed</p>
            {run.errorMessage && (
              <p className="text-sm text-muted-foreground">{run.errorMessage}</p>
            )}
            <Button size="sm" variant="outline" onClick={onReset}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (run.status === "complete") {
    const result = run.runnerRun.result;
    // Graph-first score: the denominator comes from the task's EvalRequirement
    // roster (minus contested definitions) when available; contested criteria
    // are dropped from both sides of the score.
    const score = computeBenchmarkScore({
      criteriaResults,
      nPassed: result?.n_passed,
      nTotal: result?.n_total,
      graphRubrics,
    });
    const scoreDisplay = score ? formatBenchmarkScore(score) : null;
    const hasScore = score !== null || typeof allPass === "boolean";
    const hasCriteriaResults = Array.isArray(criteriaResults) && criteriaResults.length > 0;
    // Derive PASS/FAIL only when there is something to derive it FROM —
    // per-criterion results, a graph roster, or contested exclusions. A run
    // carrying only flat counts keeps the runner's own verdict.
    const displayAllPass =
      score && (hasCriteriaResults || score.source === "graph" || score.contested > 0)
        ? score.allPass
        : allPass;
    const failedCount =
      criteriaResults?.filter((c) => criterionStatus(c, contestedIndex) === "FAIL").length ?? 0;
    const contestedCount = score?.contested ?? 0;

    // Unified model display precedence
    const execModel = displayModelName(result?.requestedModel ?? result?.model);
    const judgeModel = displayModelName(result?.requestedJudgeModel ?? result?.judge_model);
    const isLegacyExec = !result?.requestedModel && !result?.model;
    const isLegacyJudge = !result?.requestedJudgeModel && !result?.judge_model;

    // Criteria that failed AND have not yet been evaluated (no cause_type).
    // Contested criteria are excluded — a broken definition is not a genuine
    // failure worth root-causing.
    const unevaluatedFailedCount =
      criteriaResults?.filter(
        (c) => criterionStatus(c, contestedIndex) === "FAIL" && !c.cause_type,
      ).length ?? 0;
    const showRunEvalButton = unevaluatedFailedCount > 0;

    return (
      <div className="mt-6 space-y-6">
        {renderStaleWarning()}

        {/* Pop-in pills that expand into panels: agent sessions and the
            session-cascade trace. Hidden entirely when a run has neither. */}
        <div className="flex flex-wrap items-start gap-2 empty:hidden">
          <BenchmarkRunAgentLogs runId={run.id} />
          <BenchmarkRunCascade runId={run.id} runStatus={run.runnerRun.status} />
        </div>

        {/* Output document section */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">Task Output</h3>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download .txt
              </Button>
            </div>
          </div>
          <div className="p-4">
            <pre className="text-sm whitespace-pre-wrap font-mono bg-muted rounded-md p-4 max-h-96 overflow-y-auto">
              {run.runnerOutputText ?? "(No output)"}
            </pre>
          </div>
        </div>

        {/* Aggregate score summary */}
        <div className="rounded-lg border bg-card">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-4">
            <h3 className="font-semibold text-sm">Score Summary</h3>
            {/* Model info — shown in header area */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <span className="font-medium">Model:</span>{" "}
                {isLegacyExec ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dashed border-muted-foreground/50">
                        —
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      This run predates model selection and used the prior hardcoded default.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  execModel
                )}
              </span>
              <span>
                <span className="font-medium">Judge:</span>{" "}
                {isLegacyJudge ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dashed border-muted-foreground/50">
                        —
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      This run predates model selection and used the prior hardcoded default.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  judgeModel
                )}
              </span>
            </div>
          </div>
          {hasScore ? (
            <div className="px-4 py-4 flex items-center gap-4">
              {scoreDisplay && (
                <span className="text-sm font-medium" data-testid="score-summary-line">
                  {scoreDisplay.headline} criteria passed
                </span>
              )}
              <Badge
                variant="outline"
                className={
                  displayAllPass
                    ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                    : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                }
              >
                {displayAllPass ? "PASS" : "FAIL"}
              </Badge>
              {scoreDisplay?.annotation && (
                <span
                  className="text-xs text-violet-700 dark:text-violet-400"
                  data-testid="score-contested-annotation"
                  title="Contested criteria are excluded from the score. The total is the task's rubric roster in the graph."
                >
                  {scoreDisplay.annotation}
                </span>
              )}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No score available.
            </div>
          )}
        </div>

        {/* Per-criterion Rubric Details — omitted when criteria_results is absent/empty */}
        {hasCriteriaResults && (
          <div className="rounded-lg border bg-card">
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
              <div className="flex items-center border-b">
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between flex-1 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                    <span className="font-semibold text-sm">
                      Rubric Details ({failedCount} failed / {criteriaResults!.length} total
                      {contestedCount > 0 ? ` · ${contestedCount} contested` : ""})
                    </span>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Copy rubric results"
                  onClick={(e) => { e.stopPropagation(); handleCopyRubric(); }}
                  className="mr-2 shrink-0"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <CollapsibleContent>
                <div className="px-4 pt-3 pb-2">
                  <Input
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Filter by ID, title, reasoning, dispute, contested, or prior contest…"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="divide-y">
                  {sortedFiltered.map((criterion) => {
                    const status = criterionStatus(criterion, contestedIndex);
                    // Resolve origin for contested criteria — drives badge label and note copy.
                    const originInfo = status === "CONTESTED"
                      ? contestedOrigin(criterion, originIdx)
                      : null;
                    const originToken = originInfo ? contestedOriginToken(originInfo) : null;
                    const chipNotice = originToken
                      ? contestedNotice({
                          origin: originToken,
                          verdict: criterion.verdict,
                          reason: resolveContestReason(criterion),
                          matchedBy: originInfo?.matchedBy,
                        })
                      : null;
                    // Badge label for the collapsed row: origin-aware when available,
                    // falls back to "CONTESTED" (today's behaviour) when not.
                    const contestedBadgeLabel = chipNotice?.label ?? "CONTESTED";
                    return (
                      <Collapsible
                        key={criterion.id}
                        open={expandedId === criterion.id}
                        onOpenChange={(open) => setExpandedId(open ? criterion.id : null)}
                      >
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors text-sm">
                            <Badge
                              className={
                                status === "CONTESTED"
                                  ? "border-0 bg-violet-500/15 text-violet-700 dark:text-violet-400 shrink-0"
                                  : status === "PASS"
                                    ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 shrink-0"
                                    : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 shrink-0"
                              }
                            >
                              {status === "CONTESTED" ? contestedBadgeLabel : criterion.verdict}
                            </Badge>
                            <code className="text-xs text-muted-foreground shrink-0">{criterion.id}</code>
                            <span className="truncate">{criterion.title}</span>
                            {(() => {
                              const d = resolveJudgeDispute(criterion);
                              return (
                                <CriterionMarkers
                                  disputed={d?.isDispute}
                                  flagBasis={d?.flagBasis}
                                  contested={status === "CONTESTED"}
                                  contestedOrigin={originToken ?? undefined}
                                  contestedReason={resolveContestReason(criterion)}
                                  contestedVerdict={criterion.verdict}
                                  contestedMatchedBy={originInfo?.matchedBy}
                                />
                              );
                            })()}
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="bg-muted/20">
                            <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
                              {criterion.reasoning}
                            </div>
                            {(() => {
                              const dispute = resolveJudgeDispute(criterion);
                              if (!dispute) return null;
                              return (
                                <div
                                  data-judge-dispute
                                  data-judge-state={dispute.isDispute ? "dispute" : "note"}
                                  className="mx-4 mb-3 border-l-2 border-amber-400/60 pl-3"
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">
                                    {dispute.isDispute ? "Judge Dispute" : "Judge Note"}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {dispute.displayText}
                                  </p>
                                </div>
                              );
                            })()}
                            {status === "CONTESTED" && (
                              <div
                                data-testid="criterion-contested-note"
                                data-contested-origin={originToken ?? undefined}
                                className="mx-4 mb-3 border-l-2 border-violet-500/40 pl-3"
                              >
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1">
                                  {originToken === "roster"
                                    ? "Prior Contest"
                                    : "Contested Definition"}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {chipNotice
                                    ? chipNotice.tooltip
                                    : "This criterion\u2019s definition is flagged as broken, so it is excluded from the score."}
                                </p>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* Eval Runs history table — Run Eval button lives here */}
        <EvalRunsBox
          taskSlug={run.taskSlug}
          runId={run.id}
          showRunEvalButton={showRunEvalButton}
          showRecursionButton={slug === "openlaw" && unevaluatedFailedCount > 0}
          fixes={fixes}
          isLoading={fixesLoading}
          refetch={refetchFixes}
          isSuperAdmin={isSuperAdmin}
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onReset}>
            Run again
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
