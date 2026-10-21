"use client";

import Link from "next/link";
import { use } from "react";
import { FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BenchmarkApp } from "@/components/benchmarks/BenchmarkApp";
import { ScoreChart } from "@/components/benchmarks/ScoreChart";
import { StartRun } from "@/components/benchmarks/StartRun";
import { useBenchmarkRuns } from "@/hooks/useBenchmarks";
import { useWorkspace } from "@/hooks/useWorkspace";
import { benchmarkVisibleIn, getBenchmark } from "@/lib/benchmarks/registry";

export default function BenchmarkPage({ params }: { params: Promise<{ benchmarkSlug: string }> }) {
  const { benchmarkSlug } = use(params);
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const benchmark = getBenchmark(benchmarkSlug);
  // A benchmark with an app lists its runs in the app, not here.
  const slug = benchmark?.app ? undefined : workspace?.slug;
  const { runs, loading, error, reload } = useBenchmarkRuns(slug, benchmarkSlug);

  if (workspaceLoading) return null;
  if (!workspace || !benchmark || !benchmarkVisibleIn(benchmark, workspace.slug)) notFound();

  if (benchmark.app) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={FlaskConical} title={benchmark.name} description={`Runs of ${benchmark.runWorkflow}`} />
        <BenchmarkApp workspaceSlug={workspace.slug} benchmarkSlug={benchmarkSlug} title={benchmark.name} className="flex-1 min-h-0 m-4" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader icon={FlaskConical} title={benchmark.name} description={`Runs of ${benchmark.runWorkflow}`} />
      <div className="p-4 space-y-6">
        <StartRun slug={workspace.slug} benchmarkSlug={benchmarkSlug} hasTaskList={!!benchmark.listWorkflow} onStarted={reload} />
        <ScoreChart runs={runs} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/w/${workspace.slug}/benchmarks/${benchmarkSlug}/runs/${r.id}`}>
                    <Badge variant={r.status === "SUCCESS" ? "default" : r.status === "PENDING" ? "secondary" : "destructive"}>{r.status}</Badge>
                  </Link>
                </TableCell>
                <TableCell>{r.taskId ?? "—"}</TableCell>
                <TableCell className="tabular-nums">
                  {r.score ?? "—"}
                  {r.metric ? <span className="text-muted-foreground"> {r.metric}</span> : null}
                  {r.officialScore !== null ? <span className="text-muted-foreground"> ({r.officialScore})</span> : null}
                </TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {!loading && runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No runs yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
