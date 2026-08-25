/**
 * Adapter: run-report RubricRow → harvey-lab ScorableCriterion.
 *
 * `RubricRow` uses provenance-prefixed field names (e.g. `criterionContested`,
 * `judgeFlagged`) so downstream code can distinguish them from other fields.
 * `ScorableCriterion` / `resolveJudgeDispute` expect the bare wire-key names
 * (`contested`, `flagged`, etc.).
 *
 * This file exists to keep the import direction `run-report → harvey-lab`
 * (not the other way around) and to be the single remap point — removing the
 * hand-written inline remaps duplicated across RubricLedger.tsx, ReportHeader,
 * and render-offline.tsx.
 */

import type { RubricRow } from "@/lib/run-report/types";
import type { ScorableCriterion } from "@/lib/harvey-lab/rubric-scoring";

/**
 * Map one `RubricRow` to the `ScorableCriterion` shape consumed by
 * `rubricBreakdown` and `computeBenchmarkScore`.
 *
 * Field mapping:
 *   judgeFlagged      → flagged
 *   judgeFlagReason   → llm_flag_reason
 *   judgeFlagBasis    → flag_basis
 *   criterionContested → contested
 */
export function scorableFromRubricRow(row: RubricRow): ScorableCriterion {
  const result: ScorableCriterion = {
    id: row.id,
    title: row.title,
    verdict: row.verdict,
    contested: row.criterionContested,
  };

  // Only attach the judge-dispute keys when they are explicitly present on the
  // row — key presence is meaningful (distinguishes "dispute stage ran but
  // nothing flagged" from "dispute stage never ran").
  if (Object.prototype.hasOwnProperty.call(row, "judgeFlagged")) {
    result.flagged = row.judgeFlagged;
  }
  if (Object.prototype.hasOwnProperty.call(row, "judgeFlagReason")) {
    result.llm_flag_reason = row.judgeFlagReason;
  }
  if (Object.prototype.hasOwnProperty.call(row, "judgeFlagBasis")) {
    result.flag_basis = row.judgeFlagBasis;
  }

  return result;
}
