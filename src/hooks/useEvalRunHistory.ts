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
import type { FixSnapshotProps } from "@/lib/harvey-lab/fix-snapshot";
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
  /** Already returned by RunResponseRow; preferred over createdAt for timestamps */
  updatedAt?: string;
  /** WorkflowStatus name — PENDING/IN_PROGRESS/COMPLETED/ERROR/HALTED/FAILED */
  status?: string;
  /** Server-derived, role-gated: this run has a viewable report bundle */
  hasReport?: boolean;
}

/** Which StakworkRun pipeline a rail row's status came from. */
export type AttemptRunType = "runner" | "eval" | "recursion";

/**
 * One row of the per-attempt activity rail rendered beside the hill-climb
 * chart. Assembled here — not in the component — so the joins are unit-testable
 * without rendering.
 */
export interface AttemptRailRow {
  /** Stable row key: trigger ref_id for attempt rows, run id for run-only rows */
  key: string;
  /** Chart label ("base"/"rN") when the row's output is a charted point */
  label: string | null;
  /** Index into `attempts` for the matching chart dot (future hover-sync) */
  attemptIndex: number | null;
  /** ISO timestamp — graph write-time → Postgres updatedAt → Postgres createdAt */
  timestamp: string | null;
  score: { passed: number; total: number } | null;
  /** WorkflowStatus name; null = graph-only row (no run matched) */
  status: string | null;
  runType: AttemptRunType | null;
  runId: string | null;
  projectId: number | null;
  hasReport: boolean;
  /**
   * EvalTriggerOutput ref_id, set only when that graph node carries a
   * report_url (written by the Stakwork eval workflow). Lets graph-only rows
   * link the attempt-report page even when no StakworkRun row joined. The raw
   * bundle URL itself deliberately stays out of the row — the page resolves it
   * server-side, same as the runs report.
   */
  graphReportRef: string | null;
  /**
   * Run completed with a report requested but the bundle hasn't landed yet —
   * report_url is written asynchronously after completion, so this is a
   * legitimate transient state, not an error.
   */
  reportPending: boolean;
  /** PENDING or IN_PROGRESS — the attempt is still running */
  inFlight: boolean;
  /**
   * The before/after snapshot of the ProposedFix behind this charted attempt,
   * from `buildHillClimbSeries`'s sidecar map. Non-null only on `fix-chain`
   * series rows whose fix actually recorded a snapshot — the rail renders its
   * diff control exactly when this is set, so legacy fixes and eval-output
   * rows (which never populate it) get no control by construction.
   */
  fixSnapshot: FixSnapshotProps | null;
}

const NON_TERMINAL_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);

/**
 * Stakwork project id from graph properties — same precedence as
 * proposed-fixes/route.ts: `unique_source_id` (written by jarvis-backend at
 * Stakwork dispatch) wins over legacy `project_id`.
 */
