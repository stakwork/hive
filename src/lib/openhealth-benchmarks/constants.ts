/**
 * Shared constants for the OpenHealth Benchmarks feature: the strut
 * workflows it runs, the benchmark tasks and splits it offers, and the run
 * files it may serve.
 */

import type {
  OpenHealthArtifactName,
  OpenHealthBenchmark,
  OpenHealthBenchmarkTask,
  OpenHealthDifficulty,
  OpenHealthSplit,
  OpenHealthVariant,
} from "@/types/openhealth";

/** `StrutRun.kind` for a benchmark run. */
export const OPENHEALTH_RUN_KIND = "openhealth_benchmark";

/** `StrutRun.kind` for an improve run: one benchmark run's scoring errors → Concepts. */
export const OPENHEALTH_IMPROVE_RUN_KIND = "openhealth_improve";

/**
 * The improve workflow. It reads the benchmark run from strut's own run
 * store, so it is launched on the swarm that ran the benchmark.
 */
export const OPENHEALTH_IMPROVE_WORKFLOW = "openhealth-improve";

/**
 * `StrutRun.kind` for a climb: `openhealth-improve-loop`, which runs the
 * benchmark, improves on its errors, and runs it again until a run scores
 * the target or the runs are spent. One strut run; its steps are subflows.
 */
export const OPENHEALTH_CLIMB_RUN_KIND = "openhealth_climb";

export const OPENHEALTH_CLIMB_WORKFLOW = "openhealth-improve-loop";

/** Strut workflow name format. */
export const OPENHEALTH_STRUT_WORKFLOW_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME = "openhealth-run";

/** The catalogue workflow: returns the tasks of a split in under a second, at no cost. */
export const OPENHEALTH_LIST_TASKS_WORKFLOW = "openhealth-list-tasks";

/** The configured workflow name; the default when it is unset or not a workflow name. */
export function resolveOpenHealthStrutWorkflowName(): string {
  const raw = process.env.OPENHEALTH_STRUT_WORKFLOW_NAME?.trim();
  return raw && OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test(raw) ? raw : OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME;
}

/**
 * The splits the page offers. "train" (800 patients) is deliberately
 * excluded — it is not a benchmark and must never be listed or dispatched.
 */
export const OPENHEALTH_SPLITS = ["public", "heldout"] as const satisfies readonly OpenHealthSplit[];

export function isOpenHealthSplit(value: unknown): value is OpenHealthSplit {
  return typeof value === "string" && (OPENHEALTH_SPLITS as readonly string[]).includes(value);
}

export const OPENHEALTH_DEFAULT_SPLIT: OpenHealthSplit = "public";

export const OPENHEALTH_DIFFICULTIES = ["easy", "medium", "hard"] as const satisfies readonly OpenHealthDifficulty[];

export function isOpenHealthDifficulty(value: unknown): value is OpenHealthDifficulty {
  return typeof value === "string" && (OPENHEALTH_DIFFICULTIES as readonly string[]).includes(value);
}

// ─── Benchmark tasks ─────────────────────────────────────────────────────

/**
 * The tasks the page offers, as strut's `openhealth-run` takes them in
 * `input.task`. The benchmark's other two (`evidence_retrieval`,
 * `imaging_indication`) have no workflow path yet and are not listed.
 */
export const OPENHEALTH_TASKS = [
  "patient_diagnosis",
  "context_summarization",
] as const satisfies readonly OpenHealthBenchmarkTask[];

export function isOpenHealthTask(value: unknown): value is OpenHealthBenchmarkTask {
  return typeof value === "string" && (OPENHEALTH_TASKS as readonly string[]).includes(value);
}

export const OPENHEALTH_DEFAULT_TASK: OpenHealthBenchmarkTask = "patient_diagnosis";

export const OPENHEALTH_VARIANTS = [
  "unconditioned",
  "specialty_conditioned",
] as const satisfies readonly OpenHealthVariant[];

export function isOpenHealthVariant(value: unknown): value is OpenHealthVariant {
  return typeof value === "string" && (OPENHEALTH_VARIANTS as readonly string[]).includes(value);
}

/** The key the page's Benchmark select uses for one task + variant. */
export type OpenHealthBenchmarkKey = "diagnosis" | "summary" | "specialty-summary";

export interface OpenHealthBenchmarkOption extends OpenHealthBenchmark {
  key: OpenHealthBenchmarkKey;
  label: string;
  /** What a run of it produces, for the page's copy. */
  deliverable: string;
}

