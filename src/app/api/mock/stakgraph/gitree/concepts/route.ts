import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory mock concept list — persists across requests in dev mode
 */
const mockConcepts = [
  {
    id: "stakwork/hive/auth",
    name: "Authentication",
    content: "Handles JWT and OAuth flows for user authentication.",
    description: "JWT and OAuth authentication layer for all workspace users.",
  },
  {
    id: "stakwork/hive/tasks",
    name: "Task Management",
    content: "Core task CRUD with dual status system (user vs workflow).",
    description: "Core task CRUD with dual user and workflow status tracking.",
  },
  {
    id: "stakwork/hive/janitors",
    name: "Janitor Workflows",
    content: "Automated code quality analysis and PR monitoring janitors.",
    description: "Automated code quality analysis and PR monitoring janitors.",
  },
  {
    id: "stakwork/hive/workspace",
    name: "Workspace Access",
    content: "Multi-tenant workspace with role-based access control (RBAC).",
    description: "Multi-tenant workspace with role-based access control.",
  },
  {
    id: "stakwork/hive/swarm",
    name: "Swarm Orchestration",
    content: "Pod and swarm lifecycle management for AI agent workloads.",
    description: "Pod and swarm lifecycle management for AI agent workloads.",
  },
];

/**
 * Mock Stakgraph Gitree Concepts Endpoint
 *
 * GET — Returns a small hardcoded in-memory concept list
 */
export async function GET(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    console.log(`[StakgraphMock] GET /gitree/concepts - returning ${mockConcepts.length} concepts`);

    return NextResponse.json(mockConcepts);
  } catch (error) {
    console.error("[StakgraphMock] GET /gitree/concepts error:", error);
    return NextResponse.json({ error: "Failed to retrieve concepts" }, { status: 500 });
  }
}
