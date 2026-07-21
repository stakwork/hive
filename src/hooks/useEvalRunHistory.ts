/**
 * useEvalRunHistory
 *
 * Fetches the eval run history for a given EvalSet by walking the real
 * EvalSet → EvalTrigger → EvalTriggerOutput / ProposedFix ontology via the
 * /api/swarm/jarvis/nodes subgraph proxy.
 *
 * BREAKING CHANGE: the hook now accepts `{ refId, slug }` instead of a plain
 * `taskSlug` string. `refId` (the EvalSet ref_id) is preferred; `slug` is the
 * task-slug used as a fallback when `refId` is absent.
 *
 * The old `/evals/harvey-lab/requirements` path has been removed entirely.
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

interface UseEvalRunHistoryReturn {
  history: EvalRunHistoryEntry[];
  /** All completed EvalTriggerOutput nodes, sorted chronologically (baseline first). */
  attempts: EvalTriggerOutput[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── Node-type casing helpers ──────────────────────────────────────────────────

const TRIGGER_LABELS = ["EvalTrigger", "evaltrigger", "Evaltrigger"];
const OUTPUT_LABELS = ["EvalTriggerOutput", "evaltriggeroutput", "Evaltriggeroutput"];
const FIX_LABELS = ["ProposedFix", "proposedfix", "Proposedfix"];

function isEvalTrigger(n: SubgraphNode): boolean {
  return (n.node_type ?? "").toLowerCase() === "evaltrigger";
}
function isEvalTriggerOutput(n: SubgraphNode): boolean {
  return (n.node_type ?? "").toLowerCase() === "evaltriggeroutput";
}

// ── Subgraph fetch ────────────────────────────────────────────────────────────

// All node types to request — send multiple casings so server-side filtering
// doesn't miss nodes due to label-casing inconsistency in Neo4j.
const SUBGRAPH_NODE_TYPES = [
  ...TRIGGER_LABELS,
  ...OUTPUT_LABELS,
  ...FIX_LABELS,
];

const SUBGRAPH_DEPTH = 999;

async function fetchSubgraph(
  workspaceId: string,
  evalSetRefId: string,
): Promise<{ nodes: SubgraphNode[]; edges: SubgraphEdge[] } | null> {
  const nodeTypeParam = JSON.stringify(SUBGRAPH_NODE_TYPES);
  const endpoint = `/graph/subgraph?start_node=${evalSetRefId}&node_type=${encodeURIComponent(nodeTypeParam)}&depth=${SUBGRAPH_DEPTH}&include_properties=true`;
  const url = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(endpoint)}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    success?: boolean;
    data?: { nodes?: SubgraphNode[]; edges?: SubgraphEdge[] };
  };

  if (!data?.success || !data?.data?.nodes) return null;

  return {
    nodes: data.data.nodes ?? [],
    edges: data.data.edges ?? [],
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
            setIsLoading(false);
          }
          return;
        }

        // ── Step 2: Fetch subgraph + runs in parallel ─────────────────────
        const [subgraph, runsRes] = await Promise.all([
          fetchSubgraph(workspaceId, evalSetRefId),
          fetch(
            `/api/stakwork/runs?type=LEGAL_BENCHMARK_RUNNER&workspaceId=${workspaceId}&includeResult=true`,
          ),
        ]);

        if (cancelled) return;

        if (!subgraph) {
          logger.warn(
            "[legal/benchmarks/useEvalRunHistory] Subgraph fetch returned null",
            "legal",
            { evalSetRefId, taskSlug },
          );
          if (!cancelled) {
            setHistory([]);
            setAttempts([]);
            setIsLoading(false);
          }
          return;
        }

        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Subgraph fetched nodes=${subgraph.nodes.length} edges=${subgraph.edges.length}`,
          "legal",
          { evalSetRefId, nodeCount: subgraph.nodes.length, edgeCount: subgraph.edges.length },
        );

        // ── Step 3: Build hill-climb series for the chart ─────────────────
        const hillClimbAttempts = buildHillClimbSeries({
          nodes: [
            // Inject EvalSet stub so buildHillClimbSeries can locate the root
            { ref_id: evalSetRefId, node_type: "EvalSet" },
            ...subgraph.nodes,
          ],
          edges: subgraph.edges,
        });

        // ── Step 4: Build history table (EvalRunsBox) ─────────────────────
        // For the history table we reconstruct EvalTrigger objects from the
        // subgraph and join against StakworkRun rows.
        const allTriggerNodes = subgraph.nodes.filter(isEvalTrigger);

        const allRawTriggers: EvalTrigger[] = allTriggerNodes.map((n) => {
          const outputRefIds = new Set(
            subgraph.edges
              .filter((e) => e.source === n.ref_id && e.edge_type === "HAS_OUTPUT")
              .map((e) => e.target),
          );
          const outputNodes = subgraph.nodes.filter((on) => outputRefIds.has(on.ref_id));
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

        // Use hill-climb series if non-empty, else fall back to legacy flat list
        const finalAttempts = hillClimbAttempts.length > 0 ? hillClimbAttempts : sortedAttempts;

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

        const acceptedFixCount = hillClimbAttempts.length > 1 ? hillClimbAttempts.length - 1 : 0;
        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Loaded history=${entries.length} hillClimbPts=${hillClimbAttempts.length} acceptedFixes=${acceptedFixCount}`,
          "legal",
          { evalSetRefId, historyCount: entries.length, hillClimbPts: hillClimbAttempts.length, acceptedFixCount },
        );

        if (!cancelled) {
          setHistory(entries);
          setAttempts(finalAttempts);
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

  return { history, attempts, isLoading, error, refetch };
}
