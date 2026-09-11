/**
 * Recursion subgraph mock fixture — exercises the full eval_status contract,
 * multi-edge PRODUCED_BY resolution, rejected-attempt dots, and unresolvable slots.
 *
 * Ontology modelled:
 *   EvalSet
 *     --HAS_BASELINE_TRIGGER--> EvalTrigger (baseline)
 *       --HAS_OUTPUT--> EvalTriggerOutput (baseline output)
 *       --HAS_PROPOSED_FIX--> ProposedFix (root, accepted, eval_status wins over status)
 *         --PRODUCED_BY--> EvalTriggerOutput (rerun-1, higher n_passed)
 *         --DERIVED_FROM-- ProposedFix (derived, accepted via status fallback)
 *                           --PRODUCED_BY--> EvalTriggerOutput (rerun-2)
 *         --DERIVED_FROM-- ProposedFix (multi-edge, accepted)
 *                           --PRODUCED_BY--> EvalTriggerOutput (empty — no n_passed/n_total)
 *                           --PRODUCED_BY--> EvalTriggerOutput (valid — n_passed=32, n_total=33) ← must be picked
 *         --DERIVED_FROM-- ProposedFix (rejected, resolvable via before/after score)
 *         --DERIVED_FROM-- ProposedFix (rejected, no resolvable score — x-slot only)
 *     --HAS_TRIGGER--> EvalTrigger (rerun trigger, casing variant "evaltrigger")
 *       --HAS_PROPOSED_FIX--> ProposedFix (rejected — must NOT appear in accepted series)
 *
 * eval_status coverage:
 *   - fix-root:    eval_status:"accepted"  status:"rejected"  → eval_status wins
 *   - fix-derived: NO eval_status           status:"accepted"  → status fallback
 *   - fix-multi-edge: eval_status:"accepted"                  → picks valid PRODUCED_BY edge
 *   - fix-rejected-scored: eval_status:"rejected"             → x-slot with derived actualPassed
 *   - fix-rejected-unscored: eval_status:"rejected"           → x-slot only, no dot
 *   - fix-rejected (rerun trigger): eval_status:"rejected"    → excluded from accepted series
 */

import type { JarvisNode } from "@/types/jarvis";
import { FIX_SNAPSHOT_SHAPES } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";

// ── Node ref_ids (stable, referenced by edges and tests) ─────────────────────
export const EVAL_SET_ID = "mock-evalset-001"; // same as MOCK_EVAL_SET_REF_ID

// ── Scenario A: Attempt-cap EvalSet ──────────────────────────────────────────
// An EvalSet whose fix history has ≥ RECURSION_MAX_ATTEMPTS (10) total attempts.
// The chain has 10 ProposedFix nodes:
//   - Fixes 1-9: improving (accepted) from baseline trigger
//   - Fix 10: from a SECOND HAS_TRIGGER branch (exercises multi-branch counting)
// Used by computeAttemptStats unit tests to verify attempt-cap detection.
export const ATTEMPT_CAP_EVALSET_ID = "mock-evalset-attempt-cap-001";
const ATTEMPT_CAP_BASELINE_TRIGGER_ID = "mock-evaltrigger-attemptcap-baseline-001";
const ATTEMPT_CAP_BASELINE_OUTPUT_ID = "mock-evaltriggeroutput-attemptcap-baseline-001";
const ATTEMPT_CAP_RERUN_TRIGGER_ID = "mock-evaltrigger-attemptcap-rerun-001";

// 9 fixes in the baseline chain (fixes 1-9)
const ATTEMPT_CAP_FIX_IDS = Array.from({ length: 9 }, (_, i) => `mock-proposedfix-attemptcap-fix-${i + 1}`);
const ATTEMPT_CAP_FIX_OUTPUT_IDS = Array.from({ length: 9 }, (_, i) => `mock-evaltriggeroutput-attemptcap-fix-${i + 1}`);

// Fix 10 from the second trigger branch (exercises multi-branch counting)
export const ATTEMPT_CAP_FIX_BRANCH2_ID = "mock-proposedfix-attemptcap-branch2-001";
// Fix 11 from the second trigger branch that re-enters fix-1 from the first branch
// (exercises cross-branch dedup in walkDerivedFromChain with shared visited set)
export const ATTEMPT_CAP_FIX_BRANCH2_SHARED_ID = ATTEMPT_CAP_FIX_IDS[0]; // same ref_id as fix-1

export const ATTEMPT_CAP_NODE_IDS = {
  ATTEMPT_CAP_EVALSET_ID,
  ATTEMPT_CAP_BASELINE_TRIGGER_ID,
  ATTEMPT_CAP_BASELINE_OUTPUT_ID,
  ATTEMPT_CAP_RERUN_TRIGGER_ID,
  ATTEMPT_CAP_FIX_IDS,
  ATTEMPT_CAP_FIX_OUTPUT_IDS,
  ATTEMPT_CAP_FIX_BRANCH2_ID,
} as const;

// ── Scenario B: Plateau-cap EvalSet ──────────────────────────────────────────
// An EvalSet whose last 3+ attempts haven't beaten the running best.
// Structure:
//   Baseline trigger (n_passed=50, n_total=74)
//     → Fix 1 (accepted, n_passed=60) ← improves best to 60
//     → Fix 2 (accepted, n_passed=55) ← doesn't beat 60 → plateau starts
//   Rerun trigger (second HAS_TRIGGER branch)
//     → Fix 3 (accepted, n_passed=58) ← doesn't beat 60 → plateau continues
//       → Fix 4 (DERIVED_FROM Fix 3, same ref_id as fix-1 from baseline chain — cross-branch dedup)
// Net: 4 fixes total (fix-4 deduped), plateau streak = 3 (fixes 2, 3 still non-improving)
// but fix-3 is from a different branch, exercises multi-branch plateau accounting.
export const PLATEAU_CAP_EVALSET_ID = "mock-evalset-plateau-cap-001";
const PLATEAU_CAP_BASELINE_TRIGGER_ID = "mock-evaltrigger-plateaucap-baseline-001";
const PLATEAU_CAP_BASELINE_OUTPUT_ID = "mock-evaltriggeroutput-plateaucap-baseline-001";
const PLATEAU_CAP_RERUN_TRIGGER_ID = "mock-evaltrigger-plateaucap-rerun-001";

export const PLATEAU_CAP_FIX1_ID = "mock-proposedfix-plateaucap-fix1";
export const PLATEAU_CAP_FIX1_OUTPUT_ID = "mock-evaltriggeroutput-plateaucap-fix1";
export const PLATEAU_CAP_FIX2_ID = "mock-proposedfix-plateaucap-fix2";
export const PLATEAU_CAP_FIX2_OUTPUT_ID = "mock-evaltriggeroutput-plateaucap-fix2";
export const PLATEAU_CAP_FIX3_ID = "mock-proposedfix-plateaucap-fix3";
export const PLATEAU_CAP_FIX3_OUTPUT_ID = "mock-evaltriggeroutput-plateaucap-fix3";
// Fix 4 re-uses fix1's ref_id — simulates the cross-branch node already visited
export const PLATEAU_CAP_FIX4_ID = PLATEAU_CAP_FIX1_ID; // same ref_id → deduped by shared visited

