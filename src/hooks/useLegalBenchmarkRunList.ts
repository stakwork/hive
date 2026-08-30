import { useEffect, useState, useCallback, useRef } from "react";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult, type BenchmarkRunResult } from "@/types/legal";
import { RUN_LIST_LIMIT } from "@/lib/harvey-lab/benchmark-summary";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

/**
 * Display name per StakworkRun pipeline:
 *  - "manual"    — LEGAL_BENCHMARK_RUNNER: a human clicked Run; scored
 *  - "recursion" — the automated loop, covering BOTH cron pipelines:
 *                  LEGAL_BENCHMARK_EVAL (failure analysis; writes cause
 *                  annotations onto the source run) and
 *                  LEGAL_BENCHMARK_RECURSION (the fix-proposal step).
 *                  Analysis is an internal stage of the loop, not a category
 *                  an operator distinguishes — neither pipeline ever scores;
 *                  re-scored attempts land graph-side (Recursion tab).
 */
export type BenchmarkRunType = "manual" | "recursion";

export interface BenchmarkRunListRow {
  id: string;
  workspaceId: string;
  runType: BenchmarkRunType;
  status: WorkflowStatus;
  projectId: number | null;
  taskSlug: string;
  taskTitle: string;
  createdAt: string;
  updatedAt: string;
  // Flat score fields from the runner webhook (single-run pipeline)
  n_passed?: number;
  n_total?: number;
  all_pass?: boolean;
  /**
   * The run's own EvalTrigger node ref (Jarvis instrumentation) — the join
   * key for graph-first score numerators. Mapped for MANUAL rows only: an
   * EVAL row's result carries the SOURCE run's trigger ref, and joining that
   * would paint the source run's score onto an analysis row that never scores.
   */
  evalTriggerRef?: string;
  /**
   * Exact ref of the run's own EvalTriggerOutput node — the strongest score
   * join. Mapped for ALL row types: unlike evalTriggerRef, this field is
   * authored per run (the EVAL dispatch's targeted field copy excludes it),
   * so it can never borrow another run's score.
   */
  evalOutputRef?: string;
  /** Per-criterion results — carried so graph-aware scoring can exclude contested criteria per row. */
  criteria_results?: BenchmarkRunResult["criteria_results"];
  judgeNotes?: string; // "${n_passed}/${n_total} criteria passed. Judge: ${judge_model}"
  /** Operator-chosen execution model (bare name). Absent on legacy runs. */
  requestedModel?: string;
  /** Operator-chosen judge model (bare name). Absent on legacy runs. */
  requestedJudgeModel?: string;
  /** Operator checked "Jamie Chat" at run creation (legacy key name) */
  generateJamieChat?: boolean;
  /** Jamie chat lifecycle: "generating" | "completed" | "failed" */
  jamieChatStatus?: string;
  /** Relative link to the Jamie chat, e.g. "/org/<login>?chat=<id>" */
  jamieChatPath?: string;
  // ── Run report bundle (distinct artifact from the Jamie chat) ──────────────
  /** Operator checked "Generate Report" at run creation */
  generateRunReport?: boolean;
  /** This run has a report bundle. Derived server-side from reportUrl. */
  hasReport?: boolean;
  /**
   * The run's raw Stakwork pipeline type (LEGAL_BENCHMARK_EVAL /
   * LEGAL_BENCHMARK_RECURSION / LEGAL_BENCHMARK_CONSOLIDATED). Distinct from
   * `runType`, which collapses all three into "recursion" for display —
   * `pipeline` is what lets callers (e.g. RecursionCard's consolidated-report
   * lookup) tell a CONSOLIDATED run apart from an EVAL or RECURSION run for
   * the same task.
   */
  pipeline?: StakworkRunType;
}

interface UseLegalBenchmarkRunListResult {
  runs: BenchmarkRunListRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setExpandedId: (id: string | null) => void;
}

const POLL_INTERVAL_MS = 15_000;

