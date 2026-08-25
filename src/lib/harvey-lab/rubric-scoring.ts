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

// ─── Contested-origin types ───────────────────────────────────────────────────

/**
 * Fine-grained origin metadata for a single contested criterion.
 *
 * `inRun`          — the run bundle recorded the contested flag via
 *                    `resolveContested` (the `contested` wire key on the
 *                    criterion result, independent of the graph roster).
 * `roster`         — the criterion matched a contested EvalRequirement in the
 *                    graph roster (by id or title normalization).
 * `rosterAvailable`— whether a non-empty roster was present when this was
 *                    computed. When false, `roster` is always false and any
 *                    in-run signal is downgraded to `"unknown"` by
 *                    `contestedOriginToken` — roster absence MUST NOT be read
 *                    as "roster says this criterion is not contested".
 * `matchedBy`      — which field produced the roster hit, or null when there
 *                    is no roster hit.
 */
export interface ContestedOriginInfo {
  inRun: boolean;
  roster: boolean;
  rosterAvailable: boolean;
  matchedBy: "id" | "title" | null;
}

/**
 * Single token consumed by data- attributes, export columns, and filter
 * predicates. Null means the criterion is not contested at all.
 *
 * "in-run"  — contested only by this run's bundle (no roster confirmation).
 * "roster"  — contested only in the rubric roster (not flagged in this run's
 *             bundle).
 * "both"    — contested in both sources simultaneously.
 * "unknown" — there is a contested signal but the roster was unavailable, so
 *             provenance cannot be established. Renders like the legacy
 *             undifferentiated CONTESTED chip and never claims in-run
 *             provenance was verified against a missing roster.
 */
export type ContestedOriginToken = "in-run" | "roster" | "both" | "unknown";

/**
 * Collapse a `ContestedOriginInfo` into a single display token.
 *
 * IMPORTANT: when `rosterAvailable` is false we can only confirm `inRun`
 * status — we cannot confirm that the roster would NOT have matched, so we
 * must not emit `"in-run"` (which would imply a clean roster miss). Instead
 * we emit `"unknown"` whenever the roster was absent, preserving the
 * today-is-undifferentiated behaviour as the safe default until the roster
 * loads.
 *
 * Returns null when the criterion is not contested at all (inRun and roster
 * are both false — the caller should not render a chip).
 */
export function contestedOriginToken(info: ContestedOriginInfo): ContestedOriginToken | null {
  const { inRun, roster, rosterAvailable } = info;

  if (!inRun && !roster) return null;

  // Roster was unavailable — we cannot distinguish in-run from roster-only, so
  // degrade to "unknown" rather than asserting a provenance we cannot verify.
  if (!rosterAvailable) return "unknown";

  if (inRun && roster) return "both";
  if (roster) return "roster";
  return "in-run";
}

/**
 * Build a provenance index for contested rubric definitions, keeping id and
 * title matches in SEPARATE sets so callers can report which field matched.
 *
 * This is intentionally separate from `buildContestedIndex` (which merges both
 * into one set for the boolean scoring path). Do NOT merge them — scoring must
 * keep calling `buildContestedIndex` unchanged.
 *
 * `available` mirrors the `hasRoster` check in `computeBenchmarkScore`:
 * true only when rubrics is a non-empty array.
 */
export function contestedOriginIndex(rubrics: GraphRubric[] | null | undefined): {
  ids: Set<string>;
  titles: Set<string>;
  available: boolean;
} {
  const ids = new Set<string>();
  const titles = new Set<string>();
  const available = Array.isArray(rubrics) && rubrics.length > 0;

  if (available) {
    for (const rubric of rubrics!) {
      if (!rubric.contested) continue;
      const idKey = normKey(rubric.id);
      const nameKey = normKey(rubric.name);
      if (idKey) ids.add(idKey);
      if (nameKey) titles.add(nameKey);
    }
  }

  return { ids, titles, available };
}

/**
 * Compute the full contested-origin info for one criterion.
 *
 * Returns null when the criterion is not contested at all (neither roster hit
 * nor in-run flag). Callers should check for null before rendering any chip.
 *
 * `matchedBy` is set to:
 *   "id"    — the criterion's id normalized onto a contested roster id.
 *   "title" — only the criterion's title (not id) matched a contested roster
 *             name. Title collisions with unrelated rubrics are possible; copy
 *             should be hedged (handled by `contestedNotice`).
 *   null    — no roster match.
 */
export function contestedOrigin(
  criterion: Pick<ScorableCriterion, "id" | "title" | "contested" | "verdict">,
  originIndex: ReturnType<typeof contestedOriginIndex>,
): ContestedOriginInfo | null {
  const inRun = resolveContested(criterion);
  const idHit = originIndex.ids.has(normKey(criterion.id));
  const titleHit = originIndex.titles.has(normKey(criterion.title));
  const rosterHit = idHit || titleHit;
  const matchedBy: ContestedOriginInfo["matchedBy"] = idHit
    ? "id"
    : titleHit
      ? "title"
      : null;

  if (!inRun && !rosterHit) return null;

  return {
    inRun,
    roster: rosterHit,
    rosterAvailable: originIndex.available,
    matchedBy,
  };
}

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

export interface RosterSummary {
  /** Full rubric roster size. */
  total: number;
  /** Contested definitions, excluded from scoring. */
  contested: number;
  /** Scorable criteria: total − contested. */
  denominator: number;
}

/**
 * Aggregate counts for a graph roster — the denominator surfaces that only
 * have flat attempt counts (recursion tab, hill-climb series) read this
 * instead of computeBenchmarkScore, which needs per-run data.
 * Returns null when there is no roster.
 */
export function rosterSummary(
  rubrics: GraphRubric[] | null | undefined,
): RosterSummary | null {
  if (!rubrics || rubrics.length === 0) return null;
  const contested = rubrics.filter((r) => r.contested).length;
  return {
    total: rubrics.length,
    contested,
    denominator: Math.max(0, rubrics.length - contested),
  };
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
