import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";

export const runtime = "nodejs";

// ── Recursion fixture ─────────────────────────────────────────────────────────
// Mirrors the real EvalSet → EvalTrigger → EvalTriggerOutput / ProposedFix
// ontology written by workflows 57389 (ingest) and 57419 (propose-pattern-fix).
// Score/status fields match current live property names:
//   - n_passed / n_total : integer   (EvalTriggerOutput)
//   - before_score / after_score : string  (ProposedFix, stored as stringified numbers)
//   - status : "pending" | "accepted" | "rejected"   (ProposedFix)
//
// Fixture includes:
//   - One EvalSet root
//   - Baseline EvalTrigger  + its EvalTriggerOutput  (3/5 pass)
//   - Accepted fix chain: fix-1 (accepted, 4/5) → fix-2 derived from fix-1 (accepted, 5/5)
//   - One pending fix    (must NOT appear in hill-climb series)
//   - One rejected fix   (must NOT appear in hill-climb series)
//   - Alternate-casing node  (evaltrigger) to exercise case-insensitive matching
export const MOCK_RECURSION_EVALSET_REF_ID = "mock-evalset-ref-001";

function generateRecursionFixture(): JarvisResponse {
  const now = Date.now() / 1000;

  const nodes: JarvisNode[] = [
    // ── EvalSet root ────────────────────────────────────────────────────────
    {
      ref_id: MOCK_RECURSION_EVALSET_REF_ID,
      node_type: "EvalSet",
      date_added_to_graph: now - 3600,
      properties: {
        id: "harvey-lab-task-001",
        name: "Mock Harvey LAB Task 001",
        recursion: true,
      },
    },

    // ── Baseline EvalTrigger (canonical casing) ──────────────────────────
    {
      ref_id: "mock-trigger-baseline-001",
      node_type: "EvalTrigger",
      date_added_to_graph: now - 3000,
      properties: {
        agent: "legal-agent",
        run_count: 1,
      },
    },

    // ── Baseline EvalTriggerOutput ────────────────────────────────────────
    {
      ref_id: "mock-output-baseline-001",
      node_type: "EvalTriggerOutput",
      date_added_to_graph: now - 2900,
      properties: {
        result: "pass",
        score: 60,
        n_passed: 3,
        n_total: 5,
        judge_notes: "3/5 criteria passed (baseline run)",
      },
    },

    // ── Accepted ProposedFix #1 ───────────────────────────────────────────
    // Rooted on the baseline trigger via HAS_PROPOSED_FIX edge
    {
      ref_id: "mock-fix-accepted-001",
      node_type: "ProposedFix",
      date_added_to_graph: now - 2400,
      properties: {
        criterion_id: "criterion-001",
        criterion_title: "Criterion One",
        status: "accepted",
        before_score: "60",
        after_score: "80",
        reasoning: "Improved prompt wording",
        delta: "Rewrote clause 2",
      },
    },

    // ── Rerun EvalTriggerOutput produced by fix-1 ─────────────────────────
    {
      ref_id: "mock-output-rerun-001",
      node_type: "EvalTriggerOutput",
      date_added_to_graph: now - 2000,
      properties: {
        result: "pass",
        score: 80,
        n_passed: 4,
        n_total: 5,
        judge_notes: "4/5 criteria passed (after fix-1)",
      },
    },

    // ── Accepted ProposedFix #2 — derived from fix-1 ──────────────────────
    {
      ref_id: "mock-fix-accepted-002",
      node_type: "ProposedFix",
      date_added_to_graph: now - 1500,
      properties: {
        criterion_id: "criterion-002",
        criterion_title: "Criterion Two",
        status: "accepted",
        before_score: "80",
        after_score: "100",
        reasoning: "Further clause refinement",
        delta: "Added missing reference",
      },
    },

    // ── Rerun EvalTriggerOutput produced by fix-2 ─────────────────────────
    {
      ref_id: "mock-output-rerun-002",
      node_type: "EvalTriggerOutput",
      date_added_to_graph: now - 1000,
      properties: {
        result: "pass",
        score: 100,
        n_passed: 5,
        n_total: 5,
        judge_notes: "5/5 criteria passed (after fix-2)",
      },
    },

    // ── Pending ProposedFix — must NOT appear in hill-climb series ─────────
    {
      ref_id: "mock-fix-pending-001",
      node_type: "ProposedFix",
      date_added_to_graph: now - 800,
      properties: {
        criterion_id: "criterion-003",
        criterion_title: "Criterion Three",
        status: "pending",
        before_score: "100",
        after_score: null,
        reasoning: "Awaiting review",
      },
    },

    // ── Rejected ProposedFix — must NOT appear in hill-climb series ────────
    {
      ref_id: "mock-fix-rejected-001",
      node_type: "ProposedFix",
      date_added_to_graph: now - 700,
      properties: {
        criterion_id: "criterion-004",
        criterion_title: "Criterion Four",
        status: "rejected",
        before_score: "60",
        after_score: "62",
        reasoning: "Rejected: marginal improvement",
      },
    },

    // ── Alternate-casing EvalTrigger ("evaltrigger") ──────────────────────
    // Exercises case-insensitive label matching in the builder.
    {
      ref_id: "mock-trigger-alt-casing-001",
      node_type: "evaltrigger",
      date_added_to_graph: now - 3100,
      properties: {
        agent: "legal-agent",
        run_count: 1,
        note: "alternate casing — evaltrigger",
      },
    },
  ];

  const edges = [
    // EvalSet → baseline trigger
    {
      source: MOCK_RECURSION_EVALSET_REF_ID,
      target: "mock-trigger-baseline-001",
      edge_type: "HAS_BASELINE_TRIGGER",
    },
    // Alternate-casing trigger also belongs to this EvalSet
    {
      source: MOCK_RECURSION_EVALSET_REF_ID,
      target: "mock-trigger-alt-casing-001",
      edge_type: "HAS_TRIGGER",
    },
    // Baseline trigger → baseline output
    {
      source: "mock-trigger-baseline-001",
      target: "mock-output-baseline-001",
      edge_type: "HAS_OUTPUT",
    },
    // Baseline trigger → accepted fix-1
    {
      source: "mock-trigger-baseline-001",
      target: "mock-fix-accepted-001",
      edge_type: "HAS_PROPOSED_FIX",
    },
    // Fix-1 → rerun output-1
    {
      source: "mock-fix-accepted-001",
      target: "mock-output-rerun-001",
      edge_type: "PRODUCED_BY",
    },
    // Fix-2 derived from fix-1
    {
      source: "mock-fix-accepted-002",
      target: "mock-fix-accepted-001",
      edge_type: "DERIVED_FROM",
    },
    // Fix-2 → rerun output-2
    {
      source: "mock-fix-accepted-002",
      target: "mock-output-rerun-002",
      edge_type: "PRODUCED_BY",
    },
    // Pending fix rooted on baseline trigger
    {
      source: "mock-trigger-baseline-001",
      target: "mock-fix-pending-001",
      edge_type: "HAS_PROPOSED_FIX",
    },
    // Rejected fix rooted on baseline trigger
    {
      source: "mock-trigger-baseline-001",
      target: "mock-fix-rejected-001",
      edge_type: "HAS_PROPOSED_FIX",
    },
  ];

  return { nodes, edges };
}

