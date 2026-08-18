/**
 * useEvalRunHistory
 *
 * Fetches the eval run history for a given EvalSet by walking the real
 * EvalSet → EvalTrigger → EvalTriggerOutput / ProposedFix ontology via the
 * dedicated /api/workspaces/[slug]/legal/benchmarks/fix-chain route, which
 * internally uses walkFixChain — no label-whitelist pruning possible.
 *
 * BREAKING CHANGE (preserved): the hook accepts `{ refId, slug }` instead of
 * a plain `taskSlug` string. `refId` (the EvalSet ref_id) is preferred;
 * `slug` is the task-slug used as a fallback when `refId` is absent.
 */

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { parseBenchmarkRunResult } from "@/types/legal";
import type { EvalRunHistoryEntry } from "@/types/legal";
import {
  normalizeOutput,
  triggerHasIdentity,
  sortAttemptsChronologically,
  type EvalTrigger,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";
import { buildHillClimbSeries, type SubgraphNode, type SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import { buildEvalOutputSeries } from "@/lib/harvey-lab/eval-output-series";
import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseEvalRunHistoryInput {
  /** EvalSet ref_id — preferred when present (avoids a slug-resolve round-trip) */
  refId?: string | null;
  /** Task slug — used to resolve the EvalSet ref_id when refId is absent */
  slug: string;
}

interface StakworkRunRow {
  id: string;
  projectId: number | null;
  result: string | null;
  createdAt: string;
}

/**
 * Which builder produced `attempts`:
 *  - "fix-chain"   — ProposedFix hill-climb (authoritative when it has a scored
 *                    non-baseline point); monotonic best-so-far line.
 *  - "eval-output" — flat per-EvalTriggerOutput series for concept-driven
 *                    recursion; the line traces real, possibly falling scores.
 *  - "legacy"      — the pre-existing flat list of completed outputs.
 */
export type EvalSeriesKind = "fix-chain" | "eval-output" | "legacy";

interface UseEvalRunHistoryReturn {
  history: EvalRunHistoryEntry[];
  /** All completed EvalTriggerOutput nodes, sorted chronologically (baseline first). */
  attempts: EvalTriggerOutput[];
  /** Which builder produced `attempts` — drives badge + caption semantics. */
  seriesKind: EvalSeriesKind;
  /** True when the graph walk hit a cap or a hop failed, so `attempts` may be short. */
  partial: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * The hill-climb series is authoritative only when it actually charts a fix.
 * A bare `hillClimbAttempts.length > 0` is true for a baseline-only series, so
 * the fallback would never fire. Counting non-baseline points is not enough
 * either: `buildHillClimbSeries` emits slot points (`actualPassed: null`,
 * `accepted: false`) for rejected-and-unscored fixes, so an eval set whose only
 * fixes were rejected would keep the hill-climb path and its concept re-runs
 * would stay invisible — the original bug, re-created one layer up.
 */
function hasScoredFixPoint(points: EvalTriggerOutput[]): boolean {
  return points.some((pt) => {
    if (pt.isBaseline) return false;
    // Mirrors HillClimbChart's own resolution: an explicit `actualPassed: null`
    // (a slot point) never falls back to n_passed, so slots stay excluded.
    const score = pt.actualPassed !== undefined ? pt.actualPassed : (pt.n_passed ?? null);
    return score != null;
  });
}

// ── Node-type casing helpers ──────────────────────────────────────────────────

function isEvalTrigger(n: SubgraphNode): boolean {
  return (n.node_type ?? "").toLowerCase() === "evaltrigger";
}
function isEvalTriggerOutput(n: SubgraphNode): boolean {
  return (n.node_type ?? "").toLowerCase() === "evaltriggeroutput";
}

// ── Fix-chain route fetch ─────────────────────────────────────────────────────

async function fetchFixChain(
  workspaceSlug: string,
  evalSetRefId: string,
): Promise<{ nodes: SubgraphNode[]; edges: SubgraphEdge[]; partial?: boolean } | null> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/legal/benchmarks/fix-chain?evalSetRefId=${encodeURIComponent(evalSetRefId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    success?: boolean;
    data?: { nodes?: SubgraphNode[]; edges?: SubgraphEdge[]; partial?: boolean };
  };

  if (!data?.success || !data?.data?.nodes) return null;

  return {
    nodes: data.data.nodes ?? [],
    edges: data.data.edges ?? [],
    partial: data.data.partial ?? false,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEvalRunHistory(input: UseEvalRunHistoryInput): UseEvalRunHistoryReturn {
  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug ?? "";
  const workspaceId = workspace?.id ?? "";

  const { refId: inputRefId, slug: taskSlug } = input;

  const [history, setHistory] = useState<EvalRunHistoryEntry[]>([]);
  const [attempts, setAttempts] = useState<EvalTriggerOutput[]>([]);
  const [seriesKind, setSeriesKind] = useState<EvalSeriesKind>("legacy");
  const [partial, setPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  const refetch = useCallback(() => {
    setFetchCount((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!taskSlug || !workspaceSlug || !workspaceId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function load() {
      try {
        // ── Step 1: Resolve EvalSet ref_id ──────────────────────────────────
        let evalSetRefId: string | null = inputRefId ?? null;
        let source: "refId" | "slug-fallback" = "refId";

        if (!evalSetRefId) {
          source = "slug-fallback";
          // Hit the recursion resolve endpoint which applies auth + IDOR gating
          const resolveRes = await fetch(
            `/api/workspaces/${workspaceSlug}/legal/benchmarks/recursion/resolve?taskSlug=${encodeURIComponent(taskSlug)}`,
          );
          if (resolveRes.ok) {
            const resolveData = (await resolveRes.json()) as { refId?: string };
            evalSetRefId = resolveData.refId ?? null;
          }
        }

        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Resolved EvalSet ref_id source=${source} refId=${evalSetRefId ?? "null"} slug=${taskSlug}`,
          "legal",
          { source, evalSetRefId, taskSlug },
        );

        if (!evalSetRefId) {
          if (!cancelled) {
            setHistory([]);
            setAttempts([]);
            setSeriesKind("legacy");
            setPartial(false);
            setIsLoading(false);
          }
          return;
        }

        // ── Step 2: Fetch fix-chain + runs in parallel ────────────────────
        const [fixChain, runsRes] = await Promise.all([
          fetchFixChain(workspaceSlug, evalSetRefId),
          fetch(
            `/api/stakwork/runs?type=LEGAL_BENCHMARK_RUNNER&workspaceId=${workspaceId}&includeResult=true`,
          ),
        ]);

        if (cancelled) return;

        if (!fixChain) {
          logger.warn(
            "[legal/benchmarks/useEvalRunHistory] Fix-chain fetch returned null",
            "legal",
            { evalSetRefId, taskSlug },
          );
          if (!cancelled) {
            setHistory([]);
            setAttempts([]);
            setSeriesKind("legacy");
            setPartial(false);
            setIsLoading(false);
          }
          return;
        }

        // Surface partial data state — no UI change yet, but logged clearly
        if (fixChain.partial) {
          logger.warn(
            "[legal/benchmarks/useEvalRunHistory] Fix-chain returned partial result — hill-climb data may be incomplete",
            "legal",
            { evalSetRefId, taskSlug },
          );
        }

        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Fix-chain fetched nodes=${fixChain.nodes.length} edges=${fixChain.edges.length} partial=${fixChain.partial ?? false}`,
          "legal",
          {
            evalSetRefId,
            nodeCount: fixChain.nodes.length,
            edgeCount: fixChain.edges.length,
            partial: fixChain.partial,
          },
        );

        // ── Step 3: Build hill-climb series for the chart ─────────────────
        const subgraph = {
          nodes: [
            // Inject EvalSet stub so the builders can locate the root
            { ref_id: evalSetRefId, node_type: "EvalSet" },
            ...fixChain.nodes,
          ],
          edges: fixChain.edges,
        };

        const hillClimbAttempts = buildHillClimbSeries(subgraph);

        // ── Step 4: Build history table (EvalRunsBox) ─────────────────────
        // For the history table we reconstruct EvalTrigger objects from the
        // fix-chain and join against StakworkRun rows.
        const allTriggerNodes = fixChain.nodes.filter(isEvalTrigger);

        const allRawTriggers: EvalTrigger[] = allTriggerNodes.map((n) => {
          const outputRefIds = new Set(
            fixChain.edges
              .filter((e) => e.source === n.ref_id && e.edge_type === "HAS_OUTPUT")
              .map((e) => e.target),
          );
          const outputNodes = fixChain.nodes.filter((on) => outputRefIds.has(on.ref_id));
          return {
            ref_id: n.ref_id,
            properties: (n.properties ?? {}) as EvalTrigger["properties"],
            outputs: outputNodes
              .map((on) => normalizeOutput(on as RawJarvisNode))
              .filter((o): o is EvalTriggerOutput => o !== null),
          };
        });

        // For the history table: only identity triggers (those with agent/start/end)
        const identityTriggers = allRawTriggers.filter(triggerHasIdentity);

        // For the chart attempts (legacy path — now replaced by buildHillClimbSeries
        // but kept for the `attempts` field consumed by older code paths)
        const allCompletedOutputs: EvalTriggerOutput[] = allRawTriggers.flatMap(
          (t) => (t.outputs ?? []).filter((o) => o.n_passed != null && o.n_total != null),
        );
        const sortedAttempts = sortAttemptsChronologically(allCompletedOutputs);

        // Enrich legacy sortedAttempts with sensible defaults for new fields so
        // consumers (HillClimbChart, RecursionBox) work on both paths.
        let legacyBest = 0;
        const enrichedSortedAttempts = sortedAttempts.map((o, i) => {
          const actualPassed = o.n_passed ?? null;
          if (actualPassed != null) legacyBest = Math.max(legacyBest, actualPassed);
          return {
            ...o,
            accepted: true,
            isBaseline: i === 0,
            actualPassed,
            bestPassed: legacyBest,
            label: i === 0 ? "base" : `r${i}`,
          };
        });

        // ── Step 4b: Pick the series ──────────────────────────────────────
        // scored-fix hill-climb → flat eval-output → legacy flat list.
        const evalOutputSeries = buildEvalOutputSeries(subgraph);

        let finalAttempts: EvalTriggerOutput[];
        let finalSeriesKind: EvalSeriesKind;

        if (hasScoredFixPoint(hillClimbAttempts)) {
          finalAttempts = hillClimbAttempts;
          finalSeriesKind = "fix-chain";
          // Mixed set: a real ProposedFix chain AND concept re-runs. The
          // hill-climb line wins and the concept re-runs do not chart — that is
          // the intended behaviour, logged rather than left implicit because it
          // is the shape most likely to appear next.
          if (evalOutputSeries.points.length > 1) {
            logger.info(
              `[legal/benchmarks/useEvalRunHistory] Mixed set — ProposedFix chain wins, ${evalOutputSeries.points.length} eval-output points not charted`,
              "legal",
              {
                evalSetRefId,
                fixChainPoints: hillClimbAttempts.length,
                evalOutputPoints: evalOutputSeries.points.length,
              },
            );
          }
        } else if (evalOutputSeries.points.length > 0) {
          finalAttempts = evalOutputSeries.points;
          finalSeriesKind = "eval-output";
        } else {
          finalAttempts = enrichedSortedAttempts;
          finalSeriesKind = "legacy";
        }

        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Series selected kind=${finalSeriesKind} points=${finalAttempts.length} partial=${fixChain.partial ?? false}`,
          "legal",
          {
            evalSetRefId,
            seriesKind: finalSeriesKind,
            seriesLength: finalAttempts.length,
            partial: fixChain.partial ?? false,
            orderingMode: evalOutputSeries.orderingMode,
            denominator: evalOutputSeries.denominator,
          },
        );

        // ── Step 5: Join triggers with StakworkRun rows ───────────────────
        const runsData = (await runsRes.json()) as
          | { runs?: StakworkRunRow[] }
          | StakworkRunRow[];
        const runRows: StakworkRunRow[] = Array.isArray(runsData)
          ? runsData
          : (runsData?.runs ?? []);

        const entries: EvalRunHistoryEntry[] = identityTriggers.map((trigger) => {
          const matchedRun = runRows.find((run) => {
            const parsed = parseBenchmarkRunResult(run.result);
            return parsed?.evalTriggerRef === trigger.ref_id;
          });

          const completedOutput =
            trigger.outputs?.find((o) => o.result.trim() !== "") ?? null;
          const output = completedOutput
            ? {
                result: completedOutput.result,
                score: completedOutput.score,
                judge_notes: completedOutput.judge_notes,
              }
            : null;

          return {
            triggerId: trigger.ref_id,
            output,
            createdAt: matchedRun?.createdAt ?? null,
            projectId: matchedRun?.projectId ?? null,
          };
        });

        entries.sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        const acceptedFixCount = hillClimbAttempts.filter((pt) => !pt.isBaseline && pt.accepted === true).length;
        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Loaded history=${entries.length} hillClimbPts=${hillClimbAttempts.length} acceptedFixes=${acceptedFixCount}`,
          "legal",
          { evalSetRefId, historyCount: entries.length, hillClimbPts: hillClimbAttempts.length, acceptedFixCount },
        );

        if (!cancelled) {
          setHistory(entries);
          setAttempts(finalAttempts);
          setSeriesKind(finalSeriesKind);
          setPartial(fixChain.partial ?? false);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load eval run history.";
          setError(msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [inputRefId, taskSlug, workspaceSlug, workspaceId, fetchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return { history, attempts, seriesKind, partial, isLoading, error, refetch };
}