function projectIdFromProps(props: Record<string, unknown> | undefined): number | null {
  if (!props) return null;
  for (const key of ["unique_source_id", "project_id"]) {
    const raw = props[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Convert a Jarvis epoch-seconds string to ISO; null when unparseable. */
function graphEpochToIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const seconds = parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Pick the run that carries a trigger's current status. An active run beats a
 * terminal one (the newest attempt may still be in flight on a trigger that
 * already has older completed runs); ties resolve to the most recent.
 */
function pickStatusRun(candidates: StakworkRunRow[]): StakworkRunRow | null {
  if (candidates.length === 0) return null;
  const byNewest = [...candidates].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return byNewest.find((r) => NON_TERMINAL_STATUSES.has(r.status ?? "")) ?? byNewest[0];
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
  /** Per-attempt rows for the activity rail — history joined with run status. */
  attemptRows: AttemptRailRow[];
  /** All completed EvalTriggerOutput nodes, sorted chronologically (baseline first). */
  attempts: EvalTriggerOutput[];
  /** Which builder produced `attempts` — drives badge + caption semantics. */
  seriesKind: EvalSeriesKind;
  /** True when the graph walk hit a cap or a hop failed, so `attempts` may be short. */
  partial: boolean;
  /**
   * The raw fix-chain subgraph — exposed so callers (e.g. RecursionCard) can
   * drive secondary visualisations (timeline, graph panel) without a second fetch.
   * Null until the first successful load.
   */
  subgraphData: { nodes: SubgraphNode[]; edges: SubgraphEdge[] } | null;
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
  const [attemptRows, setAttemptRows] = useState<AttemptRailRow[]>([]);
  const [attempts, setAttempts] = useState<EvalTriggerOutput[]>([]);
  const [seriesKind, setSeriesKind] = useState<EvalSeriesKind>("legacy");
  const [partial, setPartial] = useState(false);
  const [subgraphData, setSubgraphData] = useState<{ nodes: SubgraphNode[]; edges: SubgraphEdge[] } | null>(null);
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
            setAttemptRows([]);
            setAttempts([]);
            setSeriesKind("legacy");
            setPartial(false);
            setIsLoading(false);
          }
          return;
        }

        // ── Step 2: Fetch fix-chain + runs in parallel ────────────────────
        // The runs route accepts a single `type` per request, so the three
        // pipelines are three parallel fetches. Runner runs carry the history
        // join; EVAL runs carry per-attempt status via result.evalTriggerRef;
        // RECURSION runs carry no evalTriggerRef (their result is only
        // {recursionId, sourceRunId, taskSlug}) so they join per-task.
        const runsUrl = (runType: string) =>
          `/api/stakwork/runs?type=${runType}&workspaceId=${workspaceId}&includeResult=true`;
        const [fixChain, runsRes, evalRunsRes, recursionRunsRes] = await Promise.all([
          fetchFixChain(workspaceSlug, evalSetRefId),
          fetch(runsUrl("LEGAL_BENCHMARK_RUNNER")),
          fetch(runsUrl("LEGAL_BENCHMARK_EVAL")),
          fetch(runsUrl("LEGAL_BENCHMARK_RECURSION")),
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
            setAttemptRows([]);
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

        // Sidecar: fix snapshots keyed by FIX ref_id; each entry's
        // point_ref_id names the series point it resolved to (null when the
        // fix emitted no point). Inverted below to join snapshots onto rows.
        const fixSnapshots = new Map<string, FixSnapshotProps>();
        const hillClimbAttempts = buildHillClimbSeries(subgraph, { fixSnapshotsOut: fixSnapshots });
        const snapshotByPointRef = new Map<string, FixSnapshotProps>();
        for (const snapshot of fixSnapshots.values()) {
          if (snapshot.point_ref_id) snapshotByPointRef.set(snapshot.point_ref_id, snapshot);
        }

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
        const parseRunsResponse = async (res: Response): Promise<StakworkRunRow[]> => {
          if (!res.ok) return [];
          const data = (await res.json().catch(() => null)) as
            | { runs?: StakworkRunRow[] }
            | StakworkRunRow[]
            | null;
          if (!data) return [];
          return Array.isArray(data) ? data : (data.runs ?? []);
        };

        const runRows = await parseRunsResponse(runsRes);
        const evalRunRows = await parseRunsResponse(evalRunsRes);
        const recursionRunRows = await parseRunsResponse(recursionRunsRes);

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

        // ── Step 5b: Assemble the activity-rail rows — GRAPH-FIRST ────────
        // Every charted attempt gets a row, unconditionally. The concept
        // pipeline writes triggers with no identity fields (agent/start/end)
        // and often no StakworkRun row at all, so gating rows on
        // `triggerHasIdentity` — as `history` does for the runs table — left
        // the rail empty while the chart happily rendered those same nodes.
        // Identity stays a `history` concern only. Runs are joined
        // opportunistically on top:
        //   - the attempt's owning trigger (via its HAS_OUTPUT edge) is
        //     matched to runner + eval runs on result.evalTriggerRef, an
        //     active run beating a terminal one
        //   - report state comes off the joined run; "pending" when the run
        //     completed with a report requested but the bundle hasn't landed
        //   - no owning trigger or no matching run → em-dash status, graph
        //     write-time timestamp: honest graph-only rows
        // Plus rows the CHART cannot show (no output node yet, so no dot):
        // identity triggers whose run is still in flight, and unclaimed
        // non-terminal runs (recursion runs carry no evalTriggerRef by design
        // and join per-task).
        const runTypeById = new Map<string, AttemptRunType>();
        for (const r of runRows) runTypeById.set(r.id, "runner");
        for (const r of evalRunRows) runTypeById.set(r.id, "eval");
        for (const r of recursionRunRows) runTypeById.set(r.id, "recursion");

        // Owning trigger per output — from ALL walked triggers, identity or not.
        const triggerByOutputRef = new Map<string, EvalTrigger>();
        for (const t of allRawTriggers) {
          for (const o of t.outputs ?? []) triggerByOutputRef.set(o.ref_id, t);
        }

        // Graph-side Stakwork project id per attempt — the CHILD re-runner.
        // Topology per recursion iteration: the cron's StakworkRun row stores
        // the PARENT orchestrator's project id; that parent spawns a child
        // workflow (new project id) which actually re-runs the eval and stamps
        // `unique_source_id` = its own (child) id onto the graph it writes.
        // So the stamp is true per-attempt identity — perfect for the Stakwork
        // link — but it can never join hive's run rows, which only ever carry
        // the parent's id. Status/report therefore join exclusively on
        // result.evalTriggerRef.
        // Precedence: output node → owning trigger node → any edge touching either.
        const rawNodeByRef = new Map(fixChain.nodes.map((n) => [n.ref_id, n]));
        const edgeProjectIdByRef = new Map<string, number>();
        for (const e of fixChain.edges) {
          const pid = projectIdFromProps(e.properties);
          if (pid == null) continue;
          if (!edgeProjectIdByRef.has(e.target)) edgeProjectIdByRef.set(e.target, pid);
          if (!edgeProjectIdByRef.has(e.source)) edgeProjectIdByRef.set(e.source, pid);
        }
        const graphProjectIdFor = (outputRefId: string, triggerRefId: string | null): number | null =>
          projectIdFromProps(rawNodeByRef.get(outputRefId)?.properties) ??
          (triggerRefId ? projectIdFromProps(rawNodeByRef.get(triggerRefId)?.properties) : null) ??
          edgeProjectIdByRef.get(outputRefId) ??
          (triggerRefId ? edgeProjectIdByRef.get(triggerRefId) : null) ??
          null;


        const triggerJoinableRuns = [...runRows, ...evalRunRows];
        const claimedRunIds = new Set<string>();

        const runsForTrigger = (triggerRefId: string): StakworkRunRow[] => {
          const candidates = triggerJoinableRuns.filter((run) => {
            const parsed = parseBenchmarkRunResult(run.result);
            return parsed?.evalTriggerRef === triggerRefId;
          });
          for (const c of candidates) claimedRunIds.add(c.id);
          return candidates;
        };

        const rowFromRun = (
          key: string,
          statusRun: StakworkRunRow | null,
          extras: Pick<AttemptRailRow, "label" | "attemptIndex" | "score"> & {
            graphTime?: string | null;
            graphReportRef?: string | null;
            fixSnapshot?: FixSnapshotProps | null;
          },
        ): AttemptRailRow => {
          const parsedStatusRun = statusRun ? parseBenchmarkRunResult(statusRun.result) : null;
          return {
            key,
            label: extras.label,
            attemptIndex: extras.attemptIndex,
            timestamp: extras.graphTime ?? statusRun?.updatedAt ?? statusRun?.createdAt ?? null,
            score: extras.score,
            status: statusRun?.status ?? null,
            runType: statusRun ? (runTypeById.get(statusRun.id) ?? null) : null,
            runId: statusRun?.id ?? null,
            projectId: statusRun?.projectId ?? null,
            hasReport: statusRun?.hasReport === true,
            graphReportRef: extras.graphReportRef ?? null,
            reportPending:
              statusRun?.status === "COMPLETED" &&
              parsedStatusRun?.generateRunReport === true &&
              statusRun?.hasReport !== true,
            inFlight: NON_TERMINAL_STATUSES.has(statusRun?.status ?? ""),
            fixSnapshot: extras.fixSnapshot ?? null,
          };
        };

        // One row per charted attempt, in dot order.
        const chartedTriggerRefs = new Set<string>();
        const chartedRows: AttemptRailRow[] = finalAttempts.map((attempt, index) => {
          const trigger = triggerByOutputRef.get(attempt.ref_id) ?? null;
          if (trigger) chartedTriggerRefs.add(trigger.ref_id);
          const graphProjectId = graphProjectIdFor(attempt.ref_id, trigger?.ref_id ?? null);

          // Status joins on result.evalTriggerRef only — hive rows carry the
          // parent orchestrator's project id, the graph stamp carries the
          // child re-runner's; a projectId join can never legitimately match
          // (see topology note above).
          const statusRun = trigger ? pickStatusRun(runsForTrigger(trigger.ref_id)) : null;

          const passed = attempt.actualPassed ?? attempt.n_passed;
          const total = attempt.n_total;
          const row = rowFromRun(attempt.ref_id, statusRun, {
            label: attempt.label ?? null,
            attemptIndex: index,
            score: passed != null && total != null ? { passed, total } : null,
            graphTime: graphEpochToIso(attempt.date_added_to_graph),
            graphReportRef: attempt.report_url ? attempt.ref_id : null,
            // Rail snapshot coverage is the fix-chain series only (v1):
            // concept-driven recursion writes no ProposedFix, so eval-output
            // rows legitimately carry none — the attempts-report path still
            // shows the task's fixes when they exist.
            fixSnapshot:
              finalSeriesKind === "fix-chain"
                ? snapshotByPointRef.get(attempt.ref_id) ?? null
                : null,
          });
          // No hive run row exists for the child re-runner — but the graph
          // stamp IS its project id, so the super-admin link opens the exact
          // Stakwork execution that produced this attempt.
          if (row.projectId == null && graphProjectId != null) {
            row.projectId = graphProjectId;
          }
          return row;
        });

        // Identity triggers with no charted output yet — a dispatched run whose
        // output node hasn't landed. Still worth a row: it answers "is the
        // newest attempt in flight?".
        const unchartedTriggerRows: AttemptRailRow[] = identityTriggers
          .filter((t) => !chartedTriggerRefs.has(t.ref_id))
          .map((trigger) =>
            rowFromRun(trigger.ref_id, pickStatusRun(runsForTrigger(trigger.ref_id)), {
              label: null,
              attemptIndex: null,
              score: null,
              graphTime: null,
            }),
          );

        const runOnlyRows: AttemptRailRow[] = [
          ...runRows,
          ...evalRunRows,
          ...recursionRunRows,
        ]
          .filter((run) => {
            if (claimedRunIds.has(run.id)) return false;
            if (!NON_TERMINAL_STATUSES.has(run.status ?? "")) return false;
            const parsed = parseBenchmarkRunResult(run.result);
            return parsed?.taskSlug === taskSlug;
          })
          .map((run) => {
            const runType = runTypeById.get(run.id) ?? null;
            return {
              key: run.id,
              label: null,
              attemptIndex: null,
              timestamp: run.updatedAt ?? run.createdAt,
              score: null,
              status: run.status ?? null,
              runType,
              runId: run.id,
              projectId: run.projectId,
              hasReport: runType === "recursion" && run.status === "COMPLETED",
              graphReportRef: null,
              reportPending: false,
              inFlight: true,
              fixSnapshot: null,
            };
          });

        // Completed/terminal runner/eval/recursion runs, unclaimed by any
        // trigger join — the activity rail should surface all finished
        // attempts, not just in-flight ones. The existing claimedRunIds check
        // and final dedup pass prevent duplicates. Recursion rows have no
        // n_passed/n_total so score is null; hasReport is false (the recursion
        // webhook never writes it) — both render correctly as "—".
        const completedRows: AttemptRailRow[] = [...runRows, ...evalRunRows, ...recursionRunRows]
          .filter((run) => {
            if (claimedRunIds.has(run.id)) return false;
            if (NON_TERMINAL_STATUSES.has(run.status ?? "")) return false;
            const parsed = parseBenchmarkRunResult(run.result);
            return parsed?.taskSlug === taskSlug;
          })
          .map((run) => {
            const parsed = parseBenchmarkRunResult(run.result);
            const passed = parsed?.n_passed;
            const total = parsed?.n_total;
            return {
              key: run.id,
              label: null,
              attemptIndex: null,
              timestamp: run.updatedAt ?? run.createdAt,
              runType: runTypeById.get(run.id) ?? null,
              runId: run.id,
              projectId: run.projectId,
              status: run.status ?? null,
              inFlight: false,
              hasReport: run.hasReport === true,
              graphReportRef: null,
              reportPending: false,
              fixSnapshot: null,
              score: passed != null && total != null ? { passed, total } : null,
            };
          });

        // Dedupe across all row sources (runId wins over key).
        const seen = new Set<string>();
        const dedupe = <T extends AttemptRailRow>(rows: T[]): T[] =>
          rows.filter((r) => {
            const id = r.runId ?? r.key;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });

        // Sort helper: newest-first within a group.
        const byTimeDesc = (a: AttemptRailRow, b: AttemptRailRow) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return tb - ta;
        };

        // Charted rows come first (dot-index order from finalAttempts), then
        // uncharted/run-only rows newest-first, capped at 10 total.
        const unchartedRows = [...unchartedTriggerRows, ...runOnlyRows, ...completedRows].sort(byTimeDesc);
        const railRows = [...dedupe(chartedRows), ...dedupe(unchartedRows)].slice(0, 10);

        const acceptedFixCount = hillClimbAttempts.filter((pt) => !pt.isBaseline && pt.accepted === true).length;
        logger.info(
          `[legal/benchmarks/useEvalRunHistory] Loaded history=${entries.length} hillClimbPts=${hillClimbAttempts.length} acceptedFixes=${acceptedFixCount}`,
          "legal",
          { evalSetRefId, historyCount: entries.length, hillClimbPts: hillClimbAttempts.length, acceptedFixCount },
        );

        if (!cancelled) {
          setHistory(entries);
          setAttemptRows(railRows);
          setAttempts(finalAttempts);
          setSeriesKind(finalSeriesKind);
          setPartial(fixChain.partial ?? false);
          setSubgraphData({ nodes: fixChain.nodes, edges: fixChain.edges });
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

  return { history, attemptRows, attempts, seriesKind, partial, subgraphData, isLoading, error, refetch };
}
