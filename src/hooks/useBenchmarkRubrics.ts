import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

/**
 * Graph rubric rosters for benchmark tasks, fetched from a configurable
 * endpoint (see `createBenchmarkRubricsHook`).
 *
 * A roster is the task's EvalSet → EvalRequirement subgraph — the source of
 * truth for score denominators and contested definitions. `null` for a task
 * means "no roster available" (no EvalSet in the graph, gated workspace,
 * or fetch failure) and callers fall back to run-local scoring.
 *
 * Rosters are cached per workspace+task for the lifetime of the page, so the
 * runs table and every expanded row share one fetch per task.
 *
 * Cache semantics:
 *  - HTTP 404 → gate/auth failure (transient) — do NOT cache; return null.
 *  - HTTP 2xx + `body.data === null` or `body.data.rosterUnavailable === true`
 *    → definitive absence (no EvalSet in graph) — cache the miss.
 *  - HTTP 2xx + rubrics array → cache the roster.
 *  - Any other error → transient — do not cache.
 */

// ─── Generic factory ─────────────────────────────────────────────────────────

type EndpointFn = (workspaceSlug: string) => string;

function createRosterCache() {
  /** workspaceSlug:taskSlug → roster (null = known-absent). */
  const rosterCache = new Map<string, GraphRubric[] | null>();
  /** In-flight de-dupe so concurrent mounts don't double-fetch. */
  const inflight = new Map<string, Promise<GraphRubric[] | null>>();

  async function fetchRoster(
    workspaceSlug: string,
    taskSlug: string,
    endpointFn: EndpointFn,
  ): Promise<GraphRubric[] | null> {
    const cacheKey = `${workspaceSlug}:${taskSlug}`;
    if (rosterCache.has(cacheKey)) return rosterCache.get(cacheKey)!;

    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const promise = (async (): Promise<GraphRubric[] | null> => {
      try {
        const base = endpointFn(workspaceSlug);
        const res = await fetch(`${base}?taskSlug=${encodeURIComponent(taskSlug)}`);

        // 404 = gate/auth failure — transient, do NOT cache.
        if (res.status === 404) return null;

        // Other non-OK statuses are transient — do not cache.
        if (!res.ok) return null;

        const body = await res.json().catch(() => null);

        // Definitive absence: the graph confirmed no EvalSet for this task.
        // Cache so we don't re-probe on every render.
        if (body?.data === null || body?.data?.rosterUnavailable === true) {
          rosterCache.set(cacheKey, null);
          return null;
        }

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

  return { fetchRoster };
}

/**
 * Factory that creates a `useBenchmarkRubricsMap` + `useBenchmarkRubrics`
 * pair bound to a given endpoint function.
 *
 * Each surface (Legal, Workflow Benchmarks) gets its own cache so slugs from
 * one domain don't collide with another.
 */
export function createBenchmarkRubricsHook(endpointFn: EndpointFn) {
  const { fetchRoster } = createRosterCache();

  function useBenchmarkRubricsMapInner(
    taskSlugs: string[],
  ): Map<string, GraphRubric[] | null> {
    const { workspace } = useWorkspace();
    const workspaceSlug = workspace?.slug;

    // Stable key so effect re-runs only when the distinct slug set changes.
    const slugKey = useMemo(
      () => [...new Set(taskSlugs.filter(Boolean))].sort().join("\n"),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [taskSlugs.join(",")],
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
            const roster = await fetchRoster(workspaceSlug, taskSlug, endpointFn);
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

  function useBenchmarkRubricsInner(
    taskSlug: string | undefined,
  ): UseBenchmarkRubricsResult {
    const slugs = useMemo(() => (taskSlug ? [taskSlug] : []), [taskSlug]);
    const rosters = useBenchmarkRubricsMapInner(slugs);
    return { rubrics: taskSlug ? rosters.get(taskSlug) ?? null : null };
  }

  return {
    useBenchmarkRubricsMap: useBenchmarkRubricsMapInner,
    useBenchmarkRubrics: useBenchmarkRubricsInner,
  };
}

// ─── Legal surface (existing exports — names must not change) ─────────────────

const legalHooks = createBenchmarkRubricsHook(
  (workspaceSlug) => `/api/workspaces/${workspaceSlug}/legal/benchmarks/rubrics`,
);

export interface UseBenchmarkRubricsResult {
  /** The task's graph roster; null while loading or when none exists. */
  rubrics: GraphRubric[] | null;
}

/**
 * Fetch rosters for a set of task slugs (the runs table's distinct tasks).
 * Returns a map keyed by task slug; entries are absent until resolved and
 * `null` when no roster exists.
 */
export const useBenchmarkRubricsMap = legalHooks.useBenchmarkRubricsMap;

/** Single-task convenience over useBenchmarkRubricsMap. */
export const useBenchmarkRubrics = legalHooks.useBenchmarkRubrics;

// ─── Workflow Benchmarks surface ──────────────────────────────────────────────

const workflowBenchmarkHooks = createBenchmarkRubricsHook(
  (workspaceSlug) =>
    `/api/workspaces/${workspaceSlug}/workflow-benchmarks/rubrics`,
);

export const useWorkflowBenchmarkRubricsMap =
  workflowBenchmarkHooks.useBenchmarkRubricsMap;

export const useWorkflowBenchmarkRubrics =
  workflowBenchmarkHooks.useBenchmarkRubrics;
