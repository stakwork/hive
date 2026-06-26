import type { LingoNode, LingoDefinition } from "./nodes";
export type { LingoDefinition };

export interface NeighborNode {
  ref_id: string;
  name: string;
  node_type: string;
  // Present when node_type === "LingoDefinition"
  valid_from?: string;
  valid_until?: string | null;
  // Present when node_type === "Lingo"
  lingo_type?: string;
}

export interface NeighborEdge {
  edge_ref_id: string;
  edge_type: string;
  neighbor_node: NeighborNode;
}

export interface NodeNeighborData {
  node: LingoNode;
  edges: NeighborEdge[];
}

export const mockLingoNeighbors: Record<string, NodeNeighborData> = {
  "jargon-001": {
    node: {
      ref_id: "jargon-001",
      node_type: "Lingo",
      name: "Pod Orchestration",
      definition: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
      date_added_to_graph: 1750442400,
    },
    edges: [
      {
        edge_ref_id: "edge-001-003",
        edge_type: "BELONGS_TO",
        neighbor_node: { ref_id: "jargon-003", name: "Swarm", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-001-016",
        edge_type: "RELATED_TO",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-001-015",
        edge_type: "USES",
        neighbor_node: { ref_id: "jargon-015", name: "Service Factory", node_type: "Lingo" },
      },
      // Temporal definition edges
      {
        edge_ref_id: "edge-001-def-v2",
        edge_type: "HAS_DEFINITION",
        neighbor_node: {
          ref_id: "jargon-def-001-v2",
          name: "Pod Orchestration (current definition)",
          node_type: "LingoDefinition",
          valid_from: "2026-06-01",
          valid_until: null,
        },
      },
    ],
  },
  "jargon-def-001-v2": {
    node: {
      ref_id: "jargon-def-001-v2",
      node_type: "Lingo",
      name: "Pod Orchestration (current definition)",
      definition: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
      date_added_to_graph: 1748736000,
    },
    edges: [
      {
        edge_ref_id: "edge-def-001-supersedes",
        edge_type: "SUPERSEDES",
        neighbor_node: {
          ref_id: "jargon-def-001-v1",
          name: "Pod Orchestration (superseded definition)",
          node_type: "LingoDefinition",
          valid_from: "2026-01-01",
          valid_until: "2026-06-01",
        },
      },
    ],
  },
  "jargon-002": {
    node: {
      ref_id: "jargon-002",
      node_type: "Lingo",
      name: "Janitor Workflow",
      definition: "An automated code quality sweep that analyses a repository for test coverage gaps, security vulnerabilities, and refactoring opportunities.",
      date_added_to_graph: 1750440600,
    },
    edges: [
      {
        edge_ref_id: "edge-002-004",
        edge_type: "TRIGGERS",
        neighbor_node: { ref_id: "jargon-004", name: "StakworkRun", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-002-016",
        edge_type: "UPDATES",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-002-003",
        edge_type: "RUNS_IN",
        neighbor_node: { ref_id: "jargon-003", name: "Swarm", node_type: "Lingo" },
      },
    ],
  },
  "jargon-003": {
    node: {
      ref_id: "jargon-003",
      node_type: "Lingo",
      name: "Swarm",
      definition: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
      date_added_to_graph: 1750438800,
    },
    edges: [
      {
        edge_ref_id: "edge-003-009",
        edge_type: "CONTAINS",
        neighbor_node: { ref_id: "jargon-009", name: "Jarvis", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-003-001",
        edge_type: "MANAGES",
        neighbor_node: { ref_id: "jargon-001", name: "Pod Orchestration", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-003-021",
        edge_type: "ENABLES",
        neighbor_node: { ref_id: "jargon-021", name: "Auto-Learn", node_type: "Lingo" },
      },
      // Temporal definition edges
      {
        edge_ref_id: "edge-003-def-v2",
        edge_type: "HAS_DEFINITION",
        neighbor_node: {
          ref_id: "jargon-def-003-v2",
          name: "Swarm (current definition)",
          node_type: "LingoDefinition",
          valid_from: "2026-05-15",
          valid_until: null,
        },
      },
    ],
  },
  "jargon-def-003-v2": {
    node: {
      ref_id: "jargon-def-003-v2",
      node_type: "Lingo",
      name: "Swarm (current definition)",
      definition: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
      date_added_to_graph: 1747267200,
    },
    edges: [
      {
        edge_ref_id: "edge-def-003-supersedes",
        edge_type: "SUPERSEDES",
        neighbor_node: {
          ref_id: "jargon-def-003-v1",
          name: "Swarm (superseded definition)",
          node_type: "LingoDefinition",
          valid_from: "2026-01-01",
          valid_until: "2026-05-15",
        },
      },
    ],
  },
  "jargon-004": {
    node: {
      ref_id: "jargon-004",
      node_type: "Lingo",
      name: "StakworkRun",
      definition: "A tracked execution of a Stakwork AI workflow, recording inputs, outputs, and status transitions for audit and debugging.",
      date_added_to_graph: 1750437000,
    },
    edges: [
      {
        edge_ref_id: "edge-004-018",
        edge_type: "PRODUCES",
        neighbor_node: { ref_id: "jargon-018", name: "Streaming Response", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-004-016",
        edge_type: "TRACKS",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-004-002",
        edge_type: "TRIGGERED_BY",
        neighbor_node: { ref_id: "jargon-002", name: "Janitor Workflow", node_type: "Lingo" },
      },
    ],
  },
  "jargon-005": {
    node: {
      ref_id: "jargon-005",
      node_type: "Lingo",
      name: "Feature Brief",
      definition: "A structured description of a product feature including requirements, architecture notes, and linked user stories.",
      date_added_to_graph: 1750435200,
    },
    edges: [
      {
        edge_ref_id: "edge-005-019",
        edge_type: "CONTAINS",
        neighbor_node: { ref_id: "jargon-019", name: "Phase", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-005-022",
        edge_type: "LINKED_TO",
        neighbor_node: { ref_id: "jargon-022", name: "User Journey Task", node_type: "Lingo" },
      },
      {
        edge_ref_id: "edge-005-007",
        edge_type: "USES",
        neighbor_node: { ref_id: "jargon-007", name: "Dual Status System", node_type: "Lingo" },
      },
    ],
  },
};

// For nodes that don't have explicit neighbor data, generate a default empty record
export function getNeighborData(refId: string): NodeNeighborData | null {
  return mockLingoNeighbors[refId] ?? null;
}
