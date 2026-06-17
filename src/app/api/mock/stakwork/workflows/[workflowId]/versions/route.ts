import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

// Build a small but valid workflow_json with positioned nodes + edges so the
// React Flow diagram renders. `label` lets each version differ slightly, which
// gives the History tab's diff something to show.
function buildWorkflowJson(label: string): string {
  const transitions = {
    trigger: {
      id: "step-trigger",
      unique_id: "step-trigger",
      name: "trigger",
      display_name: "Trigger",
      title: "Trigger",
      skill: { type: "automated" },
      position: { x: 0, y: 140 },
      connections: { default: "step-plan" },
      attributes: {},
    },
    plan: {
      id: "step-plan",
      unique_id: "step-plan",
      name: "plan",
      display_name: `Plan & decompose (${label})`,
      title: "Plan & decompose",
      skill: { type: "human" },
      position: { x: 300, y: 140 },
      connections: { success: "step-api", failure: "step-branch" },
      attributes: { set_var: { model: "claude-opus-4-8", version: label } },
    },
    api: {
      id: "step-api",
      unique_id: "step-api",
      name: "api",
      display_name: "Stakwork API",
      title: "Stakwork API",
      skill: { type: "api" },
      position: { x: 600, y: 50 },
      attributes: {},
    },
    branch: {
      id: "step-branch",
      unique_id: "step-branch",
      name: "branch",
      display_name: "Branch: tests",
      title: "Branch: tests",
      skill: { type: "loop" },
      position: { x: 600, y: 240 },
      attributes: {},
    },
  };

  return JSON.stringify({
    transitions,
    connections: [
      { id: "e1", source: "step-trigger", target: "step-plan" },
      { id: "e2", source: "step-plan", target: "step-api" },
      { id: "e3", source: "step-plan", target: "step-branch" },
    ],
  });
}

const NAMES = ["A", "B", "C", "D", "E"];

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workflowId } = await params;
  const id = parseInt(workflowId, 10);
  const idNum = isNaN(id) ? 0 : id;
  const letter = NAMES[(idNum - 1001 + NAMES.length) % NAMES.length] ?? String(idNum);
  const name = `Mock Workflow ${letter}`;

  const base = [
    { workflow_version_id: "30251", published: false, published_at: null, date: "2026-06-16T10:00:00.000Z", label: "v3" },
    { workflow_version_id: "20640", published: true, published_at: "2026-06-14T10:00:00.000Z", date: "2026-06-14T10:00:00.000Z", label: "v2" },
    { workflow_version_id: "10112", published: true, published_at: "2026-06-09T10:00:00.000Z", date: "2026-06-09T10:00:00.000Z", label: "v1" },
  ];

  const versions = base.map((v) => ({
    workflow_version_id: v.workflow_version_id,
    workflow_id: idNum,
    workflow_json: buildWorkflowJson(v.label),
    workflow_name: name,
    date_added_to_graph: v.date,
    published: v.published,
    published_at: v.published_at,
    ref_id: `ref-${v.workflow_version_id}`,
    node_type: "Workflow_version" as const,
  }));

  return NextResponse.json({ success: true, data: { versions } });
}
