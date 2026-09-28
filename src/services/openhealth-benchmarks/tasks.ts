/**
 * The OpenHealth task catalogue: the tasks of a split, read from the
 * `openhealth-list-tasks` strut workflow and cached.
 *
 * The catalogue is static and every read of it is a strut run (it adds a
 * line to that workflow's history), so a split is fetched once per swarm and
 * kept — in Redis, and in this process as the fallback when Redis is away.
 */

import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { isOpenHealthDifficulty, OPENHEALTH_DIFFICULTIES, OPENHEALTH_LIST_TASKS_WORKFLOW } from "@/lib/openhealth-benchmarks/constants";
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import type { StrutTarget } from "@/services/strut-target";
import type { OpenHealthDifficulty, OpenHealthSplit, OpenHealthTask, OpenHealthTaskList } from "@/types/openhealth";

const LOG_TAG = "openhealth-benchmarks";
const CACHE_TTL_SECS = 12 * 60 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
/** The workflow runs in milliseconds; its summary is polled a few times in case the lab is busy. */
const SUMMARY_ATTEMPTS = 8;
const SUMMARY_INTERVAL_MS = 500;

type CatalogueTarget = Pick<StrutTarget, "swarmId" | "labBase" | "swarmApiKey" | "actor">;

const memory = new Map<string, { list: OpenHealthTaskList; expiresAt: number }>();

const cacheKey = (swarmId: string, split: OpenHealthSplit) => `openhealth:tasks:${swarmId}:${split}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);

function toTask(value: unknown): OpenHealthTask | null {
  if (!isRecord(value)) return null;
  const gtId = int(value.gtId);
  const patientId = int(value.patientId);
  if (gtId === null || patientId === null || !isOpenHealthDifficulty(value.difficulty)) return null;
  return {
    gtId,
    patientId,
    difficulty: value.difficulty,
    split: typeof value.split === "string" ? value.split : "",
    age: int(value.age),
    sex: value.sex === "F" || value.sex === "M" ? value.sex : null,
    numEncounters: int(value.numEncounters),
  };
}

/** The workflow's output, reduced to the fields a task has. Null when it is not a task list. */
export function parseOpenHealthTaskList(output: unknown, split: OpenHealthSplit): OpenHealthTaskList | null {
  if (!isRecord(output) || !Array.isArray(output.tasks)) return null;
  const tasks = output.tasks.map(toTask).filter((t): t is OpenHealthTask => t !== null);
  const byDifficulty = Object.fromEntries(
    OPENHEALTH_DIFFICULTIES.map((d) => [d, tasks.filter((t) => t.difficulty === d).length]),
  ) as Record<OpenHealthDifficulty, number>;
  return { split, total: tasks.length, byDifficulty, tasks: tasks.sort((a, b) => a.gtId - b.gtId) };
}

async function readCache(key: string): Promise<OpenHealthTaskList | null> {
  const held = memory.get(key);
  if (held && held.expiresAt > Date.now()) return held.list;
  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    const list = JSON.parse(cached) as OpenHealthTaskList;
    memory.set(key, { list, expiresAt: Date.now() + CACHE_TTL_SECS * 1000 });
    return list;
  } catch {
    return null;
  }
}

async function writeCache(key: string, list: OpenHealthTaskList): Promise<void> {
  memory.set(key, { list, expiresAt: Date.now() + CACHE_TTL_SECS * 1000 });
  try {
    await redis.set(key, JSON.stringify(list), "EX", CACHE_TTL_SECS);
  } catch {
    // The process cache holds it.
  }
}

async function runListTasks(target: CatalogueTarget, split: OpenHealthSplit): Promise<OpenHealthTaskList | null> {
  const headers = {
    "Content-Type": "application/json",
    "x-api-token": target.swarmApiKey,
    [STRUT_ACTOR_HEADER]: target.actor,
  };
  const workflow = `${target.labBase}/workflows/${OPENHEALTH_LIST_TASKS_WORKFLOW}`;
  const launched = await fetch(`${workflow}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { split } }),
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
    return parseOpenHealthTaskList(summary.output, split);
  }
  throw new Error("the run did not finish in time");
}

/** The tasks of a split on this swarm's strut; null when the lab could not list them. */
export async function getOpenHealthTasks(
  target: CatalogueTarget,
  split: OpenHealthSplit,
): Promise<OpenHealthTaskList | null> {
  const key = cacheKey(target.swarmId, split);
  const cached = await readCache(key);
  if (cached) return cached;
  try {
    const list = await runListTasks(target, split);
    if (list && list.tasks.length > 0) await writeCache(key, list);
    return list;
  } catch (err) {
    logger.warn("OpenHealth task list unavailable", LOG_TAG, {
      split,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * A task's difficulty from whatever is already cached for the swarm — for
 * runs whose output does not name it. Never launches a strut run.
 */
export async function cachedDifficultyLookup(
  swarmId: string,
  splits: readonly OpenHealthSplit[],
): Promise<(gtId: number) => OpenHealthDifficulty | null> {
  const byGtId = new Map<number, OpenHealthDifficulty>();
  for (const split of splits) {
    const list = await readCache(cacheKey(swarmId, split));
    for (const task of list?.tasks ?? []) byGtId.set(task.gtId, task.difficulty);
  }
  return (gtId) => byGtId.get(gtId) ?? null;
}
