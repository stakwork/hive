/**
 * Mock fixture: graph roster is larger than the bundle's rubricRows.
 *
 * The fixture has 2 scored rubrics in the bundle but the graph roster has 4
 * requirements. The 2 unscored roster criteria must count as Fail in the
 * rubricBreakdown, not be silently ignored.
 *
 * This verifies the "unscored roster criteria → Fail" behaviour described in
 * the architecture spec: an unscored requirement is not a pass, and hiding it
 * would quietly shrink the benchmark.
 *
 * The `graphRubrics` field is attached at the route layer (not in the bundle
 * itself), but this fixture documents the intended test shape alongside the
 * bundle fixture so test code can construct the pair easily.
 */

import { FULL_BUNDLE } from "./full";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Bundle = Record<string, unknown>;

/**
 * Bundle rubric rows: 2 rubrics (1 pass, 1 fail).
 * Companion graph roster (exported below): 4 rubrics (2 of which are absent from the bundle).
 * Expected breakdown: pass=1, fail=3, contested=0, total=4.
 */
export const WITH_UNSCORED_ROSTER: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  const pageData = b.page_data as Record<string, unknown>;

  pageData.rubrics = [
    {
      id: "R1",
      title: "Identifies the indemnity cap",
      match_criteria: "Response names the $2M cap.",
      verdict: "pass",
      reasoning: "Correctly identified.",
    },
    {
      id: "R2",
      title: "Flags the unilateral termination clause",
      match_criteria: "Response identifies section 12.4.",
      verdict: "fail",
      reasoning: "Not mentioned.",
    },
    // R3 and R4 are intentionally absent from the bundle — they were in the
    // graph roster but the runner never scored them. They should count as Fail.
  ];

  pageData.score = {
    score: 1,
    max_score: 4, // full roster size
    all_pass: false,
    n_criteria: 2,
    n_passed: 1,
    judge_model: "claude-sonnet-4-6",
    scored_at: "2026-08-10 14:32:05.001",
  };

  b.rubric_links = {};
  return b;
})();

/**
 * Companion graph roster for WITH_UNSCORED_ROSTER.
 *
 * Has 4 rubrics. R3 and R4 are present in the roster but absent from the
 * bundle's rubricRows — they were never scored by the runner.
 */
export const WITH_UNSCORED_ROSTER_GRAPH_RUBRICS = [
  { ref_id: "req-r1", id: "R1", name: "Identifies the indemnity cap", contested: false },
  { ref_id: "req-r2", id: "R2", name: "Flags the unilateral termination clause", contested: false },
  { ref_id: "req-r3", id: "R3", name: "Summarises the non-disclosure obligations", contested: false },
  { ref_id: "req-r4", id: "R4", name: "Identifies the dispute resolution clause", contested: false },
];
