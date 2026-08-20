import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { GraphScoreOutput } from "@/lib/harvey-lab/graph-run-score";

/**
 * Graph score outputs for benchmark tasks, fetched from
 * `/api/workspaces/[slug]/legal/benchmarks/graph-scores?taskSlug=...&triggerRefs=...`.
 *
 * The numerator counterpart of `useBenchmarkRubricsMap`: per task, the
 * EvalTriggerOutput nodes reachable from the task's EvalSet trigger chain
 * plus the trigger refs the visible run rows carry. `null` for a task means
 * "no graph outputs available" (non-openlaw workspace, fetch failure, or a
 * task with no instrumented runs) and callers fall back to the row's own
 * result-table score.
 *
 * Results are cached per workspace+task+trigger-set for the lifetime of the
 * page; partial responses (a failed graph hop) are returned but not cached.
 */

/** workspaceSlug:taskSlug:sortedTriggerRefs → outputs (null = known-absent). */
const outputsCache = new Map<string, GraphScoreOutput[] | null>();
/** In-flight de-dupe so concurrent mounts don't double-fetch. */
const inflight = new Map<string, Promise<GraphScoreOutput[] | null>>();

async function fetchOutputs(
  workspaceSlug: string,
  taskSlug: string,
  triggerRefs: string[],
  outputRefs: string[],
): Promise<GraphScoreOutput[] | null> {
  const cacheKey = `${workspaceSlug}:${taskSlug}:${triggerRefs.join(",")}:${outputRefs.join(",")}`;
  if (outputsCache.has(cacheKey)) return outputsCache.get(cacheKey)!;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async (): Promise<GraphScoreOutput[] | null> => {
    try {
      const qs = new URLSearchParams({ taskSlug });
      if (triggerRefs.length > 0) qs.set("triggerRefs", triggerRefs.join(","));
      if (outputRefs.length > 0) qs.set("outputRefs", outputRefs.join(","));
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/legal/benchmarks/graph-scores?${qs.toString()}`,
      );
      if (res.status === 404) {
        // Non-openlaw workspace (or feature absent) — cache the miss so we
        // don't re-probe on every render.
        outputsCache.set(cacheKey, null);
        return null;
      }
      if (!res.ok) return null; // transient — do not cache

      const body = await res.json().catch(() => null);
      const outputs = body?.data?.outputs;
      const result = Array.isArray(outputs) ? (outputs as GraphScoreOutput[]) : null;
      // Partial graph reads are usable but must not be pinned for the session.
      if (body?.data?.partial !== true) outputsCache.set(cacheKey, result);
      return result;
    } catch {
      return null; // transient — do not cache
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

export interface GraphScoreRequest {
  taskSlug: string;
  /** Trigger refs the task's visible rows carry (manual runs' evalTriggerRef). */
  triggerRefs: string[];
  /** Stored EvalTriggerOutput pointers (evalOutputRef) — exact node reads. */
  outputRefs?: string[];
}

/**
 * Fetch graph score outputs for every requested task. Returns a map of
 * taskSlug → outputs (null while loading or when none exist). Failure-
 * tolerant by design: with no workspace or a dead route the map stays empty
 * and every consumer falls back to result-table scoring.
 */
export function useBenchmarkGraphScoresMap(
  requests: GraphScoreRequest[],
): Map<string, GraphScoreOutput[] | null> {
  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug;

  // Stable key so the effect re-runs only when the task/ref sets change.
  // "|" as the field separator: task slugs are /[a-z0-9_\-/]/i and refs are
  // validated by the route to a charset excluding it.
  const requestKey = useMemo(
    () =>
      requests
        .filter((r) => r.taskSlug)
        .map(
          (r) =>
            `${r.taskSlug}|${[...new Set(r.triggerRefs)].sort().join(",")}|${[...new Set(r.outputRefs ?? [])].sort().join(",")}`,
        )
        .sort()
        .join("\n"),
    [requests],
  );

  const [outputs, setOutputs] = useState<Map<string, GraphScoreOutput[] | null>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!workspaceSlug || !requestKey) {
      setOutputs(new Map());
      return;
    }
    let cancelled = false;
    const parsed = requestKey.split("\n").map((line) => {
      const [taskSlug, triggers, pointers] = line.split("|");
      return {
        taskSlug,
        triggerRefs: triggers ? triggers.split(",").filter(Boolean) : [],
        outputRefs: pointers ? pointers.split(",").filter(Boolean) : [],
      };
    });

    (async () => {
      const entries = await Promise.all(
        parsed.map(async ({ taskSlug, triggerRefs, outputRefs }) => {
          const result = await fetchOutputs(workspaceSlug, taskSlug, triggerRefs, outputRefs);
          return [taskSlug, result] as const;
        }),
      );
      if (!cancelled) setOutputs(new Map(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, requestKey]);

  return outputs;
}
