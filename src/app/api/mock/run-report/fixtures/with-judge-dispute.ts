/**
 * Mock fixture: run with judge-dispute keys on both a contested criterion
 * and a non-contested failing criterion (the overlap case).
 *
 * Used to test that `rubricBreakdown` correctly reports a non-zero Disputed
 * count, and that the overlap between Contested and Disputed is handled
 * correctly — a criterion can appear in both buckets simultaneously.
 */

import { FULL_BUNDLE } from "./full";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Bundle = Record<string, unknown>;

/**
 * Three rubrics:
 *   R1 — pass, not contested, not disputed
 *   R2 — fail, NOT contested, but DISPUTED (flagged: true — non-contested failure
 *         with a judge-dispute flag, the core overlap case)
 *   R3 — fail, CONTESTED, DISPUTED (flag on a contested criterion — both buckets)
 */
export const WITH_JUDGE_DISPUTE: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  const pageData = b.page_data as Record<string, unknown>;

  pageData.rubrics = [
    {
      id: "R1",
      title: "Identifies the indemnity cap",
      match_criteria: "Response names the cap.",
      verdict: "pass",
      reasoning: "Correctly identified.",
    },
    {
      id: "R2",
      title: "Flags the unilateral termination clause",
      match_criteria: "Response identifies section 12.4.",
      verdict: "fail",
      reasoning: "Section 12.4 not mentioned.",
      // Judge-dispute keys on a NON-contested failure — the overlap case.
      flagged: true,
      flag_basis: "verdict_accuracy",
      llm_flag_reason:
        "The judge's verdict may be too strict: section 12.4 is quoted in " +
        "the response's risk table, though never named by number.",
    },
    {
      id: "R3",
      title: "Cites the governing law correctly",
      match_criteria: "Response cites New York as governing law.",
      verdict: "fail",
      reasoning: "Governing law was not identified.",
      // Contested AND disputed simultaneously.
      contested: true,
      flagged: true,
      flag_basis: "criterion_validity",
      llm_flag_reason:
        "This criterion's definition is ambiguous; the judge's failure verdict " +
        "may not be reliable.",
    },
  ];

  pageData.score = {
    score: 1,
    max_score: 2, // contested criterion excluded from denominator
    all_pass: false,
    n_criteria: 3,
    n_passed: 1,
    judge_model: "claude-sonnet-4-6",
    scored_at: "2026-08-10 14:32:05.001",
  };

  b.rubric_links = {};
  return b;
})();
