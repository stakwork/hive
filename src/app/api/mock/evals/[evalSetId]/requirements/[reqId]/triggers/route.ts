import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string; reqId: string }> };

/**
 * Mock triggers for the hill-climb chart feature.
 *
 * req-1-1: trigger-hill-1 has 3 completed EvalTriggerOutput nodes with ascending n_passed
 *          (baseline + 2 reruns) demonstrating the climb.
 * req-1-1: trigger-hill-2 has NO outputs — exercises the "no runs yet" state.
 * req-1-2: legacy triggers with outputs in the old format (no n_passed/n_total on properties).
 */
const MOCK_TRIGGERS: Record<string, object[]> = {
  "req-1-1": [
    {
      ref_id: "trigger-hill-1",
      node_type: "EvalTrigger",
      properties: {
        agent: "Legal Benchmark Runner",
        start_point: "task submitted",
        end_point: "task scored",
        environment: "production",
        change_type: "feature",
        desirable_cases: ["All criteria pass", "Judge agrees"],
        undesirable_cases: ["Score below threshold"],
        run_count: 3,
      },
      outputs: [
        {
          // Baseline: id has no "--" suffix
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
          // Rerun 1: id has "--<project_id>" suffix
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
      ],
    },
    {
      // Trigger with no outputs — tests "no runs yet" state
      ref_id: "trigger-hill-2",
      node_type: "EvalTrigger",
      properties: {
        agent: "Legal Benchmark Runner",
        start_point: "task submitted",
        end_point: "task scored",
        environment: "production",
        change_type: "feature",
        desirable_cases: [],
        undesirable_cases: [],
        run_count: 0,
      },
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
