import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Concept Detail Endpoint
 *
 * GET — Returns a concept with its documentation and description.
 * Falls back to a generic stub when the id is not in the in-memory list.
 */

const mockConcepts: Record<
  string,
  { id: string; name: string; description: string; documentation: string }
> = {
  "stakwork/hive/auth": {
    id: "stakwork/hive/auth",
    name: "Authentication",
    description: "JWT and OAuth authentication layer for all workspace users.",
    documentation: "Handles JWT and OAuth flows for user authentication.",
  },
  "stakwork/hive/tasks": {
    id: "stakwork/hive/tasks",
    name: "Task Management",
    description: "Core task CRUD with dual user and workflow status tracking.",
    documentation: "Core task CRUD with dual status system (user vs workflow).",
  },
  "stakwork/hive/janitors": {
    id: "stakwork/hive/janitors",
    name: "Janitor Workflows",
    description: "Automated code quality analysis and PR monitoring janitors.",
    documentation: "Automated code quality analysis and PR monitoring janitors.",
  },
  "stakwork/hive/workspace": {
    id: "stakwork/hive/workspace",
    name: "Workspace Access",
    description: "Multi-tenant workspace with role-based access control.",
    documentation: "Multi-tenant workspace with role-based access control (RBAC).",
  },
  "stakwork/hive/swarm": {
    id: "stakwork/hive/swarm",
    name: "Swarm Orchestration",
    description: "Pod and swarm lifecycle management for AI agent workloads.",
    documentation: "Pod and swarm lifecycle management for AI agent workloads.",
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    const { id } = await params;
    const concept = mockConcepts[id] ?? {
      id,
      name: id,
      description: "",
      documentation: "",
    };

    console.log(`[StakgraphMock] GET /gitree/concepts/${id}`);

    return NextResponse.json({ concept, feature: concept });
  } catch (error) {
    console.error("[StakgraphMock] GET /gitree/concepts/[id] error:", error);
    return NextResponse.json({ error: "Failed to retrieve concept" }, { status: 500 });
  }
}