export const PLATEAU_CAP_NODE_IDS = {
  PLATEAU_CAP_EVALSET_ID,
  PLATEAU_CAP_BASELINE_TRIGGER_ID,
  PLATEAU_CAP_BASELINE_OUTPUT_ID,
  PLATEAU_CAP_RERUN_TRIGGER_ID,
  PLATEAU_CAP_FIX1_ID,
  PLATEAU_CAP_FIX1_OUTPUT_ID,
  PLATEAU_CAP_FIX2_ID,
  PLATEAU_CAP_FIX2_OUTPUT_ID,
  PLATEAU_CAP_FIX3_ID,
  PLATEAU_CAP_FIX3_OUTPUT_ID,
} as const;

// ── Scenario C: Concept-only EvalSet (no ProposedFix anywhere) ───────────────
// Models concept-driven recursion: each re-run writes a fresh EvalTrigger +
// EvalTriggerOutput and NO ProposedFix, so buildHillClimbSeries yields a single
// flat baseline point and buildEvalOutputSeries must carry the chart instead.
//
// Covers, in one payload:
//   - a baseline trigger plus two EvalSet-hosted HAS_TRIGGER re-runs
//   - a requirement-hosted trigger (EvalSet -HAS_REQUIREMENT-> EvalRequirement
//     -HAS_TRIGGER-> EvalTrigger), mirroring what legal/benchmarks/run writes
//   - a degenerate output with no n_passed/n_total and judge_notes
//     "0/0 criteria passed" — the shape stakwork-run.ts emits today — which must
//     be DROPPED rather than charted as a 0/0 point
//   - an output whose n_total differs from its siblings, pinning denominator
//     normalization to max(n_total)
//   - one score that goes DOWN, pinning that the line traces real scores
export const CONCEPT_ONLY_EVALSET_ID = "mock-evalset-concept-only-001";

/** Fixed epoch base so point ordering in this scenario is deterministic. */
export const CONCEPT_ONLY_BASE_TS = 1760000000;

export const CONCEPT_ONLY_BASELINE_TRIGGER_ID = "mock-evaltrigger-conceptonly-baseline-001";
export const CONCEPT_ONLY_BASELINE_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-baseline-001";
export const CONCEPT_ONLY_RERUN1_TRIGGER_ID = "mock-evaltrigger-conceptonly-rerun-001";
export const CONCEPT_ONLY_RERUN1_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-rerun-001";
export const CONCEPT_ONLY_RERUN2_TRIGGER_ID = "mock-evaltrigger-conceptonly-rerun-002";
export const CONCEPT_ONLY_RERUN2_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-rerun-002";
export const CONCEPT_ONLY_REQUIREMENT_ID = "mock-evalrequirement-conceptonly-001";
export const CONCEPT_ONLY_REQ_TRIGGER_ID = "mock-evaltrigger-conceptonly-req-001";
export const CONCEPT_ONLY_REQ_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-req-001";
export const CONCEPT_ONLY_DEGENERATE_TRIGGER_ID = "mock-evaltrigger-conceptonly-degenerate-001";
export const CONCEPT_ONLY_DEGENERATE_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-degenerate-001";
export const CONCEPT_ONLY_WIDE_TRIGGER_ID = "mock-evaltrigger-conceptonly-wide-001";
export const CONCEPT_ONLY_WIDE_OUTPUT_ID = "mock-evaltriggeroutput-conceptonly-wide-001";

export const CONCEPT_ONLY_NODE_IDS = {
  CONCEPT_ONLY_EVALSET_ID,
  CONCEPT_ONLY_BASELINE_TRIGGER_ID,
  CONCEPT_ONLY_BASELINE_OUTPUT_ID,
  CONCEPT_ONLY_RERUN1_TRIGGER_ID,
  CONCEPT_ONLY_RERUN1_OUTPUT_ID,
  CONCEPT_ONLY_RERUN2_TRIGGER_ID,
  CONCEPT_ONLY_RERUN2_OUTPUT_ID,
  CONCEPT_ONLY_REQUIREMENT_ID,
  CONCEPT_ONLY_REQ_TRIGGER_ID,
  CONCEPT_ONLY_REQ_OUTPUT_ID,
  CONCEPT_ONLY_DEGENERATE_TRIGGER_ID,
  CONCEPT_ONLY_DEGENERATE_OUTPUT_ID,
  CONCEPT_ONLY_WIDE_TRIGGER_ID,
  CONCEPT_ONLY_WIDE_OUTPUT_ID,
} as const;

const BASELINE_TRIGGER_ID = "mock-evaltrigger-baseline-001";
const BASELINE_OUTPUT_ID = "mock-evaltriggeroutput-baseline-001";

const RERUN_TRIGGER_ID = "mock-evaltrigger-rerun-001"; // casing variant node_type
// The rerun trigger scores an output of its own — without this the widened
// walk (HAS_BASELINE_TRIGGER + HAS_TRIGGER) has no non-baseline HAS_OUTPUT to
// exercise, so the concept-driven path would be untested against this fixture.
export const RERUN_TRIGGER_OUTPUT_ID = "mock-evaltriggeroutput-rerun-trigger-001";

const FIX_ROOT_ID = "mock-proposedfix-root-001";
const FIX_ROOT_RERUN_OUTPUT_ID = "mock-evaltriggeroutput-rerun-001";

const FIX_DERIVED_ID = "mock-proposedfix-derived-001";
const FIX_DERIVED_RERUN_OUTPUT_ID = "mock-evaltriggeroutput-rerun-002";

// ── NEW: Multi-edge PRODUCED_BY fix (accepted) ──────────────────────────────
// Two PRODUCED_BY edges: one empty output, one valid (n_passed=32, n_total=33)
export const FIX_MULTI_EDGE_ID = "mock-proposedfix-multiedge-001";
const FIX_MULTI_EDGE_EMPTY_OUTPUT_ID = "mock-evaltriggeroutput-multiedge-empty-001";
export const FIX_MULTI_EDGE_VALID_OUTPUT_ID = "mock-evaltriggeroutput-multiedge-valid-001";

// ── NEW: Rejected fix with resolvable score (before/after) ──────────────────
export const FIX_REJECTED_SCORED_ID = "mock-proposedfix-rejected-scored-001";

// ── NEW: Rejected fix with NO resolvable score (x-slot only) ────────────────
export const FIX_REJECTED_UNSCORED_ID = "mock-proposedfix-rejected-unscored-001";

const FIX_REJECTED_ID = "mock-proposedfix-rejected-001";

const now = () => String(Math.floor(Date.now() / 1000));

