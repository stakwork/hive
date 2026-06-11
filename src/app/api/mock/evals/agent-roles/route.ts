import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MOCK_AGENT_ROLES = [
  { ref_id: "role-1", node_type: "AgentRole", properties: { name: "Code Reviewer", description: "Reviews PRs" } },
  { ref_id: "role-2", node_type: "AgentRole", properties: { name: "Task Agent", description: "Executes dev tasks" } },
  { ref_id: "role-3", node_type: "AgentRole", properties: { name: "QA Agent", description: "Runs quality checks" } },
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const nameFilter = searchParams.get("name");

  let nodes = MOCK_AGENT_ROLES;
  if (nameFilter) {
    const lower = nameFilter.toLowerCase();
    nodes = nodes.filter((r) => r.properties.name.toLowerCase().includes(lower));
  }

  return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
}
