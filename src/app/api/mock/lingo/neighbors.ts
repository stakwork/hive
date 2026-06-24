import type { JargonNode, JargonDefinition } from "./nodes";
export type { JargonDefinition };

export interface NeighborNode {
  ref_id: string;
  name: string;
  node_type: string;
  // Present when node_type === "JargonDefinition"
  valid_from?: string;
  valid_until?: string | null;
}

export interface NeighborEdge {
  edge_ref_id: string;
  edge_type: string;
  neighbor_node: NeighborNode;
}

export interface NodeNeighborData {
  node: JargonNode;
  edges: NeighborEdge[];
}

export const mockLingoNeighbors: Record<string, NodeNeighborData> = {
  "jargon-001": {
    node: {
      ref_id: "jargon-001",
      name: "Pod Orchestration",
      jargon_context: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
      jargon_candidates: ["pod management", "container orchestration", "swarm pods"],
      created_at: "2026-06-20T18:00:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-001-003",
        edge_type: "BELONGS_TO",
        neighbor_node: { ref_id: "jargon-003", name: "Swarm", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-001-016",
        edge_type: "RELATED_TO",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-001-015",
        edge_type: "USES",
        neighbor_node: { ref_id: "jargon-015", name: "Service Factory", node_type: "Jargon" },
      },
      // Temporal definition edges
      {
        edge_ref_id: "edge-001-def-v2",
        edge_type: "HAS_DEFINITION",
        neighbor_node: {
          ref_id: "jargon-def-001-v2",
          name: "Pod Orchestration (current definition)",
          node_type: "JargonDefinition",
          valid_from: "2026-06-01",
          valid_until: null,
        },
      },
    ],
  },
  "jargon-def-001-v2": {
    node: {
      ref_id: "jargon-def-001-v2",
      name: "Pod Orchestration (current definition)",
      jargon_context: "The automated process of creating, scaling, and managing compute pods for AI workloads within a workspace swarm.",
      jargon_candidates: [],
      created_at: "2026-06-01T00:00:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-def-001-supersedes",
        edge_type: "SUPERSEDES",
        neighbor_node: {
          ref_id: "jargon-def-001-v1",
          name: "Pod Orchestration (superseded definition)",
          node_type: "JargonDefinition",
          valid_from: "2026-01-01",
          valid_until: "2026-06-01",
        },
      },
    ],
  },
  "jargon-002": {
    node: {
      ref_id: "jargon-002",
      name: "Janitor Workflow",
      jargon_context: "An automated code quality sweep that analyses a repository for test coverage gaps, security vulnerabilities, and refactoring opportunities.",
      jargon_candidates: ["janitor", "code sweep", "automated review"],
      created_at: "2026-06-20T17:30:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-002-004",
        edge_type: "TRIGGERS",
        neighbor_node: { ref_id: "jargon-004", name: "StakworkRun", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-002-016",
        edge_type: "UPDATES",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-002-003",
        edge_type: "RUNS_IN",
        neighbor_node: { ref_id: "jargon-003", name: "Swarm", node_type: "Jargon" },
      },
    ],
  },
  "jargon-003": {
    node: {
      ref_id: "jargon-003",
      name: "Swarm",
      jargon_context: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
      jargon_candidates: ["agent cluster", "AI swarm", "workspace swarm"],
      created_at: "2026-06-20T17:00:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-003-009",
        edge_type: "CONTAINS",
        neighbor_node: { ref_id: "jargon-009", name: "Jarvis", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-003-001",
        edge_type: "MANAGES",
        neighbor_node: { ref_id: "jargon-001", name: "Pod Orchestration", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-003-021",
        edge_type: "ENABLES",
        neighbor_node: { ref_id: "jargon-021", name: "Auto-Learn", node_type: "Jargon" },
      },
      // Temporal definition edges
      {
        edge_ref_id: "edge-003-def-v2",
        edge_type: "HAS_DEFINITION",
        neighbor_node: {
          ref_id: "jargon-def-003-v2",
          name: "Swarm (current definition)",
          node_type: "JargonDefinition",
          valid_from: "2026-05-15",
          valid_until: null,
        },
      },
    ],
  },
  "jargon-def-003-v2": {
    node: {
      ref_id: "jargon-def-003-v2",
      name: "Swarm (current definition)",
      jargon_context: "A managed cluster of AI agents and supporting infrastructure assigned to a workspace, identified by a unique swarm name.",
      jargon_candidates: [],
      created_at: "2026-05-15T00:00:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-def-003-supersedes",
        edge_type: "SUPERSEDES",
        neighbor_node: {
          ref_id: "jargon-def-003-v1",
          name: "Swarm (superseded definition)",
          node_type: "JargonDefinition",
          valid_from: "2026-01-01",
          valid_until: "2026-05-15",
        },
      },
    ],
  },
  "jargon-004": {
    node: {
      ref_id: "jargon-004",
      name: "StakworkRun",
      jargon_context: "A tracked execution of a Stakwork AI workflow, recording inputs, outputs, and status transitions for audit and debugging.",
      jargon_candidates: ["workflow run", "stakwork execution", "AI run"],
      created_at: "2026-06-20T16:30:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-004-018",
        edge_type: "PRODUCES",
        neighbor_node: { ref_id: "jargon-018", name: "Streaming Response", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-004-016",
        edge_type: "TRACKS",
        neighbor_node: { ref_id: "jargon-016", name: "WorkflowStatus", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-004-002",
        edge_type: "TRIGGERED_BY",
        neighbor_node: { ref_id: "jargon-002", name: "Janitor Workflow", node_type: "Jargon" },
      },
    ],
  },
  "jargon-005": {
    node: {
      ref_id: "jargon-005",
      name: "Feature Brief",
      jargon_context: "A structured description of a product feature including requirements, architecture notes, and linked user stories.",
      jargon_candidates: ["feature spec", "brief", "product brief"],
      created_at: "2026-06-20T16:00:00Z",
    },
    edges: [
      {
        edge_ref_id: "edge-005-019",
        edge_type: "CONTAINS",
        neighbor_node: { ref_id: "jargon-019", name: "Phase", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-005-022",
        edge_type: "LINKED_TO",
        neighbor_node: { ref_id: "jargon-022", name: "User Journey Task", node_type: "Jargon" },
      },
      {
        edge_ref_id: "edge-005-007",
        edge_type: "USES",
        neighbor_node: { ref_id: "jargon-007", name: "Dual Status System", node_type: "Jargon" },
      },
    ],
  },
};

// For nodes that don't have explicit neighbor data, generate a default empty record
export function getNeighborData(refId: string): NodeNeighborData | null {
  return mockLingoNeighbors[refId] ?? null;
}
