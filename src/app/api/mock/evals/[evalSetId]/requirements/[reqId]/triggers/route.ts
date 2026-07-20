import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string; reqId: string }> };

// Baseline and rerun EvalTriggerOutput nodes for req-1-1.
// id shape: `task_slug-source_run_id` (baseline) / `task_slug-source_run_id--<rerun_project_id>` (rerun)
// date_added_to_graph: Unix-epoch string, top-level (outside properties)
const OUTPUTS_REQ_1_1 = [
  {
    ref_id: "output-mock-1-baseline",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720000000",
    properties: {
      id: "antitrust/task-1-src-run-abc123",
      result: "fail",
      score: 0.33,
      attempt_number: 1,
      n_passed: 14,
      n_total: 42,
      judge_notes: "Baseline run — many criteria unmet.",
    },
  },
  {
    ref_id: "output-mock-1-rerun-1",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720086400",
    properties: {
      id: "antitrust/task-1-src-run-abc123--100001",
      result: "fail",
      score: 0.67,
      attempt_number: 2,
      n_passed: 28,
      n_total: 42,
      judge_notes: "Improved significantly after first rerun.",
    },
  },
  {
    ref_id: "output-mock-1-rerun-2",
    node_type: "EvalTriggerOutput",
    date_added_to_graph: "1720172800",
    properties: {
      id: "antitrust/task-1-src-run-abc123--100002",
      result: "pass",
      score: 0.90,
      attempt_number: 3,
      n_passed: 38,
      n_total: 42,
      judge_notes: "Near-complete pass after second rerun.",
    },
  },
];

const MOCK_TRIGGERS: Record<string, object[]> = {
  "req-1-1": [
    {
      ref_id: "trigger-1-1",
      node_type: "EvalTrigger",
      properties: {
        agent: "Code Reviewer",
        start_point: "PR opened",
        end_point: "Review submitted",
        environment: "staging",
        change_type: "feature",
        desirable_cases: ["Review is constructive", "Identifies issues"],
        undesirable_cases: ["Review is empty", "Misses critical bugs"],
        run_count: 3,
      },
      outputs: OUTPUTS_REQ_1_1,
    },
    {
      // Trigger with zero outputs — exercises "no runs yet" state for a second trigger
      ref_id: "trigger-1-2",
      node_type: "EvalTrigger",
      properties: {
        agent: "QA Agent",
        start_point: "Build complete",
        end_point: "Test report generated",
        environment: "production",
        change_type: "bugfix",
        desirable_cases: ["All tests pass", "Coverage above 80%"],
        undesirable_cases: ["Tests fail", "Coverage drops"],
        run_count: 0,
      },
      outputs: [],
    },
  ],
  "req-1-2": [
    {
      ref_id: "trigger-2-1",
      node_type: "EvalTrigger",
      properties: {
        agent: "Task Agent",
        start_point: "Task assigned",
        end_point: "Task completed",
        environment: "development",
        change_type: "feature",
        desirable_cases: ["Task is done correctly", "No regressions"],
        undesirable_cases: ["Task incomplete", "Breaks existing tests"],
        run_count: 2,
      },
    },
    {
      ref_id: "trigger-2-2",
      node_type: "EvalTrigger",
      properties: {
        agent: "Code Reviewer",
        start_point: "Code submitted",
        end_point: "Review approved",
        environment: "staging",
        change_type: "refactor",
        desirable_cases: ["Code is clean", "Follows conventions"],
        undesirable_cases: ["Code is messy", "Violates style guide"],
        run_count: 1,
      },
    },
  ],
};

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { reqId } = await params;
  const nodes = MOCK_TRIGGERS[reqId] ?? [];
  return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
}

export async function POST(request: NextRequest, _ctx: RouteParams) {
  const body = await request.json().catch(() => ({}));
  const ref_id = crypto.randomUUID();
  return NextResponse.json({
    success: true,
    data: {
      ref_id,
      // Echo back the canonical agentName if provided (dev parity with production route)
      ...(body?.agentName ? { agentName: body.agentName } : {}),
    },
  });
}
