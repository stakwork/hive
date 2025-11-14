import { NextRequest, NextResponse } from "next/server";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";

export const runtime = "nodejs";

// Mock data generators (enhanced version of existing mock data)
function generateMockNodes(): JarvisNode[] {
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
        file_path: `src/utils/process-data-${i}.ts`,
        line_number: Math.floor(Math.random() * 100) + 1,
      },
      x: (Math.random() - 0.5) * 1000,
      y: (Math.random() - 0.5) * 1000,
      z: (Math.random() - 0.5) * 1000,
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
        file_path: `src/config/config-${i}.ts`,
        line_number: Math.floor(Math.random() * 50) + 1,
      },
      x: (Math.random() - 0.5) * 1000,
      y: (Math.random() - 0.5) * 1000,
      z: (Math.random() - 0.5) * 1000,
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
        email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
      },
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 800,
      z: (Math.random() - 0.5) * 800,
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
        participants: Math.floor(Math.random() * 5) + 3,
      },
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
      z: (Math.random() - 0.5) * 600,
    });
  });

  // Generate 10 clip nodes
  for (let i = 1; i <= 10; i++) {
    nodes.push({
      ref_id: `clip-${i}`,
      node_type: "Clip",
      date_added_to_graph: now - Math.random() * 86400 * 7,
      properties: {
        name: `Discussion Clip ${i}`,
        description: `Important discussion segment ${i}`,
        duration: Math.floor(Math.random() * 300) + 30, // 30 seconds to 5 minutes
        transcript: `This is a mock transcript for clip ${i}...`,
      },
      x: (Math.random() - 0.5) * 700,
      y: (Math.random() - 0.5) * 700,
      z: (Math.random() - 0.5) * 700,
    });
  }

  return nodes;
}

function generateMockEdges() {
  const edges = [];

  // Connect some functions to variables
  for (let i = 1; i <= 20; i++) {
    edges.push({
      ref_id: `edge-func-var-${i}`,
      source: `function-${i}`,
      target: `variable-${i}`,
      edge_type: "uses",
      properties: {
        relationship: "dependency",
        strength: Math.random(),
      },
    });
  }

  // Connect persons to functions (contributions)
  for (let i = 1; i <= 30; i++) {
    const personId = ((i - 1) % 3) + 1;
    edges.push({
      ref_id: `edge-person-func-${i}`,
      source: `person-${personId}`,
      target: `function-${i}`,
      edge_type: "authored",
      properties: {
        commit_count: Math.floor(Math.random() * 10) + 1,
        last_modified: Date.now() - Math.random() * 86400 * 30,
      },
    });
  }

  // Connect episodes to persons
  for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
      edges.push({
        ref_id: `edge-episode-person-${i}-${j}`,
        source: `episode-${i}`,
        target: `person-${j}`,
        edge_type: "participant",
        properties: {
          speaking_time: Math.floor(Math.random() * 1800) + 300,
        },
      });
    }
  }

  // Connect clips to episodes
  for (let i = 1; i <= 10; i++) {
    const episodeId = Math.floor((i - 1) / 2) + 1;
    edges.push({
      ref_id: `edge-clip-episode-${i}`,
      source: `clip-${i}`,
      target: `episode-${episodeId}`,
      edge_type: "extracted_from",
      properties: {
        timestamp_start: Math.floor(Math.random() * 3600),
        timestamp_end: Math.floor(Math.random() * 3600) + 300,
      },
    });
  }

  return edges;
}

/**
 * Mock endpoint for Jarvis graph search latest
 * Mimics the real /graph/search/latest endpoint
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = parseInt(searchParams.get("limit") || "1000");
    const topNodeCount = parseInt(searchParams.get("top_node_count") || "500");

    console.log(`[Mock Jarvis Graph] Generating mock graph data (limit: ${limit}, top_node_count: ${topNodeCount})`);

    const allNodes = generateMockNodes();
    const allEdges = generateMockEdges();

    // Apply limits
    const nodes = allNodes.slice(0, Math.min(limit, topNodeCount));
    const edges = allEdges.slice(0, limit);

    const response: JarvisResponse = {
      nodes,
      edges,
      total_nodes: allNodes.length,
      total_edges: allEdges.length,
      query_limit: limit,
      top_node_count: topNodeCount,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error generating mock graph data:", error);
    return NextResponse.json({ error: "Failed to generate mock graph data" }, { status: 500 });
  }
}