/** Coerce a wire score count (number or numeric string) to a number; undefined otherwise. */
function toCount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function useLegalBenchmarkRunList(
  workspaceId: string | undefined,
): UseLegalBenchmarkRunListResult {
  const [runs, setRuns] = useState<BenchmarkRunListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug;

  const runsRef = useRef<BenchmarkRunListRow[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  // Records that a refetch was skipped because the tab was hidden (from
  // either the interval tick or a Pusher event), so we can do exactly ONE
  // catch-up refetch when the tab becomes visible again.
  const missedUpdateRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      missedUpdateRef.current = true;
      return;
    }
    try {
      // One fetch per pipeline — the runs route accepts a single `type` per
      // request. Analysis/recursion rows are operational-only (status, timing,
      // Stakwork link); their scores, when they exist at all, live graph-side.
      const fetchType = (runType: StakworkRunType) =>
        fetch(
          `/api/stakwork/runs?type=${runType}&workspaceId=${workspaceId}&limit=${RUN_LIST_LIMIT}&includeResult=true`,
        );
      const [res, evalRes, recursionRes, consolidatedRes] = await Promise.all([
        fetchType(StakworkRunType.LEGAL_BENCHMARK_RUNNER),
        fetchType(StakworkRunType.LEGAL_BENCHMARK_EVAL),
        fetchType(StakworkRunType.LEGAL_BENCHMARK_RECURSION),
        // CONSOLIDATED rows flow through Pusher updates so the RecursionCard
        // can surface in-flight / completed consolidated report status after
        // a page refresh without any new polling logic.
        fetchType(StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED),
      ]);
      // Manual runs are the tab's backbone — fail hard when they fail. The
      // secondary pipelines degrade to empty lists rather than blanking the tab.
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = await res.json();
      const evalData = evalRes.ok ? await evalRes.json().catch(() => null) : null;
      const recursionData = recursionRes.ok ? await recursionRes.json().catch(() => null) : null;
      const consolidatedData = consolidatedRes.ok ? await consolidatedRes.json().catch(() => null) : null;

      interface RawRunRow {
        id: string;
        workspaceId: string;
        status: string;
        projectId: number | null;
        result: string | null;
        createdAt: string;
        updatedAt: string;
        hasReport?: boolean;
      }

      const rawRows: RawRunRow[] = data.runs ?? [];
      const rawEvalRows: RawRunRow[] = evalData?.runs ?? [];
      const rawRecursionRows: RawRunRow[] = recursionData?.runs ?? [];
      const rawConsolidatedRows: RawRunRow[] = consolidatedData?.runs ?? [];

      const mapSecondary = (
        r: RawRunRow,
        runType: BenchmarkRunType,
        pipeline: StakworkRunType,
      ): BenchmarkRunListRow => {
        const parsed = parseBenchmarkRunResult(r.result);
        return {
          id: r.id,
          workspaceId: r.workspaceId,
          runType,
          pipeline,
          status: r.status as WorkflowStatus,
          projectId: r.projectId,
          taskSlug: parsed?.taskSlug ?? "",
          // Analysis/recursion results carry no taskTitle — derived from the
          // manual rows by slug at render time.
          taskTitle: "",
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          // The recursion pipeline's webhook now reports post-fix score fields
          // and a report bundle back onto the run row — carry them so the table
          // renders them exactly like manual rows. Absent on older rows. The
          // wire sends counts as STRINGS ("34"/"39") — verified against a live
          // concept_rerun payload — so coerce; the manual path gets the same
          // treatment from RunnerScoreSchema at ingest.
          n_passed: toCount(parsed?.n_passed),
          n_total: toCount(parsed?.n_total),
          all_pass: typeof parsed?.all_pass === "boolean" ? parsed.all_pass : undefined,
          evalOutputRef: parsed?.evalOutputRef,
          generateRunReport: parsed?.generateRunReport,
          hasReport: r.hasReport === true,
        };
      };

      const mapped: BenchmarkRunListRow[] = rawRows.map((r) => {
        const parsed = parseBenchmarkRunResult(r.result);
        return {
          id: r.id,
          workspaceId: r.workspaceId,
          runType: "manual" as const,
          status: r.status as WorkflowStatus,
          projectId: r.projectId,
          taskSlug: parsed?.taskSlug ?? "",
          taskTitle: parsed?.taskTitle ?? "",
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          n_passed: parsed?.n_passed,
          n_total: parsed?.n_total,
          all_pass: parsed?.all_pass,
          evalTriggerRef: parsed?.evalTriggerRef,
          evalOutputRef: parsed?.evalOutputRef,
          criteria_results: parsed?.criteria_results,
          requestedModel: parsed?.requestedModel,
          requestedJudgeModel: parsed?.requestedJudgeModel,
          generateJamieChat: parsed?.generateJamieChat,
          jamieChatStatus: parsed?.jamieChatStatus,
          jamieChatPath: parsed?.jamieChatPath,
          generateRunReport: parsed?.generateRunReport,
          // Derived server-side; the bundle URL never reaches this response.
          hasReport: r.hasReport === true,
          // Unified judge precedence: operator choice takes priority over runner-echoed value.
          // Format mirrors stakwork-run.ts — if the server-side format string changes, update this line to match.
          judgeNotes:
            parsed?.n_passed != null && parsed?.n_total != null
              ? `${parsed.n_passed}/${parsed.n_total} criteria passed${
                  (parsed.requestedJudgeModel ?? parsed.judge_model)
                    ? `. Judge: ${parsed.requestedJudgeModel ?? parsed.judge_model}`
                    : ""
                }`
              : undefined,
        };
      });

      const merged = [
        ...mapped,
        ...rawEvalRows.map((r) => mapSecondary(r, "recursion", StakworkRunType.LEGAL_BENCHMARK_EVAL)),
        ...rawRecursionRows.map((r) => mapSecondary(r, "recursion", StakworkRunType.LEGAL_BENCHMARK_RECURSION)),
        // CONSOLIDATED rows are merged so Pusher updates for them flow through
        // the existing channel subscription without new polling logic, enabling
        // RecursionCard to surface in-flight / completed consolidated report
        // status after a page refresh. They are not surfaced in the Runs tab
        // table — the runType tag keeps them invisible there.
        ...rawConsolidatedRows.map((r) => mapSecondary(r, "recursion", StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED)),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      runsRef.current = merged;
      setRuns(merged);
      // `total` keeps its established meaning: the manual-run count that the
      // summary window and "N runs" copy were built around.
      setTotal(data.total ?? mapped.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const fetchRunRef = useRef(fetchRuns);
  useEffect(() => { fetchRunRef.current = fetchRuns; }, [fetchRuns]);

  const channel = usePusherChannel(
    workspaceSlug ? getWorkspaceChannelName(workspaceSlug) : null,
  );

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const hasActiveRuns = useCallback(() =>
    runsRef.current.some(
      (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    ), []);

  const startPolling = useCallback(() => {
    stopPolling();
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    intervalRef.current = setInterval(() => {
      // Keep polling while active runs exist, even if a row is expanded.
      if (hasActiveRuns()) {
        fetchRuns();
      } else {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [fetchRuns, stopPolling, hasActiveRuns]);

  // Initial fetch
  useEffect(() => {
    if (!workspaceId) return;
    fetchRuns();
  }, [workspaceId, fetchRuns]);

  // Start/stop polling whenever the runs list changes
  useEffect(() => {
    const active = runs.some(
      (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    );
    if (active) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [runs, startPolling, stopPolling]);

  // Gate all refetching on browser tab visibility: pause polling while
  // hidden, and do exactly one catch-up refetch when the tab becomes
  // visible again (consuming missedUpdateRef, which fetchRuns sets
  // whenever it no-ops due to the tab being hidden).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      // Became visible: one catch-up refetch if we missed anything, then resume.
      if (missedUpdateRef.current) {
        missedUpdateRef.current = false;
        void fetchRuns().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      } else if (hasActiveRuns()) {
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchRuns, stopPolling, startPolling, hasActiveRuns]);

  // Pusher real-time completion detection
  useEffect(() => {
    if (!channel) return;
    const handleUpdate = (_data: { runId?: string; run_id?: string; type?: string }) => {
      // Refetch on any STAKWORK_RUN_UPDATE event on this workspace channel,
      // regardless of whether the run id is already in the loaded list or
      // what run type it carries (including LEGAL_BENCHMARK_CONSOLIDATED).
      // This ensures the RecursionCard's consolidated-run status updates live
      // even when a brand-new run fires its first update before the list has
      // had a chance to load it.
      // Visibility deferral is handled inside fetchRuns itself (it early-returns
      // and sets missedUpdateRef while hidden), so this handler's semantics
      // are unchanged — it just may be a no-op while the tab is hidden.
      if (isFetchingRef.current) return; // drop burst duplicates
      isFetchingRef.current = true;
      void Promise.resolve(fetchRunRef.current?.()).finally(() => {
        isFetchingRef.current = false;
      });
    };
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    };
  }, [channel]);

  const setExpandedId = useCallback(
    (id: string | null) => {
      expandedIdRef.current = id;
      if (id === null) {
        // Collapsed: refetch and restart polling if there are active runs
        fetchRuns().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      }
      // When expanding a row, polling intentionally continues (active runs keep updating).
    },
    [fetchRuns, startPolling, hasActiveRuns],
  );

  return { runs, total, isLoading, error, refetch: fetchRuns, setExpandedId };
}
