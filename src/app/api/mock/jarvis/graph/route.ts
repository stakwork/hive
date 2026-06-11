import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";

export const runtime = "nodejs";

// Mock data generators
function generateMockNodes(seedTaskIds: string[] = []): JarvisNode[] {
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

  // AgentSession nodes for Evals feature — task_ids populated at runtime from seed tasks
  // (see GET handler below which calls generateMockNodes with real task IDs)
  const agentSessionDefs = [
    { ref_id: "session-1", name: "Coding Agent Run", taskIndex: 0 },
    { ref_id: "session-2", name: "Build Agent Run", taskIndex: 1 },
    { ref_id: "session-3", name: "Test Agent Run", taskIndex: 2 },
    { ref_id: "session-4", name: "Review Agent Run", taskIndex: 0 },
  ];
  agentSessionDefs.forEach(({ ref_id, name, taskIndex }) => {
    const taskId = seedTaskIds[taskIndex] ?? "placeholder-task-id";
    nodes.push({
      ref_id,
      node_type: "AgentSession",
      date_added_to_graph: now,
      node_data: { task_id: taskId, created_at: new Date().toISOString() },
      properties: { name, date: new Date().toISOString() },
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

  // Connect persons to functions (contributions)
  for (let i = 1; i <= 30; i++) {
    const personId = ((i - 1) % 3) + 1;
    edges.push({
      source: `person-${personId}`,
      target: `function-${i}`,
      edge_type: "authored",
    });
  }

  // Connect episodes to persons
  for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
      edges.push({
        source: `episode-${i}`,
        target: `person-${j}`,
        edge_type: "participant",
      });
    }
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

    // Fetch up to 3 real seed task IDs so AgentSession mock nodes reference them
    const seedTasks = await db.task.findMany({
      where: { workspaceId: workspace.id, deleted: false },
      take: 3,
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const seedTaskIds = seedTasks.map((t) => t.id);

    const response: JarvisResponse = {
      nodes: generateMockNodes(seedTaskIds),
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
