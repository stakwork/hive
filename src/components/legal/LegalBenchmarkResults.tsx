"use client";

import React from "react";
import { Loader2, AlertCircle, Copy, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import type { RubricScore } from "@/types/legal";

interface LegalBenchmarkResultsProps {
  runId: string;
  onReset: () => void;
}

function SpinnerMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function LegalBenchmarkResults({ runId, onReset }: LegalBenchmarkResultsProps) {
  const { run, isLoading, isStale, refetch } = useLegalBenchmarkRun(runId);

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

  if (run.status === "PENDING" || run.status === "RUNNING") {
    return (
      <div className="mt-6 rounded-lg border bg-card p-4">
        {renderStaleWarning()}
        <SpinnerMessage message="Running task… (document ingestion & analysis)" />
      </div>
    );
  }

  if (run.status === "SCORING") {
    return (
      <div className="mt-6 rounded-lg border bg-card p-4">
        {renderStaleWarning()}
        <SpinnerMessage message="Scoring output against rubric…" />
      </div>
    );
  }

  if (run.status === "FAILED") {
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

  if (run.status === "COMPLETE") {
    let scores: RubricScore[] = [];
    try {
      scores = run.scoreJson ? JSON.parse(run.scoreJson) : [];
    } catch {
      scores = [];
    }
    const passCount = scores.filter((s) => s.pass).length;

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

        {/* Rubric scores section */}
        <div className="rounded-lg border bg-card">
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">Rubric Scores</h3>
          </div>
          {scores.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Criterion</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">Result</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((score, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-3">{score.criterion}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              score.pass
                                ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                            }
                          >
                            {score.pass ? "PASS" : "FAIL"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{score.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{passCount} / {scores.length}</span> criteria passed
              </div>
            </>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No rubric scores available.
            </div>
          )}
        </div>

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