// ── Nodes ─────────────────────────────────────────────────────────────────────
export function buildRecursionNodes(): JarvisNode[] {
  const ts = now();
  return [
    // ── EvalSet root ─────────────────────────────────────────────────────────
    {
      ref_id: EVAL_SET_ID,
      // Intentional casing variant to exercise case-insensitive matching
      node_type: "Evalset",
      date_added_to_graph: ts,
      properties: {
        name: "Mock Legal Benchmark EvalSet",
        description: "Fixture EvalSet for recursion hill-climb chart tests",
        task_slug: "mock-task-001",
      },
    },

    // ── Baseline EvalTrigger ──────────────────────────────────────────────────
    {
      ref_id: BASELINE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: ts,
      properties: {
        agent: "mock-agent",
        start_point: "start",
        end_point: "end",
        environment: "test",
        run_count: 1,
        change_type: "baseline",
      },
    },

    // ── Baseline EvalTriggerOutput (n_passed=50, n_total=74) ──────────────────
    {
      ref_id: BASELINE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 1,
        result: "pass",
        score: 50,
        n_passed: 50,
        n_total: 74,
        judge_notes: "50/74 criteria passed (baseline run)",
        // Written onto the node by the Stakwork eval workflow — the activity
        // rail links it directly for graph-only rows.
        report_url: "https://example.com/reports/mock-baseline-report",
      },
    },

    // ── Root accepted ProposedFix ─────────────────────────────────────────────
    // eval_status:"accepted" CONFLICTS with legacy status:"rejected"
    // → consumer must key off eval_status, not status
    {
      ref_id: FIX_ROOT_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-001",
        criterion_title: "Mock criterion A",
        prompt_name: "mock-prompt",
        prompt_id: "prompt-001",
        prompt_version_id: "v1",
        new_prompt_version_id: "v2",
        failing_value: "old value",
        passing_value: "new value",
        delta: "Updated prompt wording",
        reasoning: "The old wording caused failures",
        // ── eval_status contract: canonical field ──
        eval_status: "accepted",
        // ── legacy status field conflicts — eval_status must win ──
        status: "rejected",
        before_score: "50",
        after_score: "54",
        score_delta: "+4",
        // rerun_run_id matches PRODUCED_BY output ref_id
        rerun_run_id: FIX_ROOT_RERUN_OUTPUT_ID,
        rerun_status: "completed",
        // Snapshot: prompt-target edit (body under `text`)
        ...FIX_SNAPSHOT_SHAPES.promptEdit,
      },
    },

    // ── Rerun EvalTriggerOutput for root fix (n_passed=54, higher than baseline) ─
    {
      ref_id: FIX_ROOT_RERUN_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 2,
        result: "pass",
        score: 54,
        n_passed: 54,
        n_total: 74,
        judge_notes: "54/74 criteria passed (rerun after root fix)",
        report_url: "https://example.com/reports/mock-rerun-report-001",
      },
    },

    // ── Derived accepted ProposedFix ──────────────────────────────────────────
    // NO eval_status → consumer falls back to status field ("accepted")
    {
      ref_id: FIX_DERIVED_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-002",
        criterion_title: "Mock criterion B",
        prompt_name: "mock-prompt",
        prompt_id: "prompt-001",
        prompt_version_id: "v2",
        new_prompt_version_id: "v3",
        failing_value: "old derived value",
        passing_value: "new derived value",
        delta: "Further refinement",
        reasoning: "Building on root fix",
        // ── NO eval_status — exercises status fallback path ──
        status: "accepted",
        before_score: "54",
        after_score: "58",
        score_delta: "+4",
        rerun_run_id: FIX_DERIVED_RERUN_OUTPUT_ID,
        rerun_status: "completed",
        // Snapshot: concept edit with the body under the live `docs` key
        ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
      },
    },

    // ── Rerun EvalTriggerOutput for derived fix (n_passed=58) ─────────────────
    {
      ref_id: FIX_DERIVED_RERUN_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 3,
        result: "pass",
        score: 58,
        n_passed: 58,
        n_total: 74,
        judge_notes: "58/74 criteria passed (rerun after derived fix)",
      },
    },

    // ── Rerun EvalTrigger (casing variant: "evaltrigger") ─────────────────────
    {
      ref_id: RERUN_TRIGGER_ID,
      // Intentional lowercase to exercise case-insensitive matching
      node_type: "evaltrigger",
      date_added_to_graph: ts,
      properties: {
        agent: "mock-agent",
        start_point: "start",
        end_point: "end",
        environment: "test",
        run_count: 1,
        change_type: "rerun",
      },
    },

    // ── Rerun EvalTrigger's own output (n_passed=51, n_total=74) ─────────────
    {
      ref_id: RERUN_TRIGGER_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 2,
        result: "partial",
        score: 51,
        n_passed: 51,
        n_total: 74,
        judge_notes: "51/74 criteria passed (rerun trigger own output)",
      },
    },

    // ── NEW: Multi-edge accepted ProposedFix ──────────────────────────────────
    // Has TWO PRODUCED_BY edges: one empty EvalTriggerOutput (no n_passed/n_total),
    // one valid (n_passed=32, n_total=33). The builder must pick the valid one.
    {
      ref_id: FIX_MULTI_EDGE_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-multi",
        criterion_title: "Mock criterion multi-edge",
        eval_status: "accepted",
        before_score: "58",
        after_score: "32",
        rerun_run_id: null,
        // Snapshot: concept CREATE (no old_value, body under `documentation`)
        ...FIX_SNAPSHOT_SHAPES.conceptCreate,
      },
    },

    // ── Empty EvalTriggerOutput (no n_passed/n_total) — must NOT be picked ────
    {
      ref_id: FIX_MULTI_EDGE_EMPTY_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 4,
        result: "",
        score: 0,
        // Intentionally no n_passed / n_total — exercises the "skip empty" path
      },
    },

    // ── Valid EvalTriggerOutput (n_passed=32, n_total=33) — must be picked ────
    {
      ref_id: FIX_MULTI_EDGE_VALID_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: {
        attempt_number: 5,
        result: "partial",
        score: 32 / 33,
        n_passed: 32,
        n_total: 33,
        judge_notes: "32/33 criteria passed (multi-edge valid output)",
      },
    },

    // ── NEW: Rejected ProposedFix with resolvable score ───────────────────────
    // Score derivable via before_score/after_score → actualPassed approximation
    // Current FIX_REJECTED_ID has no PRODUCED_BY edge and rerun_run_id: null.
    // This new node builds on that pattern but has a valid after_score to derive from.
    {
      ref_id: FIX_REJECTED_SCORED_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-rejected-scored",
        criterion_title: "Mock criterion rejected-scored",
        eval_status: "rejected",
        status: "rejected",
        before_score: "58",
        after_score: "55",
        score_delta: "-3",
        rerun_run_id: null,
        rerun_status: null,
        // Snapshot: a REJECTED fix carrying a good `documentation` edit — the
        // reader must still surface this diff, badged rejected.
        ...FIX_SNAPSHOT_SHAPES.conceptEditDocumentation,
      },
    },

    // ── NEW: Rejected ProposedFix with NO resolvable score ────────────────────
    // No PRODUCED_BY edge, no rerun_run_id, no after_score → x-slot only, dot skipped
    {
      ref_id: FIX_REJECTED_UNSCORED_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-rejected-unscored",
        criterion_title: "Mock criterion rejected-unscored",
        eval_status: "rejected",
        status: "rejected",
        rerun_run_id: null,
        rerun_status: null,
        // No before_score / after_score → unresolvable
        // Snapshot: unparseable new_value — the rail's slot row still carries
        // it, and the reader renders the raw-envelope fallback banner.
        ...FIX_SNAPSHOT_SHAPES.conceptUnparseable,
      },
    },

    // ── Rejected ProposedFix (original — must NOT appear in accepted series) ──
    // Deliberately carries NO snapshot fields (legacy fix shape) — like the
    // attempt-cap and plateau-cap fixes, it pins the no-snapshot path: no
    // sidecar entry, no rail diff control.
    {
      ref_id: FIX_REJECTED_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        criterion_id: "criterion-003",
        criterion_title: "Mock criterion C",
        prompt_name: "mock-prompt",
        prompt_id: "prompt-001",
        eval_status: "rejected",
        status: "rejected",
        before_score: "50",
        after_score: "48",
        score_delta: "-2",
        rerun_run_id: null,
        rerun_status: null,
      },
    },
  ];
}

