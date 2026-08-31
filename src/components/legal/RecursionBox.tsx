"use client";

import React, { useMemo, useState } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, ExternalLink, TrendingUp, Network, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useEvalRunHistory, type AttemptRailRow } from "@/hooks/useEvalRunHistory";
import { RecursionActivityRail, attemptReportHref } from "@/components/legal/RecursionActivityRail";
import { useBenchmarkRubrics } from "@/hooks/useBenchmarkRubrics";
import { useWorkspace } from "@/hooks/useWorkspace";
import { graphExplorerHref as graphHref } from "@/components/run-report/NodePeek";
import { canReadRunReport } from "@/lib/run-report/types";
import { rosterSummary, type GraphRubric, type RosterSummary } from "@/lib/harvey-lab/rubric-scoring";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import { useLegalBenchmarkRunList, type BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";
import { RecursionGraphPanel } from "@/components/legal/RecursionGraphPanel";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

/** Edge types the recursion loop writes — the subgraph query's whole alphabet. */
const LOOP_EDGE_TYPES =
  "HAS_BASELINE_TRIGGER|HAS_TRIGGER|HAS_OUTPUT|HAS_PROPOSED_FIX|DERIVED_FROM|HAS_REQUIREMENT";

/**
 * Cypher for the card's entire recursion subgraph, anchored on the EvalSet:
 * every edge reachable over the loop's own edge types, returned as (a, r, b)
 * rows — the exact shape the explorer's canvas parses into nodes + labeled
 * edges, so the deep link lands on a fully rendered subgraph instead of a
 * single focused node. Quotes/backslashes are stripped from the ref rather
 * than escaped — ref_ids never legitimately contain either.
 */
function loopSubgraphCypher(evalSetRefId: string): string {
  const ref = evalSetRefId.replace(/["'\\]/g, "");
  return (
    `MATCH (s {ref_id: "${ref}"})-[:${LOOP_EDGE_TYPES}*0..6]->(a)-[r:${LOOP_EDGE_TYPES}]->(b) ` +
    `RETURN DISTINCT a, r, b LIMIT 100`
  );
}

/** Graph Explorer deep link that pre-runs the loop-subgraph Cypher. */
export function loopSubgraphHref(workspaceSlug: string, evalSetRefId: string): string {
  return `/w/${encodeURIComponent(workspaceSlug)}/context/graph?cypher=${encodeURIComponent(loopSubgraphCypher(evalSetRefId))}`;
}

// ─── ScoreBadge ──────────────────────────────────────────────────────────────

function ScoreBadge({
  isLoading,
  error,
  n_passed,
  n_total,
  roster,
  contestedRubrics,
  workspaceSlug,
  onContestedClick,
}: {
  isLoading: boolean;
  error: string | null;
  n_passed: number | undefined;
  n_total: number | undefined;
  /** Graph roster summary — enables the "+N contested" annotation. */
  roster: RosterSummary | null;
  /** The contested EvalRequirement nodes behind the annotation's popover. */
  contestedRubrics: GraphRubric[];
  /** Enables per-rubric Graph Explorer links inside the popover. */
  workspaceSlug: string;
  /**
   * Called when the user opens the contested popover. Additive — callers that
   * don't need lazy rubric loading pass nothing. Used to gate `useBenchmarkRubrics`
   * behind user interaction rather than mount.
   */
  onContestedClick?: () => void;
}) {
  if (isLoading) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="score-loading">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading…</span>
      </span>
    );
  }

  if (error) {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" data-testid="score-error">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>Failed to load</span>
      </span>
    );
  }

  if (n_passed == null || n_total == null) {
    return (
      <span className="text-xs text-muted-foreground/60 italic" data-testid="score-no-runs">
        no runs yet
      </span>
    );
  }

  const pct = n_total > 0 ? Math.round((n_passed / n_total) * 100) : 0;
  const allPass = n_total > 0 && n_passed === n_total;

  return (
    <span className="flex items-center gap-1.5">
      <span
        className={[
          "tabular-nums text-xs font-mono font-medium",
          allPass
            ? "text-green-600 dark:text-green-400"
            : "text-foreground",
        ].join(" ")}
        data-testid="score-display"
        title={`${pct}% pass rate`}
      >
        {n_passed}/{n_total}
      </span>
      {roster && roster.contested > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-xs text-violet-700 dark:text-violet-400 whitespace-nowrap underline-offset-2 hover:underline"
              data-testid="score-contested-annotation"
              title={`${roster.contested} contested criteria excluded from the score · ${roster.total} total in the rubric roster`}
              onClick={onContestedClick}
            >
              +{roster.contested} contested
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <p className="text-xs font-medium mb-0.5">Contested rubrics</p>
            <p className="text-xs text-muted-foreground mb-2">
              {roster.contested} of {roster.total} criteria have contested
              definitions and are excluded from the score.
            </p>
            {/* Loading skeleton when rosterRequested but rubrics not yet loaded */}
            {contestedRubrics.length === 0 && onContestedClick ? (
              <div className="flex items-center gap-2 py-2" data-testid="contested-rubric-skeleton">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading rubrics…</span>
              </div>
            ) : (
              <ul
                className="flex flex-col gap-1 max-h-48 overflow-y-auto"
                data-testid="contested-rubric-list"
              >
                {contestedRubrics.map((rubric) => (
                  <li
                    key={rubric.ref_id}
                    className="flex items-start justify-between gap-2 min-w-0"
                  >
                    <span className="text-xs min-w-0 break-words">
                      <span className="font-mono text-muted-foreground mr-1.5">
                        {rubric.id}
                      </span>
                      {rubric.name}
                    </span>
                    {workspaceSlug && rubric.ref_id && (
                      <a
                        href={graphHref(workspaceSlug, rubric.ref_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors"
                        aria-label={`Open rubric ${rubric.id} in Graph Explorer (opens in new tab)`}
                        title="Open in Graph Explorer"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/**
 * Clamp hill-climb attempt counts to the graph roster's contested-excluded
 * denominator. Attempts carry only aggregate n_passed/n_total (no
 * per-criterion data), so — mirroring computeBenchmarkScore's flat-count
 * rule — the denominator is replaced and passes are clamped rather than
 * guessed. No roster → attempts pass through untouched.
 */
function adjustAttemptsToRoster(
  attempts: EvalTriggerOutput[],
  roster: RosterSummary | null,
): EvalTriggerOutput[] {
  if (!roster) return attempts;
  const clamp = (v: number | null | undefined) =>
    typeof v === "number" ? Math.min(v, roster.denominator) : v;
  return attempts.map((a) => ({
    ...a,
    n_total: roster.denominator,
    n_passed: clamp(a.n_passed) as number | undefined,
    bestPassed: clamp(a.bestPassed) as number | undefined,
    actualPassed: clamp(a.actualPassed) as number | null | undefined,
  }));
}

interface ClimbTarget {
  key: string;
  /** Lowercased target kind ("concept", "prompt", …); null when unrecorded */
  kind: string | null;
  name: string;
  /** Live graph ref_id — null suppresses the Graph Explorer link */
  refId: string | null;
}

/**
 * Distinct nodes the recursion loop has edited, from the fix snapshots joined
 * onto the rail rows — the "what is being climbed" summary. Deduped by live
 * ref_id (name as fallback) so a concept fixed five times is one chip.
 */
function collectClimbTargets(rows: AttemptRailRow[]): ClimbTarget[] {
  const seen = new Map<string, ClimbTarget>();
  for (const row of rows) {
    const fix = row.fixSnapshot;
    if (!fix) continue;
    const refId = fix.target_ref?.trim() || null;
    const name = fix.target_name?.trim() || refId;
    if (!name) continue;
    const key = refId ?? `name:${name}`;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        kind: fix.target_type?.trim().toLowerCase() || null,
        name,
        refId,
      });
    }
  }
  return [...seen.values()];
}

// ─── RecursionCard ────────────────────────────────────────────────────────────

interface RecursionCardProps {
  entry: RecursionEntry;
  refetch: () => Promise<void>;
  allRuns: BenchmarkRunListRow[];
}

function RecursionCard({ entry, refetch, allRuns }: RecursionCardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [graphPanelOpen, setGraphPanelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /**
   * Whether the user has opened the contested-rubrics popover at least once.
   * Gates `useBenchmarkRubrics` so we don't fire 30 on-mount Lambda calls —
   * full rubric detail is only needed when the popover is opened.
   */
  const [rosterRequested, setRosterRequested] = useState(false);
  // Chart↔rail hover sync: one shared index, driven from either side.
  const [hoverAttempt, setHoverAttempt] = useState<number | null>(null);
  const { workspace, role } = useWorkspace();
  const workspaceSlug = workspace?.slug ?? "";
  const canReadReports = canReadRunReport(role ?? "");

  // ── Consolidated report state ──────────────────────────────────────────────
  // `consolidatedRunId` is initialised from the run list below so in-flight
  // status survives a page refresh without a second POST.
  const [consolidatedRunId, setConsolidatedRunId] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // ── useEvalRunHistory gated behind `expanded` ─────────────────────────────
  // While collapsed, pass undefined/empty so the hook is a no-op.
  // The hook's existing `if (!taskSlug) return` guard handles the no-op case.
  const {
    attempts: rawAttempts,
    attemptRows,
    partial,
    subgraphData,
    isLoading: historyLoading,
    error: historyError,
  } = useEvalRunHistory({
    refId: expanded ? entry.refId : undefined,
    slug: expanded ? entry.id : "",
  });

  // ── useBenchmarkRubrics gated behind rosterRequested ─────────────────────
  // Only fires when the user opens the contested-rubrics popover.
  // Eliminates 30 on-mount Lambda calls while preserving per-rubric popover
  // detail on demand.
  const { rubrics: graphRubrics } = useBenchmarkRubrics(
    rosterRequested ? entry.id : undefined,
  );

  // Graph-first denominator: the task's EvalRequirement roster minus contested
  // definitions. When rubrics haven't been requested yet, use summary counts
  // from the entry to render the badge without a Jarvis call.
  const roster = useMemo((): RosterSummary | null => {
    if (graphRubrics !== null) {
      return rosterSummary(graphRubrics);
    }
    // Synthesize from summary data so the "+N contested" badge renders
    // immediately in the collapsed header without waiting for useBenchmarkRubrics.
    if (
      entry.rubricCount != null &&
      entry.contestedCount != null &&
      entry.rubricCount > 0
    ) {
      return {
        total: entry.rubricCount,
        contested: entry.contestedCount,
        denominator: entry.rubricCount - entry.contestedCount,
      };
    }
    return null;
  }, [graphRubrics, entry.rubricCount, entry.contestedCount]);

  const contestedRubrics = useMemo(
    () => (graphRubrics ?? []).filter((r) => r.contested),
    [graphRubrics],
  );
  const attempts = useMemo(
    () => adjustAttemptsToRoster(rawAttempts, roster),
    [rawAttempts, roster],
  );

  // What the loop is editing — distinct fix targets (concepts, prompts, …)
  // with their live graph ref_ids, rendered as chips in the expanded section.
  const climbTargets = useMemo(() => collectClimbTargets(attemptRows), [attemptRows]);

  // Per-dot report links for the chart, resolved through the same helper the
  // rail's report links use — a dot and its rail row always open the same page.
  const dotHrefs = useMemo(() => {
    const hrefs: Array<string | null> = new Array(attempts.length).fill(null);
    for (const row of attemptRows) {
      if (row.attemptIndex == null || row.attemptIndex >= hrefs.length) continue;
      hrefs[row.attemptIndex] = attemptReportHref(row, workspaceSlug, entry.id, canReadReports);
    }
    return hrefs;
  }, [attemptRows, attempts.length, workspaceSlug, entry.id, canReadReports]);

  // ── Score display: summary fallback while history is loading ──────────────
  // `summaryLatest` comes from the one-time summary fetch on mount; used as
  // the displayed score while `useEvalRunHistory` is loading (or not yet
  // triggered because the card is collapsed).
  const summaryLatest = entry.latestRun ?? null;

  // Headline number: the best score so far (highest bestPassed). Both series
  // builders now emit a monotonic bestPassed — the chart's line only climbs or
  // holds, regressions render as hollow "ignored" dots — so the badge always
  // matches the level the line ends at.
  const historyLatest = useMemo(() => {
    if (attempts.length === 0) return null;
    return attempts.reduce((best, pt) => {
      const ptBest = pt.bestPassed ?? pt.n_passed ?? 0;
      const curBest = best.bestPassed ?? best.n_passed ?? 0;
      return ptBest >= curBest ? pt : best;
    });
  }, [attempts]);

  // While history is loading (or the card is collapsed), fall back to summary data.
  // If summaryLatest is null but hook data is already available (race condition on
  // first load, or in tests that don't set entry.latestRun), use hook data as fallback.
  const historyDerived = historyLatest
    ? {
        n_passed: historyLatest.bestPassed ?? historyLatest.n_passed ?? null,
        n_total: historyLatest.n_total ?? null,
        runAt: historyLatest.date_added_to_graph ?? null,
      }
    : null;
  const displayLatest = historyLoading
    ? summaryLatest
    : !expanded
      ? (summaryLatest ?? historyDerived)
      : (historyDerived ?? summaryLatest);

  // Headline climb: best-so-far minus the baseline score. Only a real climb
  // renders — a flat or regressing series keeps the header quiet.
  const climbDelta = useMemo(() => {
    if (attempts.length < 2) return null;
    const base = attempts.find((a) => a.isBaseline) ?? attempts[0];
    const baseScore = base.actualPassed ?? base.n_passed ?? null;
    const best = historyLatest ? (historyLatest.bestPassed ?? historyLatest.n_passed ?? null) : null;
    if (baseScore == null || best == null || best <= baseScore) return null;
    return best - baseScore;
  }, [attempts, historyLatest]);

  // ── Consolidated run — seed from run list (survives page refresh) ──────────
  // `allRuns` is lifted from RecursionTab (via RecursionList) so the whole tab
  // shares one fetch-and-poll loop instead of one per card.

  // Find the most recent CONSOLIDATED run for this taskSlug. Consolidated
  // rows are tagged "consolidated" (distinct from the "recursion" loop tag)
  // by useLegalBenchmarkRunList specifically so they stay invisible in the
  // Runs tab table — but this card still needs to find them here, in the
  // same merged `allRuns` list, to seed in-flight/completed status after a
  // page refresh.
  const existingConsolidated = useMemo(() => {
    return (allRuns ?? [])
      .filter(
        (r) =>
          r.taskSlug === entry.id &&
          r.runType === "consolidated" &&
          (r.status === WorkflowStatus.PENDING ||
            r.status === WorkflowStatus.IN_PROGRESS) &&
          !r.hasReport,
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  }, [allRuns, entry.id]);

  // Seed state from the run list on first render so refreshing doesn't lose the run.
  const effectiveConsolidatedRunId = consolidatedRunId ?? existingConsolidated?.id ?? null;

  // Poll the consolidated run's status.
  const { run: consolidatedRun } = useLegalBenchmarkRun(
    effectiveConsolidatedRunId,
    StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
  );

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    setToggleError(null);
    try {
      const res = await fetch(
        `/api/workspaces/openlaw/legal/benchmarks/recursion/${entry.refId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (res.ok) {
        await refetch();
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `Request failed (${res.status})`;
        console.error(`[RecursionCard] PATCH failed ref_id=${entry.refId} enabled=${enabled}`, msg);
        setToggleError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[RecursionCard] PATCH error ref_id=${entry.refId} enabled=${enabled}`, msg);
      setToggleError(msg);
    } finally {
      setToggling(false);
    }
  };

  // ── Consolidated report trigger ────────────────────────────────────────────
  const handleConsolidatedReport = async () => {
    setIsTriggering(true);
    setTriggerError(null);
    try {
      const runIds = attemptRows
        .filter((r) => {
          if (!r.hasReport) return false;
          if (r.runId === null) {
            console.warn(
              "[RecursionCard] Skipping off-graph attempt row with null runId",
              { key: r.key, taskSlug: entry.id },
            );
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return tb - ta;
        })
        .map((r) => r.runId as string);

      const res = await fetch(
        `/api/workspaces/openlaw/legal/benchmarks/consolidated-report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskSlug: entry.id, runIds }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setConsolidatedRunId((data as { run_id: string }).run_id);
      } else {
        const body = await res.json().catch(() => ({}));
        setTriggerError((body as { error?: string }).error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTriggering(false);
    }
  };

  // Button is disabled while triggering or while a consolidated run is in-flight.
  const consolidatedInFlight =
    !!effectiveConsolidatedRunId && !consolidatedRun?.hasReport;
  const canTriggerConsolidated = !isTriggering && !consolidatedInFlight;

  // ── canExpand derivation ───────────────────────────────────────────────────
  // The original `!historyLoading && !historyError && attempts.length > 0` is
  // incompatible with gating `useEvalRunHistory` behind `expanded`: while
  // collapsed, attempts = [] so canExpand is permanently false and the expand
  // toggle never renders.
  //
  // Fix: while collapsed, infer expandability from summary data. While expanded,
  // use the history state as before.
  const canExpand = expanded
    ? (!historyLoading && !historyError && attempts.length > 0)
    : ((entry.fixChainDepth ?? 0) > 0 || entry.latestRun != null || rawAttempts.length > 0);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Card header row */}
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-medium truncate max-w-xs">
              {entry.name || entry.id}
            </span>
            <ScoreBadge
              isLoading={historyLoading}
              error={historyError}
              n_passed={displayLatest?.n_passed ?? undefined}
              n_total={displayLatest?.n_total ?? entry.rubricCount ?? undefined}
              roster={roster}
              contestedRubrics={contestedRubrics}
              workspaceSlug={workspaceSlug}
              onContestedClick={() => setRosterRequested(true)}
            />
            {climbDelta != null && (
              <span
                className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 whitespace-nowrap"
                data-testid="climb-delta"
                title={`The recursion loop has climbed +${climbDelta} over ${attempts.length} attempts`}
              >
                <TrendingUp className="h-3 w-3 shrink-0" />
                +{climbDelta} from base
              </span>
            )}
            {partial && !historyLoading && !historyError && (
              <span
                className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                data-testid="partial-warning"
                title="The graph walk hit a safety cap before finishing — runs may be missing and the chart below may under-report progress."
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>incomplete data</span>
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-muted-foreground truncate">{entry.id}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(entry.id).then(
                  () => setCopied(true),
                  () => {},
                );
              }}
              onMouseLeave={() => setCopied(false)}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
              title={copied ? "Copied!" : "Copy task slug"}
              aria-label="Copy task slug"
              data-testid="copy-task-slug"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </span>
          {toggleError && (
            <span className="text-xs text-destructive mt-1">{toggleError}</span>
          )}
          {triggerError && (
            <span className="text-xs text-destructive mt-1" data-testid="trigger-error">
              {triggerError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {consolidatedInFlight && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              data-testid="consolidated-generating"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating…
            </span>
          )}
          {consolidatedRun?.hasReport && effectiveConsolidatedRunId && (
            <a
              href={`/w/openlaw/legal/benchmarks/consolidated/${effectiveConsolidatedRunId}/report`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View consolidated report (opens in new tab)"
              className="text-xs text-primary underline underline-offset-2 hover:no-underline"
              data-testid="consolidated-report-link"
            >
              View Consolidated Report ↗
            </a>
          )}

          {workspaceSlug && entry.refId && (
            <>
              <a
                href={loopSubgraphHref(workspaceSlug, entry.refId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap"
                aria-label="View this task's recursion subgraph in the Graph Explorer (opens in new tab)"
                title="Render this task's full recursion subgraph — eval set, triggers, outputs, fixes, rubrics — in the Graph Explorer"
                data-testid="card-graph-link"
              >
                <Network className="h-3.5 w-3.5" />
                View graph
              </a>
              <button
                type="button"
                onClick={() => setGraphPanelOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap"
                aria-label={graphPanelOpen ? "Close timeline panel" : "Open inline timeline panel"}
                title="Show the recursion subgraph as a 2D run-progression timeline"
                data-testid="card-graph-toggle"
              >
                <Network className="h-3.5 w-3.5" />
                {graphPanelOpen ? "Hide timeline" : "Timeline"}
              </button>
            </>
          )}

          {/* Expand toggle — shown when there is data to show (uses summary data
              to avoid requiring a Jarvis fetch just to render the toggle). */}
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label={expanded ? "Collapse chart" : "Expand chart"}
              data-testid="expand-toggle"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {toggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">Recursion</span>
            <Switch
              checked={entry.recursion ?? false}
              onCheckedChange={(v) => handleToggle(v)}
              disabled={toggling}
              aria-label={entry.recursion ? "Disable recursion" : "Enable recursion"}
              data-testid="recursion-toggle"
            />
          </div>
        </div>
      </div>

      {/* Collapsible hill-climb chart */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleContent>
          {attempts.length > 0 && (
            <div className="border-t px-4 pt-3 pb-4 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-2">
                {attempts.length} attempt{attempts.length === 1 ? "" : "s"} — target: {attempts[0].n_total}
                {roster && roster.contested > 0 && (
                  <span
                    className="text-violet-700 dark:text-violet-400"
                    data-testid="chart-contested-note"
                  >
                    {" "}
                    (+{roster.contested} contested excluded · {roster.total} total)
                  </span>
                )}
                {partial && (
                  <span
                    className="text-amber-600 dark:text-amber-400"
                    data-testid="chart-partial-note"
                  >
                    {" "}
                    · chart may be incomplete
                  </span>
                )}
              </p>
              {climbTargets.length > 0 && (
                <div
                  className="flex flex-wrap items-center gap-1.5 mb-3"
                  data-testid="climb-targets"
                >
                  <span className="text-xs text-muted-foreground">climbing:</span>
                  {climbTargets.map((target) => {
                    const chipBody = (
                      <>
                        {target.kind && (
                          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            {target.kind}
                          </span>
                        )}
                        <span className="max-w-[16rem] truncate">{target.name}</span>
                      </>
                    );
                    return target.refId && workspaceSlug ? (
                      <a
                        key={target.key}
                        href={graphHref(workspaceSlug, target.refId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs transition-colors hover:border-primary/50 hover:text-primary"
                        title={`Open this ${target.kind ?? "node"} in the Graph Explorer (opens in new tab)`}
                        data-testid={`climb-target-${target.key}`}
                      >
                        {chipBody}
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      </a>
                    ) : (
                      <span
                        key={target.key}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs"
                        data-testid={`climb-target-${target.key}`}
                      >
                        {chipBody}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="md:basis-2/3 min-w-0">
                  <HillClimbChart
                    attempts={attempts}
                    height={176}
                    dotHrefs={dotHrefs}
                    highlightIndex={hoverAttempt}
                    onHoverIndexChange={setHoverAttempt}
                  />
                </div>
                <div className="md:basis-1/3 min-w-0">
                  <RecursionActivityRail
                    rows={attemptRows}
                    partial={partial}
                    taskSlug={entry.id}
                    activeAttemptIndex={hoverAttempt}
                    onAttemptHover={setHoverAttempt}
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConsolidatedReport}
                  disabled={!canTriggerConsolidated}
                  data-testid="consolidated-report-button"
                >
                  {isTriggering ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Generating…
                    </>
                  ) : (
                    "Consolidated Report"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {graphPanelOpen && subgraphData && entry.refId && workspaceSlug && (
        <RecursionGraphPanel
          nodes={subgraphData.nodes}
          edges={subgraphData.edges}
          partial={partial}
          evalSetRefId={entry.refId}
          workspaceSlug={workspaceSlug}
        />
      )}
    </div>
  );
}

// ─── RecursionList ────────────────────────────────────────────────────────────

interface RecursionListProps {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Shared run list lifted from RecursionTab — threaded to each RecursionCard. */
  allRuns: BenchmarkRunListRow[];
}

export function RecursionList({
  entries,
  isLoading,
  error,
  refetch,
  allRuns,
}: RecursionListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <p className="text-sm">No tasks enrolled in recursion.</p>
        <p className="text-xs">
          Open a completed benchmark run with failing criteria and click{" "}
          <strong>Recursion</strong> to enroll a task — this toggles the recursion
          flag on the task&apos;s EvalSet rather than creating a row.
        </p>
      </div>
    );
  }

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const aTime = a.latestRun?.runAt ? new Date(a.latestRun.runAt).getTime() : -Infinity;
        const bTime = b.latestRun?.runAt ? new Date(b.latestRun.runAt).getTime() : -Infinity;
        return bTime - aTime;
      }),
    [entries],
  );

  return (
    <div className="flex flex-col gap-3">
      {sortedEntries.map((entry) => (
        <RecursionCard key={entry.refId} entry={entry} refetch={refetch} allRuns={allRuns} />
      ))}
    </div>
  );
}