/**
 * Detects whether the incoming request is a recursion subgraph lookup.
 * Triggers when node_type includes any of the eval-ontology labels
 * (case-insensitive), or when start_node matches an EvalSet-shaped ref_id
 * (i.e. "mock-evalset-*" or any ref_id provided alongside eval node types).
 */
const RECURSION_NODE_TYPE_PATTERN = /^(evalset|evaltrigger|evaltriggeroutput|proposedfix)$/i;

function isRecursionSubgraphRequest(searchParams: URLSearchParams): boolean {
  const nodeTypes = searchParams.getAll("node_type");
  if (nodeTypes.some((t) => RECURSION_NODE_TYPE_PATTERN.test(t.trim()))) {
    return true;
  }
  // Also detect via start_node matching the mock evalset ref_id
  const startNode = searchParams.get("start_node");
  if (startNode && startNode.startsWith("mock-evalset-")) {
    return true;
  }
  // Detect via endpoint containing "subgraph" with an evalset start_node embedded
  const endpoint = searchParams.get("endpoint") ?? "";
  if (endpoint.includes("subgraph") && endpoint.includes("start_node=mock-evalset-")) {
    return true;
  }
  return false;
}

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

  // AgentSession nodes for Evals feature
  const agentSessions = [
    { ref_id: "session-1", name: "Session: Fix auth bug", date: "2025-05-01" },
    { ref_id: "session-2", name: "Session: Refactor payments", date: "2025-05-03" },
    { ref_id: "session-3", name: "Session: Add notifications", date: "2025-05-07" },
    { ref_id: "session-4", name: "Session: Debug eval runner", date: "2025-05-10" },
  ];
  agentSessions.forEach(({ ref_id, name, date }) => {
    nodes.push({
      ref_id,
      node_type: "AgentSession",
      date_added_to_graph: now,
      properties: { name, date },
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
 * Mock endpoint for Jarvis graph data.
 * Returns mock nodes and edges for development/testing.
 *
 * Branches on forwarded subgraph params:
 *   - Recursion fixture  — when node_type includes eval-ontology labels
 *                          (EvalTrigger / EvalTriggerOutput / ProposedFix / EvalSet,
 *                          case-insensitive) or start_node matches a mock EvalSet ref_id.
 *   - Generic fixture    — all other callers (default/fallback).
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

    // Branch: recursion subgraph request → return recursion fixture
    if (isRecursionSubgraphRequest(searchParams)) {
      return NextResponse.json({
        success: true,
        status: 200,
        data: generateRecursionFixture(),
      });
    }

    // Default: return generic graph fixture
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
