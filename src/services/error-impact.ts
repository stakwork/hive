/**
 * Error impact scoring service.
 *
 * Computes a blast-radius impact score for an ErrorIssue from the centrality
 * properties (PageRank) of the File/Function KG nodes it references via
 * REFERENCES edges.
 *
 * Formula:
 *   score = clamp(maxPageRank, 0, 1)
 *
 *   where maxPageRank = max pagerank across referenced nodes
 *
 * The final score is in [0, 1]. Issues with no resolvable code nodes return null
 * (callers must NOT coerce null → 0, so the UI can distinguish "unscored" from
 * a genuinely low-scoring issue).
 *
 * Occurrence count is NOT blended in here — it is a tie-breaker at query time only.
 */

export interface ImpactMeta {
  topNodeName: string;
  topNodeType: string;
  topPagerank: number | null;
  nodeCount: number;
}

export interface ImpactScoreResult {
  score: number;
  meta: ImpactMeta;
}

export interface CentralityNodeInput {
  pagerank?: number;
  name?: string;
  node_type?: string;
}

/**
 * Compute a blast-radius impact score from referenced KG node centrality data.
 *
 * @param nodes — centrality node inputs (File/Function nodes referenced by the issue)
 * @returns null when the input list is empty (no resolvable code nodes — "unscored")
 *          or a scored result with a meta breakdown of the top contributor.
 */
export function computeImpactScore(
  nodes: CentralityNodeInput[],
): ImpactScoreResult | null {
  if (!nodes || nodes.length === 0) return null;

  // Find the node with the highest pagerank as the "top contributor"
  let topNode = nodes[0];
  let maxPagerank = topNode.pagerank ?? 0;

  for (const node of nodes) {
    const pr = node.pagerank ?? 0;
    if (pr > maxPagerank) {
      topNode = node;
      maxPagerank = pr;
    }
  }

  // Clamp pagerank to [0, 1] — this is the sole signal
  const score = Math.min(1, Math.max(0, maxPagerank));

  return {
    score: Math.round(score * 10000) / 10000, // 4 decimal places
    meta: {
      topNodeName: topNode.name ?? "",
      topNodeType: topNode.node_type ?? "",
      topPagerank: topNode.pagerank ?? null,
      nodeCount: nodes.length,
    },
  };
}
