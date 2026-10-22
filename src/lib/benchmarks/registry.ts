/**
 * The benchmark registry: a benchmark is a strut workflow whose runs hive
 * records as `StrutRun` rows of kind `benchmark:<slug>`. Today it holds the
 * Legal Benchmarks' Harvey LAB runs (`services/strut-runs/legal-benchmark`);
 * a benchmark with its own UI is a strut app the workspace pins as a tab.
 */

import { LEGAL_STRUT_SLUGS } from "@/lib/eval-capture-slugs";

export interface Benchmark {
  /** The suffix of the `StrutRun.kind` (`benchmark:<slug>`). */
  slug: string;
  name: string;
  /** Strut workflow a run launches. */
  runWorkflow: string;
  /** The launch-input key that names the task. Default: `taskId`. */
  taskIdKey?: string;
  /** Workspace slugs allowed to see this benchmark; absent → every workspace. */
  workspaceSlugs?: readonly string[];
}

export const BENCHMARKS: readonly Benchmark[] = [
  {
    slug: "harvey-lab",
    name: "Legal (Harvey LAB)",
    // Launched by the Legal Benchmarks page (`legal/benchmarks/strut/run`),
    // which builds the task input from hive's Harvey LAB catalogue.
    runWorkflow: "harvey-lab-run",
    taskIdKey: "task_slug",
    workspaceSlugs: LEGAL_STRUT_SLUGS,
  },
];

export const BENCHMARK_KIND_PREFIX = "benchmark";

export const benchmarkKind = (slug: string) => `${BENCHMARK_KIND_PREFIX}:${slug}`;

export function getBenchmark(slug: string): Benchmark | null {
  return BENCHMARKS.find((b) => b.slug === slug) ?? null;
}

/** Is the benchmark visible in this workspace? */
export function benchmarkVisibleIn(benchmark: Benchmark, workspaceSlug: string): boolean {
  return !benchmark.workspaceSlugs || benchmark.workspaceSlugs.includes(workspaceSlug);
}

/** The launch-input key that names a benchmark's task. */
export const taskIdKey = (benchmark: Pick<Benchmark, "taskIdKey">): string => benchmark.taskIdKey ?? "taskId";
