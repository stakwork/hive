import type { GraphSearchResponse } from "@/types/graph-node";

const MOCK_HITS: GraphSearchResponse["results"] = [
  {
    ref_id: "workspace_access_control_concept",
    node_type: "Concept",
    name: "Workspace Access Control",
    description: "How role checks gate workspace resources across the app.",
  },
  {
    ref_id: "permission_system_concept",
    node_type: "Concept",
    name: "Permission System",
    description: "OWNER > ADMIN > PM > DEVELOPER > STAKEHOLDER > VIEWER role hierarchy.",
  },
  {
    ref_id: "validateWorkspaceAccess_src_services_workspace_ts",
    node_type: "Function",
    name: "validateWorkspaceAccess",
    description: "Resolves a user's membership and role for a workspace slug.",
  },
];

/**
 * Mock fixture for the Jarvis-backed graph search. Honours the `types` filter
 * so the node-type selector behaves the same way under USE_MOCKS=true.
 */
export function getMockGraphSearch(_query: string, types: string): GraphSearchResponse {
  const wanted = types
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (wanted.length === 0) return { results: MOCK_HITS };
  return { results: MOCK_HITS.filter((h) => wanted.includes(h.node_type)) };
}
