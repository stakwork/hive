/**
 * Shared constants for the OpenHealth Benchmarks feature: the strut
 * workflows it runs, the splits it offers, and the run files it may serve.
 */

import type { OpenHealthArtifactName, OpenHealthDifficulty, OpenHealthSplit } from "@/types/openhealth";

/** `StrutRun.kind` for a benchmark run. */
export const OPENHEALTH_RUN_KIND = "openhealth_benchmark";

/** `StrutRun.kind` for an improve run: one benchmark run's scoring errors → Concepts. */
export const OPENHEALTH_IMPROVE_RUN_KIND = "openhealth_improve";

/**
 * The improve workflow. It reads the benchmark run from strut's own run
 * store, so it is launched on the swarm that ran the benchmark.
 */
export const OPENHEALTH_IMPROVE_WORKFLOW = "openhealth-improve";

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

/** Where a run's files live under its artifact root. */
export function openHealthWorkdir(gtId: number): string {
  return `gt-${gtId}`;
}

/**
 * The run files the page may serve, by name — a closed list, so a request
 * never carries a path. `gold.json` (the answer key) and `task.json` sit in
 * the same folder and are not on it.
 */
export const OPENHEALTH_ARTIFACTS: Record<OpenHealthArtifactName, { file: string; contentType: string }> = {
  "problem-list": { file: "output/problem-list.json", contentType: "application/json; charset=utf-8" },
  timeline: { file: "timeline.md", contentType: "text/markdown; charset=utf-8" },
  checklist: { file: "checklist.md", contentType: "text/markdown; charset=utf-8" },
};

export function isOpenHealthArtifactName(value: unknown): value is OpenHealthArtifactName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OPENHEALTH_ARTIFACTS, value);
}
