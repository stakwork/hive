import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ evalSetId: string; reqId: string }> };

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
      outputs: [
        {
          ref_id: "output-mock-1",
          node_type: "EvalTriggerOutput",
          properties: {
            result: "pass",
            score: 0.87,
            attempt_number: 1,
            judge_notes: "Response was accurate and complete.",
          },
        },
      ],
    },
    {
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
        run_count: 5,
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
