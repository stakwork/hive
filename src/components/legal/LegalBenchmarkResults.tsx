"use client";

import React, { useState, useMemo } from "react";
import { Loader2, AlertCircle, Copy, Download, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import { useProposedFixes } from "@/hooks/useProposedFixes";
import { useWorkspace } from "@/hooks/useWorkspace";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { ProposedFixCard } from "@/components/legal/ProposedFixCard";
import { EvalRunsBox } from "@/components/legal/EvalRunsBox";

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
    accept: acceptFix,
    reject: rejectFix,
    pendingRefIds,
  } = useProposedFixes(runId);

  const allPass = run?.runnerRun?.result?.all_pass;
  const criteriaResults = run?.runnerRun?.result?.criteria_results;

  const [isOpen, setIsOpen] = useState<boolean>(!allPass);
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedFiltered = useMemo(() => {
    if (!criteriaResults || criteriaResults.length === 0) return [];
    const q = filterQuery.toLowerCase();
    const filtered = q
      ? criteriaResults.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q) ||
            c.reasoning.toLowerCase().includes(q),
        )
      : criteriaResults;
    return [...filtered].sort((a, b) => {
      const aPass = a.verdict.toLowerCase() === "pass";
      const bPass = b.verdict.toLowerCase() === "pass";
      if (aPass === bPass) return 0;
      return aPass ? 1 : -1; // failed first
    });
  }, [criteriaResults, filterQuery]);

  const handleCopy = () => {
    if (run?.runnerOutputText) {
      navigator.clipboard.writeText(run.runnerOutputText);
    }
  };

  const handleCopyRubric = () => {
    if (!criteriaResults || criteriaResults.length === 0) return;
    const sanitize = (s: string) => s.replace(/\t/g, " ").replace(/[\n\r]/g, " ");
    const header = "Verdict\tID\tTitle\tReasoning";
    const rows = criteriaResults.map(
      (c) => `${sanitize(c.verdict)}\t${sanitize(c.id)}\t${sanitize(c.title)}\t${sanitize(c.reasoning)}`
    );
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
      <div className="mt-6 rounded-lg border bg-card p-4">
        {renderStaleWarning()}
        <SpinnerMessage message="Running task… (document ingestion & analysis)" />
        <StakworkRunLink projectId={run.runnerRun.projectId} isSuperAdmin={isSuperAdmin} />
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
    const nPassed = result?.n_passed;
    const nTotal = result?.n_total;
    const hasScore = typeof allPass === "boolean";
    const hasCriteriaResults = Array.isArray(criteriaResults) && criteriaResults.length > 0;
    const failedCount = criteriaResults?.filter((c) => c.verdict.toLowerCase() !== "pass").length ?? 0;

    // Criteria that failed AND have not yet been evaluated (no cause_type)
    const unevaluatedFailedCount =
      criteriaResults?.filter(
        (c) => c.verdict.toLowerCase() !== "pass" && !c.cause_type,
      ).length ?? 0;
    const showRunEvalButton = unevaluatedFailedCount > 0;

    return (
      <div className="mt-6 space-y-6">
        {renderStaleWarning()}

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
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">Score Summary</h3>
          </div>
          {hasScore ? (
            <div className="px-4 py-4 flex items-center gap-4">
              {nPassed !== undefined && nTotal !== undefined && (
                <span className="text-sm font-medium">
                  {nPassed}/{nTotal} criteria passed
                </span>
              )}
              <Badge
                variant="outline"
                className={
                  allPass
                    ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                    : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                }
              >
                {allPass ? "PASS" : "FAIL"}
              </Badge>
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
                      Rubric Details ({failedCount} failed / {criteriaResults!.length} total)
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
                    placeholder="Filter by ID, title, or keyword…"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="divide-y">
                  {sortedFiltered.map((criterion) => {
                    const isPass = criterion.verdict.toLowerCase() === "pass";
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
                                isPass
                                  ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 shrink-0"
                                  : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 shrink-0"
                              }
                            >
                              {criterion.verdict}
                            </Badge>
                            <code className="text-xs text-muted-foreground shrink-0">{criterion.id}</code>
                            <span className="truncate">{criterion.title}</span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground bg-muted/20">
                            {criterion.reasoning}
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

        {/* Proposed Fixes */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">Proposed Fixes</h3>
            <Button size="sm" variant="ghost" onClick={refetchFixes} aria-label="Refresh proposed fixes">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="p-4">
            {fixesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>Loading fix proposals…</span>
              </div>
            ) : fixes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fix proposals for this run yet.</p>
            ) : (
              <div className="space-y-3">
                {fixes.map((fix, i) => (
                  <ProposedFixCard
                    key={fix.ref_id ?? fix.criterion_id ?? i}
                    fix={fix}
                    onAccept={acceptFix}
                    onReject={rejectFix}
                    isPending={fix.ref_id ? pendingRefIds.has(fix.ref_id) : false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Eval Runs history table — Run Eval button lives here */}
        <EvalRunsBox
          taskSlug={run.taskSlug}
          runId={run.id}
          isSuperAdmin={isSuperAdmin}
          showRunEvalButton={showRunEvalButton}
          showRecursionButton={slug === "openlaw" && unevaluatedFailedCount > 0}
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
