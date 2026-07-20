import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { parseBenchmarkRunResult } from "@/types/legal";
import type { EvalRunHistoryEntry } from "@/types/legal";
import {
  normalizeOutput,
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
  /**
   * All EvalTriggerOutput nodes for this task, flattened across all triggers
   * and sorted chronologically (baseline first, then reruns ascending).
   * Each output carries n_passed / n_total from node properties.
   */
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
    return () => {
      cancelled = true;
    };
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
          fetch(`/api/stakwork/runs?type=LEGAL_BENCHMARK_EVAL&workspaceId=${workspaceId}`),
        ]);

        if (cancelled) return;

        // Parse triggers — keep ALL triggers, not just those with identity,
        // because rerun EvalTrigger nodes may not carry agent/start/end fields.
        // We do NOT apply triggerHasIdentity here so that rerun outputs are
        // collected for the attempts series.
        const triggersData = (await triggersRes.json()) as {
          data?: { nodes?: RawTriggerNode[] };
        };
        const rawTriggers: EvalTrigger[] = (triggersData?.data?.nodes ?? []).map(
          (t: RawTriggerNode) => ({
            ...t,
            outputs: (t.outputs ?? [])
              .map((o) => {
                // RawJarvisNode may carry top-level date_added_to_graph
                const raw = o as RawJarvisNode & { date_added_to_graph?: string };
                return normalizeOutput(raw);
              })
              .filter((o): o is EvalTriggerOutput => o !== null),
          }),
        );

        // For the EvalRunsBox history table, still filter by identity to avoid phantom rows
        const triggersWithIdentity = rawTriggers.filter((t) => {
          const agent = String(t.properties?.agent ?? "").trim();
          const start = String(t.properties?.start_point ?? "").trim();
          const end = String(t.properties?.end_point ?? "").trim();
          return Boolean(agent || start || end);
        });

        // Parse eval runs (for the history table join)
        const runsData = (await runsRes.json()) as { data?: StakworkRunRow[] } | StakworkRunRow[];
        const runRows: StakworkRunRow[] = Array.isArray(runsData)
          ? runsData
          : (runsData?.data ?? []);

        if (cancelled) return;

        // ── EvalRunsBox history: join identity-filtered triggers with eval runs ──
        const entries: EvalRunHistoryEntry[] = triggersWithIdentity.map((trigger) => {
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

        // ── Attempts series: flatten ALL outputs from ALL triggers, sorted chrono ──
        // We include outputs from ALL triggers (not just identity-filtered ones)
        // so that rerun EvalTrigger outputs are captured for the hill-climb chart.
        const allOutputs: EvalTriggerOutput[] = rawTriggers.flatMap(
          (t) =>
            (t.outputs ?? []).filter(
              (o) => o.result.trim() !== "" && o.n_passed !== undefined && o.n_total !== undefined,
            ),
        );
        const sortedAttempts = sortAttemptsChronologically(allOutputs);

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
    return () => {
      cancelled = true;
    };
  }, [taskSlug, slug, workspaceId, reqId, fetchCount]);

  return { history, attempts, isLoading, error, refetch };
}
