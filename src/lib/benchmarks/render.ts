/**
 * Rendering convention for a benchmark run's raw `output` (all optional):
 *   score + metric (headline), officialScore, summary (markdown),
 *   artifacts [{ name, url, kind }], parentRunId.
 * Everything else is the "extra" JSON tree, minus the benchmark's denyKeys
 * and capped in size.
 */

import type { Benchmark } from "@/lib/benchmarks/registry";
import type { BenchmarkArtifact, BenchmarkHeadline, BenchmarkTask } from "@/types/benchmarks";

/** Serialized size beyond which the JSON tree is replaced by a notice. */
export const MAX_EXTRA_BYTES = 200_000;

const HEADLINE_KEYS = ["score", "metric", "officialScore", "summary", "artifacts", "parentRunId"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function parseArtifacts(value: unknown): BenchmarkArtifact[] {
  if (!Array.isArray(value)) return [];
  const out: BenchmarkArtifact[] = [];
  for (const a of value) {
    if (!isRecord(a)) continue;
    const url = text(a.url);
    // Only http(s) links: output is workflow-supplied.
    if (!url || !/^https?:\/\//i.test(url)) continue;
    out.push({ name: text(a.name) ?? url, url, kind: text(a.kind) });
  }
  return out;
}

export function parseHeadline(output: unknown): BenchmarkHeadline {
  const o = isRecord(output) ? output : {};
  return {
    score: num(o.score),
    metric: text(o.metric),
    officialScore: num(o.officialScore),
    summary: text(o.summary),
    artifacts: parseArtifacts(o.artifacts),
    parentRunId: text(o.parentRunId),
  };
}

/** Deep copy without any key in `deny` (matched case-sensitively, at any depth). */
export function stripDenyKeys(value: unknown, deny: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => stripDenyKeys(v, deny));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!deny.includes(k)) out[k] = stripDenyKeys(v, deny);
    }
    return out;
  }
  return value;
}

export interface BenchmarkExtra {
  /** The JSON to show; null when there is nothing beyond the headline fields. */
  value: unknown;
  truncated: boolean;
  /** Serialized size when truncated. */
  bytes?: number;
}

/** Output minus the headline keys and the deny-list, capped at `maxBytes` serialized. */
export function buildExtra(output: unknown, denyKeys: readonly string[] = [], maxBytes = MAX_EXTRA_BYTES): BenchmarkExtra {
  if (output === null || output === undefined) return { value: null, truncated: false };
  let rest: unknown = output;
  if (isRecord(output)) {
    const copy = { ...output };
    for (const k of HEADLINE_KEYS) delete copy[k];
    rest = copy;
    if (Object.keys(copy).length === 0) return { value: null, truncated: false };
  }
  const cleaned = stripDenyKeys(rest, denyKeys);
  const bytes = JSON.stringify(cleaned)?.length ?? 0;
  if (bytes > maxBytes) return { value: null, truncated: true, bytes };
  return { value: cleaned, truncated: false };
}

/** A task-list workflow's output as `[{ id, title, ... }]`; accepts an array or `{ tasks }`. */
export function parseTaskList(output: unknown): BenchmarkTask[] {
  const list = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.tasks) ? output.tasks : [];
  const tasks: BenchmarkTask[] = [];
  for (const t of list) {
    if (!isRecord(t)) continue;
    const id = t.id ?? t.gtId;
    if (typeof id !== "string" && typeof id !== "number") continue;
    tasks.push({ ...t, id, title: text(t.title) ?? text(t.name) ?? String(id) });
  }
  return tasks;
}

const getPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (isRecord(acc) ? acc[k] : undefined), obj);

const fill = (value: unknown, task: Record<string, unknown>): unknown =>
  typeof value === "string"
    ? value.replace(/\{([\w.]+)\}/g, (_m, path: string) => String(getPath(task, path) ?? ""))
    : value;

/** The key of the launch input that identifies the task (`taskIdKey`, the one mapped from `"id"`, else `taskId`). */
export function taskIdKey(benchmark: Pick<Benchmark, "input" | "taskIdKey">): string {
  if (benchmark.taskIdKey) return benchmark.taskIdKey;
  const mapped = Object.entries(benchmark.input?.fromTask ?? {}).find(([, path]) => path === "id");
  return mapped ? mapped[0] : "taskId";
}

/**
 * The workflow input of a launch. With `input.fromTask` the task must be the
 * one the list workflow returned (never client-sent task data).
 */
export function buildLaunchInput(
  benchmark: Pick<Benchmark, "input" | "taskIdKey">,
  taskId: string | number | undefined,
  task: BenchmarkTask | null,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  const spec = benchmark.input;
  if (!spec?.fromTask) return { ...params, ...(taskId !== undefined ? { [taskIdKey(benchmark)]: taskId } : {}) };
  const mapped: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(spec.fromTask)) {
    const v = task ? getPath(task, path) : undefined;
    if (v !== undefined && v !== null && v !== "") mapped[key] = v;
  }
  const defaults: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(spec.defaults ?? {})) {
    // Without a task (free-form fallback) a templated default has nothing to fill from: skip it.
    if (!task && typeof v === "string" && /\{[\w.]+\}/.test(v)) continue;
    defaults[key] = task ? fill(v, task) : v;
  }
  return { ...defaults, ...mapped, ...params };
}
