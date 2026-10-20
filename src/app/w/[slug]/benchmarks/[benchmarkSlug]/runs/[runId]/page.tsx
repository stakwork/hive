"use client";

import Link from "next/link";
import { use } from "react";
import { FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { RunDetail } from "@/components/benchmarks/RunDetail";
import { useBenchmarkRun } from "@/hooks/useBenchmarks";
import { useWorkspace } from "@/hooks/useWorkspace";
import { benchmarkVisibleIn, getBenchmark } from "@/lib/benchmarks/registry";

export default function BenchmarkRunPage({ params }: { params: Promise<{ benchmarkSlug: string; runId: string }> }) {
  const { benchmarkSlug, runId } = use(params);
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const { run, loading, error } = useBenchmarkRun(workspace?.slug, benchmarkSlug, runId);

  if (workspaceLoading) return null;
  const benchmark = getBenchmark(benchmarkSlug);
  if (!workspace || !benchmark || !benchmarkVisibleIn(benchmark, workspace.slug)) notFound();

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader icon={FlaskConical} title={`${benchmark.name} run`} description={runId} />
      <div className="p-4 space-y-3">
        <Link href={`/w/${workspace.slug}/benchmarks/${benchmarkSlug}`} className="text-sm underline">
          ← All runs
        </Link>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {run && <RunDetail workspaceSlug={workspace.slug} benchmarkSlug={benchmarkSlug} run={run} />}
      </div>
    </div>
  );
}
