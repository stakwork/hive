/**
 * A benchmark's task list: its `listWorkflow` run on the workspace's strut
 * and polled for its output (same flow as the OpenHealth catalogue), cached
 * briefly in-process.
 */

import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import type { StrutTarget } from "@/services/strut-target";
import { parseTaskList } from "@/lib/benchmarks/render";
import type { Benchmark } from "@/lib/benchmarks/registry";
import type { BenchmarkTask } from "@/types/benchmarks";

const REQUEST_TIMEOUT_MS = 10_000;
const SUMMARY_ATTEMPTS = 8;
const SUMMARY_INTERVAL_MS = 500;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { tasks: BenchmarkTask[]; expiresAt: number }>();

type Target = Pick<StrutTarget, "swarmId" | "labBase" | "swarmApiKey" | "actor">;

/** Throws when the lab cannot list. `input` is the list workflow's optional input. */
export async function getBenchmarkTasks(
  target: Target,
  benchmark: Benchmark,
  input: Record<string, unknown> = {},
): Promise<BenchmarkTask[]> {
  if (!benchmark.listWorkflow) return [];
  const key = `${target.swarmId}:${benchmark.slug}:${JSON.stringify(input)}`;
  const held = cache.get(key);
  if (held && held.expiresAt > Date.now()) return held.tasks;

  const headers = {
    "Content-Type": "application/json",
    "x-api-token": target.swarmApiKey,
    [STRUT_ACTOR_HEADER]: target.actor,
  };
  const workflow = `${target.labBase}/workflows/${encodeURIComponent(benchmark.listWorkflow)}`;
  const launched = await fetch(`${workflow}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!launched.ok) throw new Error(`launch answered HTTP ${launched.status}`);
  const { runId } = (await launched.json()) as { runId?: unknown };
  if (typeof runId !== "string" || !runId) throw new Error("launch returned no run id");

  for (let attempt = 0; attempt < SUMMARY_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_INTERVAL_MS));
    const res = await fetch(`${workflow}/runs/${encodeURIComponent(runId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) continue;
    const summary = (await res.json()) as { status?: unknown; partial?: unknown; output?: unknown };
    if (summary.partial === true || summary.status === "running") continue;
    if (summary.status !== "success") throw new Error(`the run ended ${String(summary.status)}`);
    const tasks = parseTaskList(summary.output);
    if (tasks.length > 0) cache.set(key, { tasks, expiresAt: Date.now() + CACHE_TTL_MS });
    return tasks;
  }
  throw new Error("the run did not finish in time");
}
