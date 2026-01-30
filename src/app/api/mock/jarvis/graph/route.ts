import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";

export const runtime = "nodejs";

// Mock data generators
function generateMockNodes(): JarvisNode[] {
  //   const nodeTypes = ["Function", "Variable", "Person", "Episode", "Clip"];
  const nodes: JarvisNode[] = [];
  const now = Date.now() / 1000; // Current time in seconds

  // Generate 50 function nodes
  for (let i = 1; i <= 50; i++) {
    nodes.push({
      ref_id: `function-${i}`,
      node_type: "Function",
      date_added_to_graph: now - Math.random() * 86400 * 30, // Random time in last 30 days
      properties: {
        name: `processData${i}`,
        description: `Function that processes data type ${i}`,
        language: "TypeScript",
      },
    });
  }

  // Generate 50 variable nodes
  for (let i = 1; i <= 50; i++) {
    nodes.push({
      ref_id: `variable-${i}`,
      node_type: "Variable",
      date_added_to_graph: now - Math.random() * 86400 * 30,
      properties: {
        name: `config${i}`,
        description: `Configuration variable ${i}`,
        type: "string",
      },
    });
  }

  // Generate 3 contributor nodes
  const contributors = ["Alice Johnson", "Bob Smith", "Charlie Davis"];
  contributors.forEach((name, i) => {
    nodes.push({
      ref_id: `person-${i + 1}`,
      node_type: "Person",
      date_added_to_graph: now - Math.random() * 86400 * 60,
      properties: {
        name,
        role: "Developer",
        contributions: Math.floor(Math.random() * 100) + 50,
      },
    });
  });

  // Generate 5 episode nodes
  const episodes = [
    "Project Kickoff Meeting",
    "Architecture Review",
    "Sprint Planning Session",
    "Code Review Discussion",
    "Deployment Strategy Meeting",
  ];
  episodes.forEach((title, i) => {
    nodes.push({
      ref_id: `episode-${i + 1}`,
      node_type: "Episode",
      date_added_to_graph: now - Math.random() * 86400 * 14,
      properties: {
        episode_title: title,
        description: `Discussion about ${title.toLowerCase()}`,
        duration: Math.floor(Math.random() * 3600) + 1800, // 30-90 minutes
      },
    });
  });

  // Generate 15 endpoint nodes
  const endpoints = [
    { path: "/api/users", method: "GET", description: "List all users" },
    { path: "/api/users", method: "POST", description: "Create a new user" },
    { path: "/api/users/:id", method: "GET", description: "Get user by ID" },
    { path: "/api/users/:id", method: "PUT", description: "Update user" },
    { path: "/api/users/:id", method: "DELETE", description: "Delete user" },
    { path: "/api/auth/login", method: "POST", description: "User login" },
    { path: "/api/auth/logout", method: "POST", description: "User logout" },
    { path: "/api/auth/refresh", method: "POST", description: "Refresh token" },
    { path: "/api/tasks", method: "GET", description: "List all tasks" },
    { path: "/api/tasks", method: "POST", description: "Create a new task" },
    { path: "/api/tasks/:id", method: "GET", description: "Get task by ID" },
    { path: "/api/tasks/:id", method: "PATCH", description: "Update task" },
    { path: "/api/workspaces", method: "GET", description: "List workspaces" },
    { path: "/api/workspaces/:slug", method: "GET", description: "Get workspace" },
    { path: "/api/graph/nodes", method: "GET", description: "Get graph nodes" },
  ];
  endpoints.forEach((endpoint, i) => {
    nodes.push({
      ref_id: `endpoint-${i + 1}`,
      node_type: "Endpoint",
      date_added_to_graph: now - Math.random() * 86400 * 20,
      properties: {
        name: `${endpoint.method} ${endpoint.path}`,
        path: endpoint.path,
        method: endpoint.method,
        description: endpoint.description,
      },
    });
  });

  return nodes;
}

function generateMockEdges() {
  const edges = [];

  // Connect some functions to variables
  for (let i = 1; i <= 20; i++) {
    edges.push({
      source: `function-${i}`,
      target: `variable-${i}`,
      edge_type: "uses",
    });
  }

  // Connect persons to functions (each person authored 3 functions)
  for (let personId = 1; personId <= 3; personId++) {
    for (let j = 0; j < 3; j++) {
      const functionId = (personId - 1) * 3 + j + 1; // person 1 -> functions 1-3, person 2 -> 4-6, etc.
      edges.push({
        source: `person-${personId}`,
        target: `function-${functionId}`,
        edge_type: "authored",
      });
    }
  }

  // Connect episodes to persons (each episode has 1-2 participants)
  for (let i = 1; i <= 5; i++) {
    const numParticipants = 1 + (i % 2); // alternates 1, 2, 1, 2, 1
    for (let j = 0; j < numParticipants; j++) {
      const personId = ((i + j - 1) % 3) + 1;
      edges.push({
        source: `episode-${i}`,
        target: `person-${personId}`,
        edge_type: "participant",
      });
    }
  }

  // Connect endpoints to functions (each endpoint calls 1 function, spread out)
  for (let i = 1; i <= 15; i++) {
    const functionId = i; // endpoint-1 -> function-1, endpoint-2 -> function-2, etc.
    edges.push({
      source: `endpoint-${i}`,
      target: `function-${functionId}`,
      edge_type: "calls",
    });
  }

  return edges;
}

/**
 * Mock endpoint for Jarvis graph data
 * Returns mock nodes and edges for development/testing
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const workspaceSlug = searchParams.get("workspaceSlug");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    // Verify workspace exists
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const response: JarvisResponse = {
      nodes: generateMockNodes(),
      edges: generateMockEdges(),
    };

    return NextResponse.json({
      success: true,
      status: 200,
      data: response,
    });
  } catch (error) {
    console.error("Error generating mock graph data:", error);
    return NextResponse.json({ success: false, message: "Failed to generate mock data" }, { status: 500 });
  }
}
