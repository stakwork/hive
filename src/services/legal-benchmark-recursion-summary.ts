/**
 * legal-benchmark-recursion-summary.ts
 *
 * Batch summary service for the Recursion tab. Returns the minimal initial-render
 * data for all enrolled tasks in one server-side request, eliminating the
 * per-card Lambda stampede caused by individual `useEvalRunHistory` and
 * `useBenchmarkRubrics` fetches on mount.
 *
 * **Two-wave per-task fetch:**
 *   Wave 1 (parallel):  rubric count + trigger-neighbor depth
 *   Wave 2 (sequential): latest run score from the most-recent trigger's HAS_OUTPUT node
 *
 * Per-task failures are non-fatal: a Jarvis timeout or empty expand for one
 * task returns zeroed data (`isDefault: true`) without failing the whole response.
 *
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling — no authorization happens here.
 */

import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { RecursionEvalSetEntry } from "@/services/legal-benchmark-recursion";
import { fetchEvalSetRubrics } from "@/services/legal-benchmark-rubrics";
import { batchedAll } from "@/lib/harvey-lab/fix-chain-walker";
import { expandEdges } from "@/lib/harvey-lab/jarvis-expand";
import { graphEpochToIso, normalizeOutput, type RawJarvisNode } from "@/lib/harvey-lab/eval-normalizers";
import { logger } from "@/lib/logger";

// Cap on concurrently-processed tasks. Each task issues up to 2 parallel
// Jarvis calls (Wave 1), so peak in-flight Jarvis queries ≈ 2× this value.
// Unbounded Promise.all here fanned out ~90 simultaneous Cypher queries
// against the workspace's single Neo4j and contributed to memory-pressure
// crashes on the swarm.
const TASK_CONCURRENCY = 6;

// ── Public interface ──────────────────────────────────────────────────────────

export interface RecursionSummaryEntry {
  taskSlug: string;
  refId: string;
  name: string;
  reason: string | null;
  recursion: boolean;
  rubricCount: number;
  contestedCount: number;
  /** `runAt` is ISO — the graph's epoch stamp is converted at this boundary. */
  latestRun: { n_passed: number | null; n_total: number | null; runAt: string | null } | null;
  fixChainDepth: number;
  /** True when any per-task fetch fell back to zeros. */
  isDefault: boolean;
}

// ── Zero/fallback entry ───────────────────────────────────────────────────────

function makeDefault(entry: RecursionEvalSetEntry): RecursionSummaryEntry {
  return {
    taskSlug: entry.id,
    refId: entry.ref_id,
    name: entry.name,
    reason: entry.reason ?? null,
    recursion: entry.recursion ?? false,
    rubricCount: 0,
    contestedCount: 0,
    latestRun: null,
    fixChainDepth: 0,
    isDefault: true,
  };
}

// ── Per-task summary fetch ────────────────────────────────────────────────────

