import { NextResponse } from "next/server";

export const runtime = "nodejs";

// EvalTriggerOutput mock nodes carrying the extended schema:
//   - properties.n_passed / properties.n_total: explicit integer counts
//   - properties.id: node id in the canonical shape for ordering
//   - top-level date_added_to_graph: Unix-epoch string (set outside node_data)
//
// Three ascending-n_passed outputs (baseline + 2 reruns) plus a note about a
// zero-output trigger handled by the parent triggers route.
const MOCK_OUTPUTS = [
  {
    ref_id: "output-1",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720000000",
    properties: {
      id: "ip/task-1-src-run-xyz",
      result: "fail",
      score: 0.22,
      attempt_number: 1,
      n_passed: 5,
      n_total: 20,
      judge_notes: "Baseline — majority of criteria unmet.",
    },
  },
  {
    ref_id: "output-2",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720086400",
    properties: {
      id: "ip/task-1-src-run-xyz--200001",
      result: "fail",
      score: 0.55,
      attempt_number: 2,
      n_passed: 11,
      n_total: 20,
      judge_notes: "Partial improvement after first rerun.",
    },
  },
  {
    ref_id: "output-3",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720172800",
    properties: {
      id: "ip/task-1-src-run-xyz--200002",
      result: "pass",
      score: 0.91,
      attempt_number: 3,
      n_passed: 18,
      n_total: 20,
      judge_notes: "Near-complete pass after second rerun.",
    },
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { nodes: MOCK_OUTPUTS, total: MOCK_OUTPUTS.length },
  });
}
