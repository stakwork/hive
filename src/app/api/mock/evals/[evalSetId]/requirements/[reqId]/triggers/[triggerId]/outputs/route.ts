import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock EvalTriggerOutput nodes for the hill-climb chart feature.
 * These represent the per-attempt scored outputs from the hill-climb workflows.
 *
 * Properties include explicit n_passed/n_total (schema added by migration 081),
 * a top-level date_added_to_graph (Unix-epoch string stamped by jarvis at write time),
 * and an id following the naming convention:
 *   - baseline: "task_slug-source_run_id"
 *   - rerun:    "task_slug-source_run_id--<rerun_project_id>"
 */
const MOCK_OUTPUTS = [
  {
    // Baseline output
    ref_id: "output-baseline-1",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720000000",
    properties: {
      id: "antitrust-task-1-run-abc123",
      result: "pass",
      score: 0.67,
      n_passed: 28,
      n_total: 42,
      judge_model: "gpt-4o",
      verdict: "partial",
      judge_notes: "28/42 criteria passed. Good baseline performance.",
    },
  },
  {
    // Rerun 1
    ref_id: "output-rerun-1",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720086400",
    properties: {
      id: "antitrust-task-1-run-abc123--57419001",
      result: "pass",
      score: 0.81,
      n_passed: 34,
      n_total: 42,
      judge_model: "gpt-4o",
      verdict: "partial",
      judge_notes: "34/42 criteria passed. Improving.",
    },
  },
  {
    // Rerun 2
    ref_id: "output-rerun-2",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720172800",
    properties: {
      id: "antitrust-task-1-run-abc123--57419002",
      result: "pass",
      score: 0.90,
      n_passed: 38,
      n_total: 42,
      judge_model: "gpt-4o",
      verdict: "pass",
      judge_notes: "38/42 criteria passed. Strong improvement.",
    },
  },
  {
    // A failed attempt (older hive-written node, no n_passed/n_total on properties)
    ref_id: "output-fail-legacy",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1719913600",
    properties: {
      result: "fail",
      score: 0.40,
      attempt_number: 1,
      judge_notes: "17/42 criteria passed. Below threshold.",
    },
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { nodes: MOCK_OUTPUTS, total: MOCK_OUTPUTS.length },
  });
}
