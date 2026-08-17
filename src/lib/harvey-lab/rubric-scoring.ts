/**
 * Graph-first benchmark rubric scoring.
 *
 * The graph is the source of truth for a benchmark task's rubric roster:
 * EvalSet (properties.id = task slug) -[HAS_REQUIREMENT]-> EvalRequirement,
 * one requirement per rubric criterion. The score DENOMINATOR is derived from
 * that roster, not from whatever count the runner webhook happened to echo.
 *
 * A criterion has exactly one of three statuses:
 *   PASS      — judged pass, and its definition is not contested
 *   FAIL      — judged fail/unscored, and its definition is not contested
 *   CONTESTED — its definition is flagged broken (graph `contested` attribute
 *               on the EvalRequirement, or the run-recorded `contested` flag)
 *
 * Contested criteria are dropped from BOTH sides of the score: a task with 50
 * rubrics of which 7 are contested scores out of 43 ("43/43, +7 contested,
 * 50 total"). A contested criterion that happened to pass does not inflate the
 * numerator, and a contested one that failed does not drag the denominator.
 *
 * Pure module — no IO. Mirrors the src/lib/harvey-lab/* split so every
 * derivation is unit-testable without a DOM or network.
 */

import { resolveContested } from "./eval-normalizers";

export type RubricStatus = "PASS" | "FAIL" | "CONTESTED";

/**
 * An EvalRequirement node read from the graph, normalized to the fields
 * scoring needs. `id` is the criterion id (node_key, e.g. "C-003");
 * `contested` is the resolved boolean of the node's `contested` attribute.
 */
export interface GraphRubric {
  ref_id: string;
  id: string;
  name: string;
  contested: boolean;
}

/** Minimal shape of one runner criterion result this module reads. */
export interface ScorableCriterion {
  id?: string;
  title?: string;
  verdict?: string;
  contested?: unknown;
}

/** Case/whitespace-insensitive join key. */
function normKey(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Index of contested rubric definitions from the graph, keyed by normalized
 * criterion id AND name so run criteria can match on either. Only contested
 * entries are indexed — membership means "this definition is contested".
 */
export function buildContestedIndex(rubrics: GraphRubric[] | null | undefined): Set<string> {
  const index = new Set<string>();
  for (const rubric of rubrics ?? []) {
    if (!rubric.contested) continue;
    const idKey = normKey(rubric.id);
    const nameKey = normKey(rubric.name);
    if (idKey) index.add(idKey);
    if (nameKey) index.add(nameKey);
  }
  return index;
}

/** Verdict casing from the producer is unverified — match a "pass" prefix. */
function isPassVerdict(verdict: unknown): boolean {
  return typeof verdict === "string" && /^\s*pass/i.test(verdict);
}

/**
 * Whether one criterion counts as contested. The graph's contested attribute
 * wins; the run-recorded `contested` wire flag is honoured as a fallback so a
 * run that captured a contest marker still renders correctly when the graph is
 * unreachable (or the definition was since un-contested — historical runs
 * keep what they recorded).
 */
export function isCriterionContested(
  criterion: Pick<ScorableCriterion, "id" | "title" | "contested">,
  contestedIndex: Set<string>,
): boolean {
  return (
    contestedIndex.has(normKey(criterion.id)) ||
    contestedIndex.has(normKey(criterion.title)) ||
    resolveContested(criterion)
  );
}

/** Tri-state status for one criterion. */
export function criterionStatus(
  criterion: ScorableCriterion,
  contestedIndex: Set<string>,
): RubricStatus {
  if (isCriterionContested(criterion, contestedIndex)) return "CONTESTED";
  return isPassVerdict(criterion.verdict) ? "PASS" : "FAIL";
}

export interface BenchmarkScore {
  /** Criteria that passed, excluding contested ones — the score numerator. */
  passed: number;
  /** Scorable criteria (total − contested) — the score denominator. */
  denominator: number;
  /** Contested criteria, excluded from the score entirely. */
  contested: number;
  /** Full rubric roster size (graph roster when available). */
  total: number;
  /** No non-contested criterion failed (and at least one was scorable). */
  allPass: boolean;
  /** Where the denominator came from: the graph roster or the run's own data. */
  source: "graph" | "run";
}

export interface ComputeBenchmarkScoreInput {
  /** Per-criterion results from the run, when the run carries them. */
  criteriaResults?: ScorableCriterion[] | null;
  /** Runner-echoed flat counts — fallback when criteriaResults is absent. */
  nPassed?: number | null;
  nTotal?: number | null;
  /** The task's rubric roster read from the graph; null when unavailable. */
  graphRubrics?: GraphRubric[] | null;
}

/**
 * Compute the graph-first score for one run.
 *
 * Denominator precedence: graph roster count → runner n_total → count of
 * criteria_results. Contested criteria are removed from both numerator and
 * denominator wherever they can be identified.
 *
 * When the graph roster is larger than the run's scored criteria, the missing
 * criteria count against the denominator but not the numerator — an unscored
 * requirement is not a pass, and hiding it would quietly shrink the benchmark.
 *
 * Returns null when the RUN carries no score data (no per-criterion results
 * and no flat counts) — a roster alone describes the task, not this run, and
 * must not fabricate a 0/N score for a run that was never judged.
 */
export function computeBenchmarkScore(
  input: ComputeBenchmarkScoreInput,
): BenchmarkScore | null {
  const { criteriaResults, nPassed, nTotal, graphRubrics } = input;
  const hasCriteria = Array.isArray(criteriaResults) && criteriaResults.length > 0;
  const hasFlatCounts = typeof nPassed === "number" && typeof nTotal === "number";
  const hasRoster = Array.isArray(graphRubrics) && graphRubrics.length > 0;

  if (!hasCriteria && !hasFlatCounts) return null;

  const contestedIndex = buildContestedIndex(graphRubrics);
  const source: BenchmarkScore["source"] = hasRoster ? "graph" : "run";

  let passed = 0;
  let contestedInRun = 0;
  if (hasCriteria) {
    for (const criterion of criteriaResults!) {
      const status = criterionStatus(criterion, contestedIndex);
      if (status === "PASS") passed += 1;
      else if (status === "CONTESTED") contestedInRun += 1;
    }
  }

  let total: number;
  let contested: number;
  if (hasRoster) {
    total = graphRubrics!.length;
    // The roster's own contested count is authoritative; a run-recorded
    // contest on a criterion missing from the roster still gets excluded.
    const rosterContested = graphRubrics!.filter((r) => r.contested).length;
    contested = Math.max(rosterContested, contestedInRun);
  } else {
    total = hasFlatCounts ? nTotal! : criteriaResults!.length;
    contested = contestedInRun;
  }

  const denominator = Math.max(0, total - contested);

  if (!hasCriteria) {
    // Flat counts only — contested passes cannot be identified individually,
    // so clamp instead of guessing.
    passed = Math.min(nPassed ?? 0, denominator);
  }

  return {
    passed,
    denominator,
    contested,
    total,
    allPass: denominator > 0 && passed === denominator,
    source,
  };
}

/**
 * Render a score as its display string: "43/43" plus a "+7 contested · 50
 * total" annotation when any criterion is contested. Kept here so every
 * surface (report header, score summary, runs table) prints identically.
 */
export function formatBenchmarkScore(score: BenchmarkScore): {
  headline: string;
  annotation: string | null;
} {
  return {
    headline: `${score.passed}/${score.denominator}`,
    annotation:
      score.contested > 0
        ? `+${score.contested} contested · ${score.total} total`
        : null,
  };
}
