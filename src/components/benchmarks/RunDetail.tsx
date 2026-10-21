"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { BenchmarkApp } from "@/components/benchmarks/BenchmarkApp";
import { JsonTree } from "@/components/benchmarks/JsonTree";
import { getBenchmark } from "@/lib/benchmarks/registry";
import { BENCHMARK_RUN_VIEWS } from "@/lib/benchmarks/views";
import type { BenchmarkRunDetail } from "@/types/benchmarks";

/** The generic run view; a registered custom view replaces it, and a benchmark's strut app (`Benchmark.app`) replaces both. */
export function RunDetail({ workspaceSlug, benchmarkSlug, run }: { workspaceSlug: string; benchmarkSlug: string; run: BenchmarkRunDetail }) {
  const benchmark = getBenchmark(benchmarkSlug);
  if (benchmark?.app) {
    // The app opened on this run (`ui/notifications/tool-input`), by strut's own id for it.
    const toolInput = run.strutRunId ? { runId: run.strutRunId, workflow: benchmark.runWorkflow } : undefined;
    return <BenchmarkApp workspaceSlug={workspaceSlug} benchmarkSlug={benchmarkSlug} title={benchmark.name} toolInput={toolInput} className="flex-1 min-h-0" />;
  }
  const Custom = BENCHMARK_RUN_VIEWS[benchmarkSlug];
  if (Custom) return <Custom workspaceSlug={workspaceSlug} benchmarkSlug={benchmarkSlug} run={run} />;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant={run.status === "SUCCESS" ? "default" : run.status === "PENDING" ? "secondary" : "destructive"}>{run.status}</Badge>
        {run.taskId !== null && <span className="text-sm text-muted-foreground">Task {String(run.taskId)}</span>}
        <span className="text-sm text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
        {run.parentRunId && (
          <Link
            className="text-sm underline"
            href={`/w/${workspaceSlug}/benchmarks/${benchmarkSlug}/runs/${run.parentRunId}`}
          >
            Parent run
          </Link>
        )}
      </div>

      {run.error && <p className="text-sm text-destructive">{run.error}</p>}

      {run.score !== null && (
        <div className="flex items-baseline gap-4">
          <span className="text-4xl font-semibold tabular-nums">{run.score}</span>
          {run.metric && <span className="text-muted-foreground">{run.metric}</span>}
          {run.officialScore !== null && (
            <span className="text-sm text-muted-foreground">
              official: <span className="tabular-nums text-foreground">{run.officialScore}</span>
            </span>
          )}
        </div>
      )}

      {run.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownRenderer>{run.summary}</MarkdownRenderer>
          </CardContent>
        </Card>
      )}

      {run.artifacts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {run.artifacts.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm underline">
                <ExternalLink className="h-3 w-3" />
                {a.name}
                {a.kind && <Badge variant="outline">{a.kind}</Badge>}
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      {run.params && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Params</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonTree value={run.params} />
          </CardContent>
        </Card>
      )}

      {(run.extra.value !== null || run.extra.truncated) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Output</CardTitle>
          </CardHeader>
          <CardContent>
            {run.extra.truncated ? (
              <p className="text-sm text-muted-foreground">Output truncated ({Math.round((run.extra.bytes ?? 0) / 1024)} KB is too large to show).</p>
            ) : (
              <JsonTree value={run.extra.value} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
