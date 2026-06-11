import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MOCK_OUTPUTS = [
  {
    ref_id: "output-1",
    node_type: "EvalTriggerOutput",
    properties: {
      result: "pass",
      score: 0.91,
      attempt_number: 1,
      judge_notes: "Agent response was accurate and complete.",
    },
  },
  {
    ref_id: "output-2",
    node_type: "EvalTriggerOutput",
    properties: {
      result: "fail",
      score: 0.22,
      attempt_number: 2,
      judge_notes: "Agent missed the primary requirement.",
    },
  },
  {
    ref_id: "output-3",
    node_type: "EvalTriggerOutput",
    properties: {
      result: "pass",
      score: 0.55,
      attempt_number: 3,
      judge_notes: "Partially correct, missing edge case handling.",
    },
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { nodes: MOCK_OUTPUTS, total: MOCK_OUTPUTS.length },
  });
}