async function fetchOneTaskSummary(
  config: JarvisConnectionConfig,
  entry: RecursionEvalSetEntry,
): Promise<RecursionSummaryEntry> {
  const taskSlug = entry.id;
  const refId = entry.ref_id;

  // ── Wave 1: rubrics + trigger-neighbors in parallel ──────────────────────
  const [rubricResult, triggerNeighbors] = await Promise.all([
    fetchEvalSetRubrics(config, refId),
    expandEdges(refId, ["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"], config),
  ]);

  // Explicit return-value checks — not rejection catches. Both helpers never
  // throw; Promise.allSettled would always see "fulfilled" regardless of
  // Jarvis errors. The fallback must be triggered by `.ok === false` / `=== null`.
  const rubricsFailed = !rubricResult.ok;
  const triggersFailed = triggerNeighbors === null;

  if (rubricsFailed || triggersFailed) {
    logger.warn(
      "[legal/benchmarks/recursion/summary] Wave 1 failed for task — returning defaults",
      "legal",
      { taskSlug, refId },
    );
    return makeDefault(entry);
  }

  const rubrics = rubricResult.rubrics ?? [];
  const rubricCount = rubrics.length;
  const contestedCount = rubrics.filter((r) => r.contested).length;

  // Filter to EvalTrigger-typed neighbors for depth.
  const triggerNodes = triggerNeighbors.filter(
    (n) => String(n.node_type ?? "").toLowerCase() === "evaltrigger",
  );
  const fixChainDepth = triggerNodes.length;

  // ── Wave 2: most-recent trigger's latest output ──────────────────────────
  // Skip if Wave 1 returned no trigger neighbors.
  let latestRun: RecursionSummaryEntry["latestRun"] = null;

  if (triggerNodes.length > 0) {
    // Sort by top-level `date_added_to_graph` descending. This field is at the
    // top-level node object (not under `properties`), consistent with how
    // `normalizeOutput` reads it. Nodes lacking the field sort last.
    const sorted = [...triggerNodes].sort((a, b) => {
      const aDate = (a as unknown as { date_added_to_graph?: string }).date_added_to_graph ?? "";
      const bDate = (b as unknown as { date_added_to_graph?: string }).date_added_to_graph ?? "";
      // Descending: b before a
      if (bDate > aDate) return 1;
      if (bDate < aDate) return -1;
      return 0;
    });

    const mostRecent = sorted[0];
    const outputNeighbors = await expandEdges(mostRecent.ref_id, ["HAS_OUTPUT"], config);

    if (outputNeighbors !== null && outputNeighbors.length > 0) {
      // Pick the first EvalTriggerOutput neighbor.
      const outputNode = outputNeighbors.find(
        (n) => String(n.node_type ?? "").toLowerCase() === "evaltriggeroutput",
      );
      if (outputNode) {
        const normalized = normalizeOutput(outputNode as RawJarvisNode);
        if (normalized) {
          latestRun = {
            n_passed: normalized.n_passed ?? null,
            n_total: normalized.n_total ?? null,
            runAt: graphEpochToIso(normalized.date_added_to_graph),
          };
        }
      }
    }
    // Wave 2 failure (null neighbors or no output node) is non-fatal:
    // latestRun stays null, other fields still valid.
  }

  return {
    taskSlug,
    refId,
    name: entry.name,
    reason: entry.reason ?? null,
    recursion: entry.recursion ?? false,
    rubricCount,
    contestedCount,
    latestRun,
    fixChainDepth,
    isDefault: false,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch the minimal initial-render summary for all enrolled tasks.
 *
 * - `name`, `reason`, and `recursion` are passed through from each
 *   `RecursionEvalSetEntry` — `listRecursionEvalSets` already resolves these.
 * - `ref_id` is already present on each entry — `resolveEvalSetRefIdBySlug`
 *   is never called.
 * - Tasks run with bounded concurrency (`TASK_CONCURRENCY`); per-task failures
 *   never propagate to the outer promise.
 *
 * **Log discipline:** `logger.warn` on per-task failure with `{ taskSlug, refId }`
 * only. `config` and all fields derived from it (including `swarmApiKey`) are
 * never logged.
 */
export async function fetchRecursionTaskSummary(
  config: JarvisConnectionConfig,
  entries: RecursionEvalSetEntry[],
): Promise<RecursionSummaryEntry[]> {
  return batchedAll(
    entries.map((entry) => async () => {
      try {
        return await fetchOneTaskSummary(config, entry);
      } catch (err) {
        // fetchOneTaskSummary is designed to never throw, but we guard here as
        // a belt-and-suspenders against unexpected runtime errors.
        logger.warn(
          "[legal/benchmarks/recursion/summary] Unexpected error for task — returning defaults",
          "legal",
          {
            taskSlug: entry.id,
            refId: entry.ref_id,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        return makeDefault(entry);
      }
    }),
    TASK_CONCURRENCY,
  );
}
