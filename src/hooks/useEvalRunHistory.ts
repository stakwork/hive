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

interface RawRequirement {
  ref_id: string;
  properties?: Record<string, unknown>;
}

interface RawTriggerNode {
  ref_id: string;
  properties: EvalTrigger["properties"];
  outputs?: RawJarvisNode[];
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

export function useEvalRunHistory(taskSlug: string): UseEvalRunHistoryReturn {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug ?? "";
  const workspaceId = workspace?.id ?? "";

  const [history, setHistory] = useState<EvalRunHistoryEntry[]>([]);
  const [attempts, setAttempts] = useState<EvalTriggerOutput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reqId, setReqId] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  const refetch = useCallback(() => {
    setFetchCount((n) => n + 1);
  }, []);

  // Phase 1: resolve reqId from requirements list
  useEffect(() => {
    if (!taskSlug || !slug) return;

    let cancelled = false;
    async function resolveReqId() {
      try {
        const res = await fetch(`/api/workspaces/${slug}/evals/harvey-lab/requirements`);
        if (!res.ok) return;
        const data = (await res.json()) as { data?: { nodes?: RawRequirement[] } };
        const nodes = data?.data?.nodes ?? [];
        const match = nodes.find((r) => r.properties?.id === taskSlug);
        if (!cancelled) {
          setReqId(match ? match.ref_id : null);
        }
      } catch {
        // fail silently — skip fetches below
      }
    }
    resolveReqId();
    return () => { cancelled = true; };
  // Phase 1 depends only on identity — reqId is stable; fetchCount belongs to Phase 2 only
  }, [taskSlug, slug]);

  // Phase 2+3: parallel fetch triggers + runs, then join
  useEffect(() => {
    if (!taskSlug || !slug || !workspaceId || !reqId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function loadHistory() {
      try {
        const [triggersRes, runsRes] = await Promise.all([
          fetch(`/api/workspaces/${slug}/evals/harvey-lab/requirements/${reqId}/triggers`),
          fetch(`/api/stakwork/runs?type=LEGAL_BENCHMARK_RUNNER&workspaceId=${workspaceId}`),
        ]);

        if (cancelled) return;

        // Parse triggers — include ALL triggers, not just those passing triggerHasIdentity,
        // so rerun output nodes are not silently dropped.
        const triggersData = (await triggersRes.json()) as {
          data?: { nodes?: RawTriggerNode[] };
        };
        const allRawTriggers: EvalTrigger[] = (triggersData?.data?.nodes ?? []).map(
          (t: RawTriggerNode) => ({
            ...t,
            outputs: (t.outputs ?? [])
              .map(normalizeOutput)
              .filter((o): o is NonNullable<typeof o> => o !== null),
          }),
        );

        // For the history table (EvalRunsBox): only identity triggers
        const triggers = allRawTriggers.filter(triggerHasIdentity);

        // For the hill-climb chart: all completed outputs across ALL triggers,
        // flattened and sorted chronologically (baseline → reruns).
        const allCompletedOutputs: EvalTriggerOutput[] = allRawTriggers.flatMap(
          (t) => (t.outputs ?? []).filter((o) => o.n_passed != null && o.n_total != null),
        );
        const sortedAttempts = sortAttemptsChronologically(allCompletedOutputs);

        // Parse runs
        const runsData = (await runsRes.json()) as { data?: StakworkRunRow[] } | StakworkRunRow[];
        const runRows: StakworkRunRow[] = Array.isArray(runsData)
          ? runsData
          : (runsData?.data ?? []);

        if (cancelled) return;

        // Join: trigger.ref_id === parseBenchmarkRunResult(run.result)?.evalTriggerRef
        const entries: EvalRunHistoryEntry[] = triggers.map((trigger) => {
          const matchedRun = runRows.find((run) => {
            const parsed = parseBenchmarkRunResult(run.result);
            return parsed?.evalTriggerRef === trigger.ref_id;
          });

          // Get the first completed output (non-empty result)
          const completedOutput = trigger.outputs?.find((o) => o.result.trim() !== "") ?? null;
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

        // Sort newest first; null createdAt sinks to bottom
        entries.sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        setHistory(entries);
        setAttempts(sortedAttempts);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load eval run history.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadHistory();
    return () => { cancelled = true; };
  }, [taskSlug, slug, workspaceId, reqId, fetchCount]);

  return { history, attempts, isLoading, error, refetch };
}
