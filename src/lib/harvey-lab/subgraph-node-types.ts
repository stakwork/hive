/**
 * Shared node-type lists for Jarvis subgraph queries.
 *
 * Kept in a dedicated module so both the client-side hook
 * (useEvalRunHistory.ts) and the server-side kg-adapter can import the same
 * list without duplication or drift.
 *
 * Multiple casings are sent intentionally — Neo4j may store the label under
 * any of these casings depending on the write path, and Jarvis's subgraph
 * endpoint filters by exact string match.
 */

export const TRIGGER_LABELS = ["EvalTrigger", "evaltrigger", "Evaltrigger"] as const;
export const OUTPUT_LABELS = [
  "EvalTriggerOutput",
  "evaltriggeroutput",
  "Evaltriggeroutput",
] as const;
export const FIX_LABELS = ["ProposedFix", "proposedfix", "Proposedfix"] as const;

/**
 * Full set of node types to request when fetching an eval subgraph.
 * Includes casing variants so server-side filtering doesn't miss nodes.
 */
export const SUBGRAPH_NODE_TYPES: string[] = [
  ...TRIGGER_LABELS,
  ...OUTPUT_LABELS,
  ...FIX_LABELS,
];
