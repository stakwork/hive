"use client";

import React, { useState, useMemo } from "react";
import { Loader2, AlertCircle, Copy, Download, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";

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
  const { run, isLoading, isStale, refetch } = useLegalBenchmarkRun(runId);

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
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full px-4 py-3 border-b text-left hover:bg-muted/40 transition-colors">
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

        <div className="flex justify-end">
          <Button variant="outline" onClick={onReset}>
            Run again
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
