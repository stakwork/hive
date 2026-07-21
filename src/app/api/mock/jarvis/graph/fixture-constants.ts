/**
 * Shared constants for the Jarvis mock graph fixture.
 * Kept in a separate module so tests and the route can import without
 * violating Next.js' restriction on non-route exports from route files.
 */

/** ref_id of the mock EvalSet root node used in the recursion subgraph fixture */
export const MOCK_EVAL_SET_REF_ID = "mock-evalset-001";

/** Node types that signal a recursion subgraph request */
export const RECURSION_NODE_TYPES = ["EvalTrigger", "EvalTriggerOutput", "ProposedFix", "EvalSet"] as const;

/**
 * Returns true when the incoming query params look like a recursion subgraph
 * request — i.e. the caller wants the EvalSet/trigger/fix fixture rather than
 * the generic Function/Variable graph.
 */
export function isRecursionSubgraphRequest(params: {
  nodeType?: string | null;
  startNode?: string | null;
}): boolean {
  const { nodeType, startNode } = params;

  if (startNode && startNode.includes(MOCK_EVAL_SET_REF_ID)) return true;

  if (nodeType) {
    const lower = nodeType.toLowerCase();
    for (const t of RECURSION_NODE_TYPES) {
      if (lower.includes(t.toLowerCase())) return true;
    }
  }

  return false;
}
