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

// ── Node ref_ids (stable, referenced by edges and tests) ─────────────────────
export const EVAL_SET_ID = "mock-evalset-001"; // same as MOCK_EVAL_SET_REF_ID

const BASELINE_TRIGGER_ID = "mock-evaltrigger-baseline-001";
const BASELINE_OUTPUT_ID = "mock-evaltriggeroutput-baseline-001";

const RERUN_TRIGGER_ID = "mock-evaltrigger-rerun-001"; // casing variant node_type

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
      },
    },

    // ── Rejected ProposedFix (original — must NOT appear in accepted series) ──
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

    // Rerun trigger → rejected fix (original — attached to rerun trigger, not baseline)
    { source: RERUN_TRIGGER_ID, target: FIX_REJECTED_ID, edge_type: "HAS_PROPOSED_FIX" },
  ];
}

export const RECURSION_NODE_IDS = {
  EVAL_SET_ID,
  BASELINE_TRIGGER_ID,
  BASELINE_OUTPUT_ID,
  RERUN_TRIGGER_ID,
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
