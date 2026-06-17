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
      id: "trigger_webhook",
      unique_id: "trigger_webhook",
      name: "Webhook",
      display_name: "Webhook",
      skill: { type: "automated" },
      position: { x: 0, y: 140 },
      attributes: {},
    },
    config: {
      id: "set_model_config",
      unique_id: "set_model_config",
      name: "IfValue",
      display_name: "IfValue",
      skill: { type: "automated" },
      position: { x: 280, y: 140 },
      attributes: { vars: { model: "claude-opus-4-8", version: label, temperature: 0.2 } },
    },
    cond: {
      id: "check_prototype_mode",
      unique_id: "check_prototype_mode",
      name: "IfCondition",
      display_name: "IfCondition",
      position: { x: 560, y: 150 },
      attributes: { statement: "goTo(call_stakwork_api)", else_statement: "goTo(system.fail)" },
    },
    request: {
      id: "call_stakwork_api",
      unique_id: "call_stakwork_api",
      name: "Request",
      display_name: "Request",
      skill: { type: "api" },
      position: { x: 760, y: 50 },
      attributes: { url: "https://jobs.stakwork.com/api/v1/projects", method: "POST" },
    },
    build: {
      id: "build_title_json",
      unique_id: "build_title_json",
      name: "JSONBuilder",
      display_name: "JSONBuilder",
      skill: { type: "automated" },
      position: { x: 1040, y: 50 },
      attributes: { vars: { template: "feature_title", max_tokens: 512 } },
    },
    setvar: {
      id: "set_feature_title",
      unique_id: "set_feature_title",
      name: "SetVar",
      display_name: "SetVar",
      skill: { type: "automated" },
      position: { x: 1320, y: 50 },
      attributes: { vars: { feature_title: `Redesigned workflow canvas (${label})` } },
    },
  };

  return JSON.stringify({
    transitions,
    connections: [
      { id: "e_start", source: "start", target: "trigger_webhook" },
      { id: "e1", source: "trigger_webhook", target: "set_model_config" },
      { id: "e2", source: "set_model_config", target: "check_prototype_mode" },
      { id: "e3", source: "check_prototype_mode", target: "call_stakwork_api" },
      { id: "e4", source: "check_prototype_mode", target: "system.fail" },
      { id: "e5", source: "call_stakwork_api", target: "build_title_json" },
      { id: "e6", source: "build_title_json", target: "set_feature_title" },
      { id: "e7", source: "set_feature_title", target: "system.succeed" },
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
