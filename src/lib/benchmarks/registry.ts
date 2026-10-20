/**
 * The generic benchmark registry. A benchmark is a strut workflow (plus an
 * optional task-list workflow) whose run output follows the rendering
 * convention in `./render`. Adding a benchmark = adding an entry here; no
 * schema change, no strut change.
 */

import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";

export interface Benchmark {
  /** URL segment and the suffix of the `StrutRun.kind` (`benchmark:<slug>`). */
  slug: string;
  name: string;
  /** Strut workflow returning `[{ id, title, ... }]` (or `{ tasks: [...] }`). Absent → free-form params. */
  listWorkflow?: string;
  /** Strut workflow launched with `{ taskId, ...params }`. */
  runWorkflow: string;
  /**
   * A named strut peer to run on. Declared for the registry shape; launches
   * go to the workspace's own swarm today (as OpenHealth does), so no
   * entry sets it and the dispatcher does not read it yet.
   */
  peer?: string;
  /**
   * How a launch's workflow input is built. Without `fromTask` the input is
   * `{ taskId, ...params }`. With it, the selected task is resolved
   * server-side from the list workflow and the input is
   * `{ ...defaults, ...mapped task fields, ...params }` (params win; no
   * `taskId` key — the key mapped from `"id"` identifies the task).
   */
  input?: {
    /** Input to the list workflow (e.g. a split). */
    listInput?: Record<string, unknown>;
    /** Workflow-input key → dotted path in the listed task (`"id"`, `"task"`, `"a.b"`). A missing field is skipped. */
    fromTask?: Record<string, string>;
    /** Constant defaults; string values may use `{field}` templates over the listed task (`"gt-{id}"`). */
    defaults?: Record<string, unknown>;
  };
  /** Output keys (any depth) never shown in the JSON tree. */
  denyKeys?: string[];
  /** Workspace slugs allowed to see this benchmark; absent → every workspace. */
  workspaceSlugs?: readonly string[];
}

export const BENCHMARKS: readonly Benchmark[] = [
  {
    slug: "openhealth",
    name: "OpenHealth",
    listWorkflow: "openhealth-list-tasks",
    runWorkflow: "openhealth-run",
    // Mirrors the OpenHealth runs route: { gtId, task, workdir: `gt-${gtId}` }
    // for a task of the default (public / patient_diagnosis) catalogue.
    input: {
      listInput: { split: "public", task: "patient_diagnosis" },
      fromTask: { gtId: "id", task: "task" },
      defaults: { task: "patient_diagnosis", workdir: "gt-{id}" },
    },
    workspaceSlugs: OPENHEALTH_SLUGS,
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
