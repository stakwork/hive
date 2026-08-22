/**
 * Mock Cypher query result for legal recursion subgraph queries.
 *
 * Uses the **flat Cypher row-cell format** — all properties are top-level on
 * each node object, not nested under `properties`. This matches the real
 * ArcadeDB stakgraph response shape that `stakgraphToRawGraph` consumes.
 *
 * Contrast with `src/app/api/mock/jarvis/graph/recursion-fixture.ts`, which
 * uses JarvisNode format with a nested `properties` object.
 */

export interface CypherRow {
  columns: string[];
  rows: unknown[][];
}

// ── Node ref_ids ─────────────────────────────────────────────────────────────

export const RECURSION_CYPHER_IDS = {
  EVAL_SET: "cypher-eval-set-001",
  BASELINE_TRIGGER: "cypher-baseline-trigger-001",
  RUN_TRIGGER: "cypher-run-trigger-001",
  OUTPUT_PASS: "cypher-output-pass-001",
  OUTPUT_FAIL: "cypher-output-fail-001",
  OUTPUT_PARTIAL: "cypher-output-partial-001",
  PROPOSED_FIX: "cypher-proposed-fix-001",
  EVAL_REQUIREMENT: "cypher-eval-requirement-001",
} as const;

// ── Node objects (flat Cypher row-cell format) ────────────────────────────────

const EVAL_SET_NODE = {
  ref_id: RECURSION_CYPHER_IDS.EVAL_SET,
  node_type: "EvalSet",
  name: "Contract Review Eval Set",
  task_slug: "contract-review",
};

/** BaselineTrigger: node_type is EvalTrigger but labels array includes "BaselineTrigger" */
const BASELINE_TRIGGER_NODE = {
  ref_id: RECURSION_CYPHER_IDS.BASELINE_TRIGGER,
  node_type: "EvalTrigger",
  labels: ["EvalTrigger", "BaselineTrigger"],
  name: "Baseline Run",
  run_id: "stakwork-run-baseline-001",
};

const RUN_TRIGGER_NODE = {
  ref_id: RECURSION_CYPHER_IDS.RUN_TRIGGER,
  node_type: "EvalTrigger",
  name: "Recursion Run Attempt",
  run_id: "stakwork-run-attempt-001",
};

/** Output with eval_status "accepted" → classified as pass */
const OUTPUT_PASS_NODE = {
  ref_id: RECURSION_CYPHER_IDS.OUTPUT_PASS,
  node_type: "EvalTriggerOutput",
  name: "Output Pass",
  eval_status: "accepted",
  n_passed: 8,
  n_total: 8,
};

/** Output with eval_status "rejected" → classified as fail */
const OUTPUT_FAIL_NODE = {
  ref_id: RECURSION_CYPHER_IDS.OUTPUT_FAIL,
  node_type: "EvalTriggerOutput",
  name: "Output Fail",
  eval_status: "rejected",
  n_passed: 2,
  n_total: 8,
};

/** Output with no eval_status but n_passed/n_total → classified as partial */
const OUTPUT_PARTIAL_NODE = {
  ref_id: RECURSION_CYPHER_IDS.OUTPUT_PARTIAL,
  node_type: "EvalTriggerOutput",
  name: "Output Partial",
  n_passed: 5,
  n_total: 8,
};

const PROPOSED_FIX_NODE = {
  ref_id: RECURSION_CYPHER_IDS.PROPOSED_FIX,
  node_type: "ProposedFix",
  name: "Fix: Improve citation logic",
  status: "pending",
};

const EVAL_REQUIREMENT_NODE = {
  ref_id: RECURSION_CYPHER_IDS.EVAL_REQUIREMENT,
  node_type: "EvalRequirement",
  name: "Must cite relevant statute",
  criterion: "Statutory citation completeness",
};

// ── Edge relationship objects ─────────────────────────────────────────────────

const REL_HAS_BASELINE_TRIGGER = { type: "HAS_BASELINE_TRIGGER" };
const REL_HAS_TRIGGER = { type: "HAS_TRIGGER" };
const REL_HAS_OUTPUT_FROM_BASELINE = { type: "HAS_OUTPUT" };
const REL_HAS_OUTPUT_FROM_TRIGGER = { type: "HAS_OUTPUT" };
const REL_HAS_OUTPUT_FROM_TRIGGER_PARTIAL = { type: "HAS_OUTPUT" };
const REL_HAS_PROPOSED_FIX = { type: "HAS_PROPOSED_FIX" };
const REL_DERIVED_FROM = { type: "DERIVED_FROM" };
const REL_HAS_REQUIREMENT = { type: "HAS_REQUIREMENT" };

// ── Assembled fixture ─────────────────────────────────────────────────────────

/**
 * Returns a Cypher result object matching the `{ columns, rows }` shape that
 * `stakgraphToRawGraph` receives.  Each row is [sourceNode, rel, targetNode].
 */
export function buildRecursionCypherFixture(): CypherRow {
  return {
    columns: ["n", "r", "m"],
    rows: [
      // EvalSet → BaselineTrigger
      [EVAL_SET_NODE, REL_HAS_BASELINE_TRIGGER, BASELINE_TRIGGER_NODE],
      // EvalSet → run trigger
      [EVAL_SET_NODE, REL_HAS_TRIGGER, RUN_TRIGGER_NODE],
      // BaselineTrigger → pass output
      [BASELINE_TRIGGER_NODE, REL_HAS_OUTPUT_FROM_BASELINE, OUTPUT_PASS_NODE],
      // RunTrigger → fail output
      [RUN_TRIGGER_NODE, REL_HAS_OUTPUT_FROM_TRIGGER, OUTPUT_FAIL_NODE],
      // RunTrigger → partial output (no eval_status)
      [RUN_TRIGGER_NODE, REL_HAS_OUTPUT_FROM_TRIGGER_PARTIAL, OUTPUT_PARTIAL_NODE],
      // BaselineTrigger → ProposedFix
      [BASELINE_TRIGGER_NODE, REL_HAS_PROPOSED_FIX, PROPOSED_FIX_NODE],
      // ProposedFix → DERIVED_FROM baseline output
      [PROPOSED_FIX_NODE, REL_DERIVED_FROM, OUTPUT_PASS_NODE],
      // EvalSet → EvalRequirement
      [EVAL_SET_NODE, REL_HAS_REQUIREMENT, EVAL_REQUIREMENT_NODE],
    ],
  };
}

/** Keywords present in legal recursion Cypher queries — used for request branching. */
export const LEGAL_CYPHER_KEYWORDS = [
  "HAS_BASELINE_TRIGGER",
  "HAS_TRIGGER",
  "HAS_OUTPUT",
  "HAS_PROPOSED_FIX",
  "DERIVED_FROM",
  "HAS_REQUIREMENT",
  "EvalSet",
  "EvalTrigger",
  "EvalTriggerOutput",
  "ProposedFix",
  "EvalRequirement",
] as const;

/** Returns true when the Cypher query string looks like a legal recursion query. */
export function isLegalRecursionQuery(query: string): boolean {
  return LEGAL_CYPHER_KEYWORDS.some((kw) => query.includes(kw));
}