/** Every benchmark the page offers, in the order the select shows them. */
export const OPENHEALTH_BENCHMARKS: readonly OpenHealthBenchmarkOption[] = [
  {
    key: "diagnosis",
    task: "patient_diagnosis",
    variant: null,
    label: "Diagnosis",
    deliverable: "a problem list",
  },
  {
    key: "summary",
    task: "context_summarization",
    variant: "unconditioned",
    label: "Summary",
    deliverable: "a whole-patient summary",
  },
  {
    key: "specialty-summary",
    task: "context_summarization",
    variant: "specialty_conditioned",
    label: "Specialty summary",
    deliverable: "one specialty's summary of the chart",
  },
];

export const OPENHEALTH_DEFAULT_BENCHMARK: OpenHealthBenchmarkOption = OPENHEALTH_BENCHMARKS[0];

/** The variant a task is listed with when the caller names none. */
export function defaultOpenHealthVariant(task: OpenHealthBenchmarkTask): OpenHealthVariant | null {
  return task === "context_summarization" ? "unconditioned" : null;
}

function optionOf(benchmark: OpenHealthBenchmark): OpenHealthBenchmarkOption {
  return (
    OPENHEALTH_BENCHMARKS.find((b) => b.task === benchmark.task && b.variant === benchmark.variant) ??
    OPENHEALTH_BENCHMARKS.find((b) => b.task === benchmark.task) ??
    OPENHEALTH_DEFAULT_BENCHMARK
  );
}

export function openHealthBenchmarkKey(benchmark: OpenHealthBenchmark): OpenHealthBenchmarkKey {
  return optionOf(benchmark).key;
}

export function openHealthBenchmarkByKey(key: unknown): OpenHealthBenchmarkOption | null {
  return OPENHEALTH_BENCHMARKS.find((b) => b.key === key) ?? null;
}

/**
 * The benchmark a request names with `task` and `variant` (query or body):
 * the default when both are absent, the task's default variant when only
 * the variant is absent, null when either is not one the page offers. A
 * variant on a task that has none is ignored.
 */
export function openHealthBenchmarkFrom(task: unknown, variant: unknown): OpenHealthBenchmark | null {
  const t = task === undefined || task === null || task === "" ? OPENHEALTH_DEFAULT_TASK : task;
  if (!isOpenHealthTask(t)) return null;
  if (variant === undefined || variant === null || variant === "") {
    return { task: t, variant: defaultOpenHealthVariant(t) };
  }
  if (!isOpenHealthVariant(variant)) return null;
  return { task: t, variant: t === "context_summarization" ? variant : null };
}

/** "Diagnosis", "Summary", "Cardiology summary" (or "Specialty summary" without the specialty). */
export function openHealthBenchmarkLabel(benchmark: OpenHealthBenchmark, specialty?: string | null): string {
  if (benchmark.task === "context_summarization" && benchmark.variant === "specialty_conditioned" && specialty) {
    return `${specialty.replace(/_/g, "/")} summary`;
  }
  return optionOf(benchmark).label;
}

/** The paper's names for its primary metrics, as the page shows them. */
const METRIC_LABELS: Record<string, string> = {
  weighted_problem_list_f1_neutral: "Weighted F1",
  clinical_f1: "Clinical F1",
  conditioned_f1: "Conditioned F1",
  abstention_accuracy: "Abstention",
};

/** The metric's label; the metric's own name when it is not one the page knows; "Score" for none. */
export function openHealthMetricLabel(metric: string | null | undefined): string {
  if (!metric) return "Score";
  return METRIC_LABELS[metric] ?? metric;
}

/** Where a run's files live under its artifact root. */
export function openHealthWorkdir(gtId: number): string {
  return `gt-${gtId}`;
}

/** Where one iteration's run files live under the loop run's artifact root. */
export function openHealthIterationWorkdir(iteration: number): string {
  return `iter-${iteration}`;
}

/**
 * The run files the page may serve, by name — a closed list, so a request
 * never carries a path. `gold.json` (the answer key) and `task.json` sit in
 * the same folder and are not on it.
 */
export const OPENHEALTH_ARTIFACTS: Record<OpenHealthArtifactName, { file: string; contentType: string }> = {
  "problem-list": { file: "output/problem-list.json", contentType: "application/json; charset=utf-8" },
  summary: { file: "output/summary.json", contentType: "application/json; charset=utf-8" },
  timeline: { file: "timeline.md", contentType: "text/markdown; charset=utf-8" },
  checklist: { file: "checklist.md", contentType: "text/markdown; charset=utf-8" },
};

export function isOpenHealthArtifactName(value: unknown): value is OpenHealthArtifactName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OPENHEALTH_ARTIFACTS, value);
}

/** The deliverable file of a task: what the viewer's first pill opens. */
export function openHealthDeliverable(task: OpenHealthBenchmarkTask): "problem-list" | "summary" {
  return task === "context_summarization" ? "summary" : "problem-list";
}