// ── Edges ─────────────────────────────────────────────────────────────────────
export function buildRecursionEdges() {
  return [
    // EvalSet → baseline trigger
    { source: EVAL_SET_ID, target: BASELINE_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
    // EvalSet → rerun trigger
    { source: EVAL_SET_ID, target: RERUN_TRIGGER_ID, edge_type: "HAS_TRIGGER" },

    // Baseline trigger → baseline output
    { source: BASELINE_TRIGGER_ID, target: BASELINE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
    // Baseline trigger → root fix
    { source: BASELINE_TRIGGER_ID, target: FIX_ROOT_ID, edge_type: "HAS_PROPOSED_FIX" },

    // Root fix → its rerun output (PRODUCED_BY — primary score hop)
    { source: FIX_ROOT_ID, target: FIX_ROOT_RERUN_OUTPUT_ID, edge_type: "PRODUCED_BY" },

    // Derived fix ← root fix (DERIVED_FROM chain)
    { source: FIX_DERIVED_ID, target: FIX_ROOT_ID, edge_type: "DERIVED_FROM" },
    // Derived fix → its rerun output
    { source: FIX_DERIVED_ID, target: FIX_DERIVED_RERUN_OUTPUT_ID, edge_type: "PRODUCED_BY" },

    // Multi-edge fix derived from derived fix
    { source: FIX_MULTI_EDGE_ID, target: FIX_DERIVED_ID, edge_type: "DERIVED_FROM" },
    // Multi-edge fix → empty output (no n_passed/n_total — must be skipped)
    { source: FIX_MULTI_EDGE_ID, target: FIX_MULTI_EDGE_EMPTY_OUTPUT_ID, edge_type: "PRODUCED_BY" },
    // Multi-edge fix → valid output (n_passed=32, n_total=33 — must be picked)
    { source: FIX_MULTI_EDGE_ID, target: FIX_MULTI_EDGE_VALID_OUTPUT_ID, edge_type: "PRODUCED_BY" },

    // Rejected fix with resolvable score (derived from multi-edge fix)
    { source: FIX_REJECTED_SCORED_ID, target: FIX_MULTI_EDGE_ID, edge_type: "DERIVED_FROM" },
    // (No PRODUCED_BY edge — score resolved via before/after derivation)

    // Rejected fix with no resolvable score (derived from rejected-scored)
    { source: FIX_REJECTED_UNSCORED_ID, target: FIX_REJECTED_SCORED_ID, edge_type: "DERIVED_FROM" },
    // (No PRODUCED_BY edge, no after_score — x-slot only)

    // Rerun trigger → its own output (exercises the widened HAS_TRIGGER walk)
    { source: RERUN_TRIGGER_ID, target: RERUN_TRIGGER_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    // Rerun trigger → rejected fix (original — attached to rerun trigger, not baseline)
    { source: RERUN_TRIGGER_ID, target: FIX_REJECTED_ID, edge_type: "HAS_PROPOSED_FIX" },
  ];
}

// ── Scenario A: Attempt-cap builder ──────────────────────────────────────────

/**
 * Build nodes for the attempt-cap scenario (10 total ProposedFix nodes,
 * spanning 2 trigger branches, with a cross-branch shared node).
 *
 * Branch 1 (HAS_BASELINE_TRIGGER): fixes 1-9 (improving chain)
 * Branch 2 (HAS_TRIGGER): fix-branch2 + one DERIVED_FROM re-entry into fix-1
 * → walkDerivedFromChain with shared visited set must count fix-1 once
 * → total unique fixes = 10 (9 + 1 branch2-only fix; re-entry is deduped)
 */
export function buildAttemptCapNodes(): JarvisNode[] {
  const ts = String(Math.floor(Date.now() / 1000));
  const nodes: JarvisNode[] = [
    // EvalSet root
    {
      ref_id: ATTEMPT_CAP_EVALSET_ID,
      node_type: "EvalSet",
      date_added_to_graph: ts,
      properties: { name: "Attempt Cap Test EvalSet" },
    },
    // Baseline trigger
    {
      ref_id: ATTEMPT_CAP_BASELINE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: ts,
      properties: { agent: "test-agent", start_point: "s", end_point: "e" },
    },
    // Baseline output (n_passed=50, n_total=100)
    {
      ref_id: ATTEMPT_CAP_BASELINE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: { attempt_number: 1, result: "pass", score: 50, n_passed: 50, n_total: 100 },
    },
    // Rerun trigger (second branch, exercises HAS_TRIGGER counting)
    {
      ref_id: ATTEMPT_CAP_RERUN_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: ts,
      properties: { agent: "test-agent", start_point: "s", end_point: "e" },
    },
    // Fix from branch 2 (unique: not in branch 1's chain)
    {
      ref_id: ATTEMPT_CAP_FIX_BRANCH2_ID,
      node_type: "ProposedFix",
      date_added_to_graph: ts,
      properties: {
        eval_status: "accepted",
        after_score: "65",
        // Snapshot: legacy fix_type fallback (no target_type) — rail-reachable
        // through the attemptCap fix-chain scenario. The stats tests ignore
        // snapshot props entirely.
        ...FIX_SNAPSHOT_SHAPES.legacyFixType,
      },
    },
  ];

  // Fixes 1-9 in the baseline chain (each with an improving score)
  const ATTEMPT_CAP_FIX_IDS_LOCAL = Array.from({ length: 9 }, (_, i) => `mock-proposedfix-attemptcap-fix-${i + 1}`);
  const ATTEMPT_CAP_FIX_OUTPUT_IDS_LOCAL = Array.from({ length: 9 }, (_, i) => `mock-evaltriggeroutput-attemptcap-fix-${i + 1}`);

  for (let i = 0; i < 9; i++) {
    const nPassed = 50 + (i + 1) * 3; // 53, 56, ..., 74
    nodes.push({
      ref_id: ATTEMPT_CAP_FIX_IDS_LOCAL[i],
      node_type: "ProposedFix",
      date_added_to_graph: String(Number(ts) + i + 1),
      properties: {
        eval_status: "accepted",
        after_score: String(nPassed),
      },
    });
    nodes.push({
      ref_id: ATTEMPT_CAP_FIX_OUTPUT_IDS_LOCAL[i],
      node_type: "EvalTriggerOutput",
      date_added_to_graph: String(Number(ts) + i + 1),
      properties: {
        attempt_number: i + 2,
        result: "pass",
        score: nPassed / 100,
        n_passed: nPassed,
        n_total: 100,
      },
    });
  }

  return nodes;
}

export function buildAttemptCapEdges() {
  const ATTEMPT_CAP_FIX_IDS_LOCAL = Array.from({ length: 9 }, (_, i) => `mock-proposedfix-attemptcap-fix-${i + 1}`);
  const ATTEMPT_CAP_FIX_OUTPUT_IDS_LOCAL = Array.from({ length: 9 }, (_, i) => `mock-evaltriggeroutput-attemptcap-fix-${i + 1}`);

  const edges: { source: string; target: string; edge_type: string }[] = [
    { source: ATTEMPT_CAP_EVALSET_ID, target: ATTEMPT_CAP_BASELINE_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
    { source: ATTEMPT_CAP_EVALSET_ID, target: ATTEMPT_CAP_RERUN_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: ATTEMPT_CAP_BASELINE_TRIGGER_ID, target: ATTEMPT_CAP_BASELINE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
    { source: ATTEMPT_CAP_BASELINE_TRIGGER_ID, target: ATTEMPT_CAP_FIX_IDS_LOCAL[0], edge_type: "HAS_PROPOSED_FIX" },
    // Rerun trigger → branch2 fix (10th fix across both branches)
    { source: ATTEMPT_CAP_RERUN_TRIGGER_ID, target: ATTEMPT_CAP_FIX_BRANCH2_ID, edge_type: "HAS_PROPOSED_FIX" },
    // Branch2 fix DERIVED_FROM fix-1 (cross-branch dedup: fix-1 already visited)
    { source: ATTEMPT_CAP_FIX_BRANCH2_ID, target: ATTEMPT_CAP_FIX_IDS_LOCAL[0], edge_type: "DERIVED_FROM" },
  ];

  // Chain: fix-1 → fix-2 → ... → fix-9 (DERIVED_FROM edges)
  for (let i = 1; i < 9; i++) {
    edges.push({
      source: ATTEMPT_CAP_FIX_IDS_LOCAL[i],
      target: ATTEMPT_CAP_FIX_IDS_LOCAL[i - 1],
      edge_type: "DERIVED_FROM",
    });
  }
  // Each fix PRODUCED_BY its output
  for (let i = 0; i < 9; i++) {
    edges.push({
      source: ATTEMPT_CAP_FIX_IDS_LOCAL[i],
      target: ATTEMPT_CAP_FIX_OUTPUT_IDS_LOCAL[i],
      edge_type: "PRODUCED_BY",
    });
  }

  return edges;
}

// ── Scenario B: Plateau-cap builder ──────────────────────────────────────────

/**
 * Build nodes for the plateau-cap scenario.
 *
 * Baseline (n_passed=50):
 *   Fix 1 (accepted, 60) → improves best to 60
 *   Fix 2 (accepted, 55) → below 60, plateau starts
 * Second trigger branch:
 *   Fix 3 (accepted, 58) → below 60, plateau continues
 *   Fix 4 DERIVED_FROM Fix 3, ALSO DERIVED_FROM fix-1 (already visited via cross-branch dedup)
 *     → fix-4 reuses PLATEAU_CAP_FIX1_ID, so it is deduplicated (counted once)
 *
 * Net: 3 unique scored attempts post-baseline (fix-1, fix-2, fix-3)
 * Plateau streak: 2 consecutive trailing non-improving (fix-2=55, fix-3=58 < 60)
 */
export function buildPlateauCapNodes(): JarvisNode[] {
  const ts = String(Math.floor(Date.now() / 1000));
  return [
    {
      ref_id: PLATEAU_CAP_EVALSET_ID,
      node_type: "EvalSet",
      date_added_to_graph: ts,
      properties: { name: "Plateau Cap Test EvalSet" },
    },
    {
      ref_id: PLATEAU_CAP_BASELINE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: ts,
      properties: { agent: "test-agent", start_point: "s", end_point: "e" },
    },
    {
      ref_id: PLATEAU_CAP_BASELINE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: ts,
      properties: { attempt_number: 1, result: "pass", score: 50, n_passed: 50, n_total: 100 },
    },
    {
      ref_id: PLATEAU_CAP_RERUN_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: ts,
      properties: { agent: "test-agent", start_point: "s", end_point: "e" },
    },
    // Fix 1: improving (60 > 50 → best becomes 60)
    {
      ref_id: PLATEAU_CAP_FIX1_ID,
      node_type: "ProposedFix",
      date_added_to_graph: String(Number(ts) + 1),
      // Snapshot with NO target_ref — the rail's dialog must suppress the
      // live-node link, not render a broken one.
      properties: { eval_status: "accepted", ...FIX_SNAPSHOT_SHAPES.conceptEditNoRef },
    },
    {
      ref_id: PLATEAU_CAP_FIX1_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: String(Number(ts) + 1),
      properties: { attempt_number: 2, result: "pass", score: 0.6, n_passed: 60, n_total: 100 },
    },
    // Fix 2: non-improving (55 < 60 → plateau streak = 1)
    {
      ref_id: PLATEAU_CAP_FIX2_ID,
      node_type: "ProposedFix",
      date_added_to_graph: String(Number(ts) + 2),
      // Snapshot: valid JSON with no recognizable body key → renders the
      // empty state, never the unparseable banner.
      properties: { eval_status: "accepted", ...FIX_SNAPSHOT_SHAPES.conceptNoBodyKey },
    },
    {
      ref_id: PLATEAU_CAP_FIX2_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: String(Number(ts) + 2),
      properties: { attempt_number: 3, result: "pass", score: 0.55, n_passed: 55, n_total: 100 },
    },
    // Fix 3: non-improving from second trigger branch (58 < 60 → plateau streak = 2)
    {
      ref_id: PLATEAU_CAP_FIX3_ID,
      node_type: "ProposedFix",
      date_added_to_graph: String(Number(ts) + 3),
      properties: { eval_status: "accepted" },
    },
    {
      ref_id: PLATEAU_CAP_FIX3_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: String(Number(ts) + 3),
      properties: { attempt_number: 4, result: "pass", score: 0.58, n_passed: 58, n_total: 100 },
    },
    // Fix 4: DERIVED_FROM fix-3 AND conceptually referencing fix-1 via DERIVED_FROM
    // but fix-1 (PLATEAU_CAP_FIX4_ID === PLATEAU_CAP_FIX1_ID) is already visited
    // via the baseline branch walk → deduplicated, not double-counted
    // (No separate node needed — PLATEAU_CAP_FIX4_ID === PLATEAU_CAP_FIX1_ID)
  ];
}

export function buildPlateauCapEdges() {
  return [
    { source: PLATEAU_CAP_EVALSET_ID, target: PLATEAU_CAP_BASELINE_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
    { source: PLATEAU_CAP_EVALSET_ID, target: PLATEAU_CAP_RERUN_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: PLATEAU_CAP_BASELINE_TRIGGER_ID, target: PLATEAU_CAP_BASELINE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
    { source: PLATEAU_CAP_BASELINE_TRIGGER_ID, target: PLATEAU_CAP_FIX1_ID, edge_type: "HAS_PROPOSED_FIX" },
    { source: PLATEAU_CAP_FIX1_ID, target: PLATEAU_CAP_FIX1_OUTPUT_ID, edge_type: "PRODUCED_BY" },
    // Fix 2 derived from fix 1
    { source: PLATEAU_CAP_FIX2_ID, target: PLATEAU_CAP_FIX1_ID, edge_type: "DERIVED_FROM" },
    { source: PLATEAU_CAP_FIX2_ID, target: PLATEAU_CAP_FIX2_OUTPUT_ID, edge_type: "PRODUCED_BY" },
    // Second trigger branch → fix 3
    { source: PLATEAU_CAP_RERUN_TRIGGER_ID, target: PLATEAU_CAP_FIX3_ID, edge_type: "HAS_PROPOSED_FIX" },
    { source: PLATEAU_CAP_FIX3_ID, target: PLATEAU_CAP_FIX3_OUTPUT_ID, edge_type: "PRODUCED_BY" },
    // Fix 3 DERIVED_FROM fix 2 (links the chains)
    { source: PLATEAU_CAP_FIX3_ID, target: PLATEAU_CAP_FIX2_ID, edge_type: "DERIVED_FROM" },
    // Cross-branch dedup: branch2 also has a DERIVED_FROM pointing at fix-1
    // which is already visited under branch1 walk → counted once
    { source: PLATEAU_CAP_FIX3_ID, target: PLATEAU_CAP_FIX1_ID, edge_type: "DERIVED_FROM" },
  ];
}

// ── Scenario C: Concept-only builder ─────────────────────────────────────────

/**
 * Build nodes for the concept-only scenario. ZERO ProposedFix nodes — every
 * re-run is its own EvalTrigger + EvalTriggerOutput, which is what
 * concept-driven recursion actually writes.
 *
 * Expected `buildEvalOutputSeries` result (denominator normalized to 80):
 *   base 50/80 · r1 58/80 · r2 52/80 (down) · r3 61/80 · r4 64/80
 * The degenerate 0/0 output is dropped, never charted.
 *
 * Kept as its OWN builder rather than folded into `buildRecursionNodes()`:
 * the EvalSet locator is `nodes.find((n) => isNodeType(n, "EvalSet"))`, so two
 * EvalSet nodes in one payload would silently resolve to whichever came first.
 */
export function buildConceptOnlyNodes(): JarvisNode[] {
  const at = (offsetSeconds: number) => String(CONCEPT_ONLY_BASE_TS + offsetSeconds);
  const identity = { agent: "concept-agent", start_point: "start", end_point: "end" };

  return [
    {
      ref_id: CONCEPT_ONLY_EVALSET_ID,
      node_type: "EvalSet",
      date_added_to_graph: at(0),
      properties: {
        name: "Concept-only Recursion EvalSet",
        description: "Re-run via concepts — no ProposedFix nodes are ever written",
        task_slug: "mock-concept-task-001",
      },
    },

    // ── Baseline: EvalSet --HAS_BASELINE_TRIGGER--> trigger --HAS_OUTPUT--> ──
    {
      ref_id: CONCEPT_ONLY_BASELINE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: at(0),
      properties: { ...identity, environment: "test", change_type: "baseline" },
    },
    {
      ref_id: CONCEPT_ONLY_BASELINE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(0),
      properties: {
        attempt_number: 1,
        result: "partial",
        score: 50 / 74,
        n_passed: 50,
        n_total: 74,
        judge_notes: "50/74 criteria passed (concept baseline)",
      },
    },

    // ── Re-run 1: EvalSet-hosted HAS_TRIGGER, score improves ────────────────
    {
      ref_id: CONCEPT_ONLY_RERUN1_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: at(3600),
      properties: { ...identity, environment: "test", change_type: "concept_rerun" },
    },
    {
      ref_id: CONCEPT_ONLY_RERUN1_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(3600),
      properties: {
        attempt_number: 1,
        result: "partial",
        score: 58 / 74,
        n_passed: 58,
        n_total: 74,
        judge_notes: "58/74 criteria passed (concept re-run 1)",
      },
    },

    // ── Re-run 2: score goes DOWN — pins that the line traces real scores ────
    {
      ref_id: CONCEPT_ONLY_RERUN2_TRIGGER_ID,
      // Intentional lowercase to exercise case-insensitive node_type matching
      node_type: "evaltrigger",
      date_added_to_graph: at(7200),
      properties: { ...identity, environment: "test", change_type: "concept_rerun" },
    },
    {
      ref_id: CONCEPT_ONLY_RERUN2_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(7200),
      properties: {
        attempt_number: 1,
        result: "partial",
        score: 52 / 74,
        n_passed: 52,
        n_total: 74,
        judge_notes: "52/74 criteria passed (concept re-run 2 — regression)",
      },
    },

    // ── Requirement-hosted trigger — the shape legal/benchmarks/run writes ───
    {
      ref_id: CONCEPT_ONLY_REQUIREMENT_ID,
      node_type: "EvalRequirement",
      date_added_to_graph: at(0),
      properties: { id: "C-001", name: "Concept requirement" },
    },
    {
      ref_id: CONCEPT_ONLY_REQ_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: at(10800),
      properties: {
        ...identity,
        agent: "wfe-agent",
        source: "provider_direct",
        environment: "test",
      },
    },
    {
      ref_id: CONCEPT_ONLY_REQ_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(10800),
      properties: {
        attempt_number: 1,
        result: "partial",
        score: 61 / 74,
        n_passed: 61,
        n_total: 74,
        judge_notes: "61/74 criteria passed (requirement-hosted run)",
      },
    },

    // ── Degenerate output — no counts, "0/0 criteria passed" → must be dropped ─
    {
      ref_id: CONCEPT_ONLY_DEGENERATE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: at(14400),
      properties: { ...identity, environment: "test" },
    },
    {
      ref_id: CONCEPT_ONLY_DEGENERATE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(14400),
      properties: {
        attempt_number: 1,
        result: "",
        score: 0,
        // No n_passed / n_total properties at all — exactly what stakwork-run.ts
        // writes; the judge_notes parser would otherwise yield a 0/0 point.
        judge_notes: "0/0 criteria passed. Judge: unknown",
      },
    },

    // ── Wider denominator — pins normalization to max(n_total) ──────────────
    {
      ref_id: CONCEPT_ONLY_WIDE_TRIGGER_ID,
      node_type: "EvalTrigger",
      date_added_to_graph: at(18000),
      properties: { ...identity, environment: "test" },
    },
    {
      ref_id: CONCEPT_ONLY_WIDE_OUTPUT_ID,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: at(18000),
      properties: {
        attempt_number: 1,
        result: "partial",
        score: 64 / 80,
        n_passed: 64,
        n_total: 80,
        judge_notes: "64/80 criteria passed (rubric roster grew)",
      },
    },
  ];
}

export function buildConceptOnlyEdges() {
  return [
    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_BASELINE_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
    { source: CONCEPT_ONLY_BASELINE_TRIGGER_ID, target: CONCEPT_ONLY_BASELINE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_RERUN1_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: CONCEPT_ONLY_RERUN1_TRIGGER_ID, target: CONCEPT_ONLY_RERUN1_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_RERUN2_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: CONCEPT_ONLY_RERUN2_TRIGGER_ID, target: CONCEPT_ONLY_RERUN2_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    // Requirement-hosted: the trigger hangs off the EvalRequirement, NOT the EvalSet
    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_REQUIREMENT_ID, edge_type: "HAS_REQUIREMENT" },
    { source: CONCEPT_ONLY_REQUIREMENT_ID, target: CONCEPT_ONLY_REQ_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: CONCEPT_ONLY_REQ_TRIGGER_ID, target: CONCEPT_ONLY_REQ_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_DEGENERATE_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: CONCEPT_ONLY_DEGENERATE_TRIGGER_ID, target: CONCEPT_ONLY_DEGENERATE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },

    { source: CONCEPT_ONLY_EVALSET_ID, target: CONCEPT_ONLY_WIDE_TRIGGER_ID, edge_type: "HAS_TRIGGER" },
    { source: CONCEPT_ONLY_WIDE_TRIGGER_ID, target: CONCEPT_ONLY_WIDE_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
  ];
}

export const RECURSION_NODE_IDS = {
  EVAL_SET_ID,
  BASELINE_TRIGGER_ID,
  BASELINE_OUTPUT_ID,
  RERUN_TRIGGER_ID,
  RERUN_TRIGGER_OUTPUT_ID,
  FIX_ROOT_ID,
  FIX_ROOT_RERUN_OUTPUT_ID,
  FIX_DERIVED_ID,
  FIX_DERIVED_RERUN_OUTPUT_ID,
  FIX_MULTI_EDGE_ID,
  FIX_MULTI_EDGE_EMPTY_OUTPUT_ID,
  FIX_MULTI_EDGE_VALID_OUTPUT_ID,
  FIX_REJECTED_SCORED_ID,
  FIX_REJECTED_UNSCORED_ID,
  FIX_REJECTED_ID,
} as const;

// ── Concept-sibling fixture (opt-in only) ─────────────────────────────────────
//
// A single eval run emitting 6 sibling concept ProposedFix nodes, all sharing
// one EvalTriggerOutput via PRODUCED_BY and all hanging off the same EvalTrigger
// via HAS_PROPOSED_FIX.  Three variant groups cover the reconciliation and
// fallback-tier test cases.
//
// SECURITY NOTE: Do NOT fold these into the default buildRecursionNodes/Edges
// arrays.  The mock Jarvis graph route (`api/mock/jarvis/graph/route.ts`) has
// no requireAuth/workspace guard of its own — it relies solely on the
// production-path block in `src/middleware.ts`.  Anything folded into the
// default payload is therefore served unauthenticated on every non-production
// deployment.  The `withConceptSiblings` composer is activated only when
// `NODE_ENV !== "production"` AND the request carries `?fixture=concept-siblings`.

// ── Group A: 6 fully-materialized sibling concept fixes ──────────────────────
export const CONCEPT_SIBLING_EVALSET_ID = "mock-evalset-concept-siblings-001";
const CONCEPT_SIBLING_TRIGGER_ID = "mock-evaltrigger-concept-siblings-001";
const CONCEPT_SIBLING_OUTPUT_ID = "mock-evaltriggeroutput-concept-siblings-001";

// 6 ProposedFix nodes — all PRODUCED_BY the same EvalTriggerOutput, all
// HAS_PROPOSED_FIX from the same EvalTrigger, all target_type:"concept",
// eval_status:"accepted", distinct target_name, no criterion_id/prompt_id.
// The LAST sibling (index 5) deliberately has NO snapshot-bearing properties
// so tests can assert siblingCount===6 while fixSnapshots.length===5.
const CONCEPT_SIBLING_FIX_IDS = Array.from({ length: 6 }, (_, i) =>
  `mock-proposedfix-concept-sibling-${i + 1}-001`,
);
export const CONCEPT_SIBLING_FIX_NO_SNAPSHOT_ID = CONCEPT_SIBLING_FIX_IDS[5];

const CONCEPT_SIBLING_TARGET_NAMES = [
  "Limitation of Liability",
  "Indemnification Scope",
  "Force Majeure Triggers",
  "Governing Law",
  "Assignment Restrictions",
  "Arbitration Venue", // ← this one has no snapshot properties
];

const SHARED_RUN_ID = "concept-siblings-run-001";

// ── Group B: 2 pending siblings (no output, shared run id) ───────────────────
export const CONCEPT_PENDING_EVALSET_ID = "mock-evalset-concept-pending-001";
const CONCEPT_PENDING_TRIGGER_ID = "mock-evaltrigger-concept-pending-001";
const CONCEPT_PENDING_FIX_IDS = ["mock-proposedfix-concept-pending-1", "mock-proposedfix-concept-pending-2"];
const PENDING_RUN_ID = "concept-pending-run-001";

// ── Group C: 3+3 mixed-materialization siblings ───────────────────────────────
export const CONCEPT_MIXED_EVALSET_ID = "mock-evalset-concept-mixed-001";
const CONCEPT_MIXED_TRIGGER_ID = "mock-evaltrigger-concept-mixed-001";
const CONCEPT_MIXED_OUTPUT_ID = "mock-evaltriggeroutput-concept-mixed-001";
const CONCEPT_MIXED_FIX_IDS = Array.from({ length: 6 }, (_, i) =>
  `mock-proposedfix-concept-mixed-${i + 1}-001`,
);
const MIXED_RUN_ID = "concept-mixed-run-001";

export const CONCEPT_SIBLING_NODE_IDS = {
  CONCEPT_SIBLING_EVALSET_ID,
  CONCEPT_SIBLING_TRIGGER_ID,
  CONCEPT_SIBLING_OUTPUT_ID,
  CONCEPT_SIBLING_FIX_IDS,
  CONCEPT_SIBLING_FIX_NO_SNAPSHOT_ID,
  CONCEPT_PENDING_EVALSET_ID,
  CONCEPT_PENDING_TRIGGER_ID,
  CONCEPT_PENDING_FIX_IDS,
  CONCEPT_MIXED_EVALSET_ID,
  CONCEPT_MIXED_TRIGGER_ID,
  CONCEPT_MIXED_OUTPUT_ID,
  CONCEPT_MIXED_FIX_IDS,
} as const;

/** Concept-sibling nodes for Groups A, B, and C. */
export const CONCEPT_SIBLING_NODES: JarvisNode[] = [
  // ── Group A EvalSet + trigger + shared output ─────────────────────────────
  {
    ref_id: CONCEPT_SIBLING_EVALSET_ID,
    node_type: "EvalSet",
    date_added_to_graph: "1760100000",
    properties: { name: "Concept Sibling EvalSet", task_slug: "mock-concept-sibling-task" },
  },
  {
    ref_id: CONCEPT_SIBLING_TRIGGER_ID,
    node_type: "EvalTrigger",
    date_added_to_graph: "1760100001",
    properties: { agent: "concept-fix-agent", start_point: "start", end_point: "end" },
  },
  {
    ref_id: CONCEPT_SIBLING_OUTPUT_ID,
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1760100002",
    properties: { n_passed: 60, n_total: 74, result: "partial", score: 60 / 74 },
  },
  // 6 sibling ProposedFix nodes (last one has no snapshot fields)
  ...CONCEPT_SIBLING_FIX_IDS.map((ref_id, i): JarvisNode => ({
    ref_id,
    node_type: "ProposedFix",
    date_added_to_graph: String(1760100010 + i),
    properties: {
      eval_status: "accepted",
      target_type: "concept",
      target_name: CONCEPT_SIBLING_TARGET_NAMES[i],
      stakwork_run_id: SHARED_RUN_ID,
      // All but the last carry a snapshot (the last one has none — by design)
      ...(i < 5 ? {
        ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
        target_name: CONCEPT_SIBLING_TARGET_NAMES[i],
      } : {}),
    },
  })),

  // ── Group B: 2 pending siblings (no output, no after_score) ──────────────
  {
    ref_id: CONCEPT_PENDING_EVALSET_ID,
    node_type: "EvalSet",
    date_added_to_graph: "1760200000",
    properties: { name: "Concept Pending EvalSet", task_slug: "mock-concept-pending-task" },
  },
  {
    ref_id: CONCEPT_PENDING_TRIGGER_ID,
    node_type: "EvalTrigger",
    date_added_to_graph: "1760200001",
    properties: { agent: "concept-fix-agent", start_point: "start", end_point: "end" },
  },
  ...CONCEPT_PENDING_FIX_IDS.map((ref_id, i): JarvisNode => ({
    ref_id,
    node_type: "ProposedFix",
    date_added_to_graph: String(1760200010 + i),
    properties: {
      eval_status: "pending",
      target_type: "concept",
      target_name: `Pending Fix ${i + 1}`,
      stakwork_run_id: PENDING_RUN_ID,
      // No after_score, no PRODUCED_BY output — exercises tier-3/4 grouping
    },
  })),

  // ── Group C: 3 materialized + 3 non-materialized siblings (same run id) ──
  {
    ref_id: CONCEPT_MIXED_EVALSET_ID,
    node_type: "EvalSet",
    date_added_to_graph: "1760300000",
    properties: { name: "Concept Mixed EvalSet", task_slug: "mock-concept-mixed-task" },
  },
  {
    ref_id: CONCEPT_MIXED_TRIGGER_ID,
    node_type: "EvalTrigger",
    date_added_to_graph: "1760300001",
    properties: { agent: "concept-fix-agent", start_point: "start", end_point: "end" },
  },
  {
    ref_id: CONCEPT_MIXED_OUTPUT_ID,
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1760300002",
    properties: { n_passed: 55, n_total: 74, result: "partial", score: 55 / 74 },
  },
  ...CONCEPT_MIXED_FIX_IDS.map((ref_id, i): JarvisNode => ({
    ref_id,
    node_type: "ProposedFix",
    date_added_to_graph: String(1760300010 + i),
    properties: {
      eval_status: "accepted",
      target_type: "concept",
      target_name: `Mixed Fix ${i + 1}`,
      stakwork_run_id: MIXED_RUN_ID,
    },
  })),
];

/** Concept-sibling edges for Groups A, B, and C. */
export const CONCEPT_SIBLING_EDGES = [
  // ── Group A ──────────────────────────────────────────────────────────────
  { source: CONCEPT_SIBLING_EVALSET_ID, target: CONCEPT_SIBLING_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
  { source: CONCEPT_SIBLING_TRIGGER_ID, target: CONCEPT_SIBLING_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
  // All 6 fixes hang off the same trigger
  ...CONCEPT_SIBLING_FIX_IDS.map((fixId) => ({
    source: CONCEPT_SIBLING_TRIGGER_ID,
    target: fixId,
    edge_type: "HAS_PROPOSED_FIX",
  })),
  // All 6 fixes PRODUCED_BY the same output
  ...CONCEPT_SIBLING_FIX_IDS.map((fixId) => ({
    source: fixId,
    target: CONCEPT_SIBLING_OUTPUT_ID,
    edge_type: "PRODUCED_BY",
  })),

  // ── Group B ──────────────────────────────────────────────────────────────
  { source: CONCEPT_PENDING_EVALSET_ID, target: CONCEPT_PENDING_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
  ...CONCEPT_PENDING_FIX_IDS.map((fixId) => ({
    source: CONCEPT_PENDING_TRIGGER_ID,
    target: fixId,
    edge_type: "HAS_PROPOSED_FIX",
  })),
  // No PRODUCED_BY edges (pending — output not yet written)

  // ── Group C ──────────────────────────────────────────────────────────────
  { source: CONCEPT_MIXED_EVALSET_ID, target: CONCEPT_MIXED_TRIGGER_ID, edge_type: "HAS_BASELINE_TRIGGER" },
  { source: CONCEPT_MIXED_TRIGGER_ID, target: CONCEPT_MIXED_OUTPUT_ID, edge_type: "HAS_OUTPUT" },
  ...CONCEPT_MIXED_FIX_IDS.map((fixId) => ({
    source: CONCEPT_MIXED_TRIGGER_ID,
    target: fixId,
    edge_type: "HAS_PROPOSED_FIX",
  })),
  // Only the first 3 fixes are PRODUCED_BY the output (mid-rerun state)
  ...CONCEPT_MIXED_FIX_IDS.slice(0, 3).map((fixId) => ({
    source: fixId,
    target: CONCEPT_MIXED_OUTPUT_ID,
    edge_type: "PRODUCED_BY",
  })),
];

/**
 * Compose the concept-sibling fixture groups onto a base node/edge set.
 *
 * IMPORTANT: Activate this ONLY in non-production + `?fixture=concept-siblings`
 * requests.  See the security note above — the mock Jarvis graph route has no
 * auth guard of its own, so anything folded into the default payload would be
 * served unauthenticated on every non-production deployment.
 */
export function withConceptSiblings(base: {
  nodes: JarvisNode[];
  edges: { source: string; target: string; edge_type: string }[];
}): { nodes: JarvisNode[]; edges: { source: string; target: string; edge_type: string }[] } {
  return {
    nodes: [...base.nodes, ...CONCEPT_SIBLING_NODES],
    edges: [...base.edges, ...CONCEPT_SIBLING_EDGES],
  };
}
