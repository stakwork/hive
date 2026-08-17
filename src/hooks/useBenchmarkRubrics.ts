import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

/**
 * Graph rubric rosters for benchmark tasks, fetched from
 * `/api/workspaces/[slug]/legal/benchmarks/rubrics?taskSlug=...`.
 *
 * A roster is the task's EvalSet → EvalRequirement subgraph — the source of
 * truth for score denominators and contested definitions. `null` for a task
 * means "no roster available" (no EvalSet in the graph, non-openlaw workspace,
 * or fetch failure) and callers fall back to run-local scoring.
 *
 * Rosters are cached per workspace+task for the lifetime of the page, so the
 * runs table and every expanded row share one fetch per task.
 */

/** workspaceSlug:taskSlug → roster (null = known-absent). */
const rosterCache = new Map<string, GraphRubric[] | null>();
/** In-flight de-dupe so concurrent mounts don't double-fetch. */
const inflight = new Map<string, Promise<GraphRubric[] | null>>();

async function fetchRoster(
  workspaceSlug: string,
  taskSlug: string,
): Promise<GraphRubric[] | null> {
  const cacheKey = `${workspaceSlug}:${taskSlug}`;
  if (rosterCache.has(cacheKey)) return rosterCache.get(cacheKey)!;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async (): Promise<GraphRubric[] | null> => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/legal/benchmarks/rubrics?taskSlug=${encodeURIComponent(taskSlug)}`,
      );
      if (res.status === 404) {
        // Non-openlaw workspace (or feature absent) — cache the miss so we
        // don't re-probe on every render.
        rosterCache.set(cacheKey, null);
        return null;
      }
      if (!res.ok) return null; // transient — do not cache

      const body = await res.json().catch(() => null);
      const rubrics = body?.data?.rubrics;
      const roster = Array.isArray(rubrics) ? (rubrics as GraphRubric[]) : null;
      rosterCache.set(cacheKey, roster);
      return roster;
    } catch {
      return null; // transient — do not cache
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Fetch rosters for a set of task slugs (the runs table's distinct tasks).
 * Returns a map keyed by task slug; entries are absent until resolved and
 * `null` when no roster exists.
 */
export function useBenchmarkRubricsMap(
  taskSlugs: string[],
): Map<string, GraphRubric[] | null> {
  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug;

  // Stable key so effect re-runs only when the distinct slug set changes.
  const slugKey = useMemo(
    () => [...new Set(taskSlugs.filter(Boolean))].sort().join("\n"),
    [taskSlugs],
  );

  const [rosters, setRosters] = useState<Map<string, GraphRubric[] | null>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!workspaceSlug || !slugKey) {
      setRosters(new Map());
      return;
    }
    let cancelled = false;
    const slugs = slugKey.split("\n");

    (async () => {
      const entries = await Promise.all(
        slugs.map(async (taskSlug) => {
          const roster = await fetchRoster(workspaceSlug, taskSlug);
          return [taskSlug, roster] as const;
        }),
      );
      if (!cancelled) setRosters(new Map(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, slugKey]);

  return rosters;
}

export interface UseBenchmarkRubricsResult {
  /** The task's graph roster; null while loading or when none exists. */
  rubrics: GraphRubric[] | null;
}

/** Single-task convenience over useBenchmarkRubricsMap. */
export function useBenchmarkRubrics(
  taskSlug: string | undefined,
): UseBenchmarkRubricsResult {
  const slugs = useMemo(() => (taskSlug ? [taskSlug] : []), [taskSlug]);
  const rosters = useBenchmarkRubricsMap(slugs);
  return { rubrics: taskSlug ? rosters.get(taskSlug) ?? null : null };
}
