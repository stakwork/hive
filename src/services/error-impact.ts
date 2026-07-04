/**
 * Error impact scoring service.
 *
 * Computes a blast-radius impact score for an ErrorIssue from the centrality
 * properties (PageRank, call-graph fan-in) of the File/Function KG nodes it
 * references via REFERENCES edges.
 *
 * Formula (kept simple so it's easy to tune):
 *   score = maxPageRank * 0.6 + normalizedInDegree * 0.4
 *
 *   where:
 *     maxPageRank       = max pagerank across referenced nodes, clamped to [0,1]
 *     normalizedInDegree = max in_degree / IN_DEGREE_NORMALIZATION_FACTOR, clamped to [0,1]
 *
 * The final score is in [0, 1]. Issues with no resolvable code nodes return null
 * (callers must NOT coerce null → 0, so the UI can distinguish "unscored" from
 * a genuinely low-scoring issue).
 *
 * Occurrence count is NOT blended in here — it is a tie-breaker at query time only.
 */

// Normalizing in_degree: a node with this many or more in-bound references
// is treated as maximally central for the fan-in component.
const IN_DEGREE_NORMALIZATION_FACTOR = 100;

export interface ImpactMeta {
  topNodeName: string;
  topNodeType: string;
  topPagerank: number | null;
  topInDegree: number | null;
  nodeCount: number;
}

export interface ImpactScoreResult {
  score: number;
  meta: ImpactMeta;
}

export interface CentralityNodeInput {
  pagerank?: number;
  in_degree?: number;
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
  let maxInDegree = topNode.in_degree ?? 0;

  for (const node of nodes) {
    const pr = node.pagerank ?? 0;
    const ind = node.in_degree ?? 0;
    if (pr > maxPagerank || (pr === maxPagerank && ind > maxInDegree)) {
      topNode = node;
      maxPagerank = pr;
      maxInDegree = ind;
    }
    // Also track global max in_degree for the score formula
    if (ind > maxInDegree) maxInDegree = ind;
  }

  // Clamp pagerank component to [0, 1]
  const pagerankComponent = Math.min(1, Math.max(0, maxPagerank));

  // Normalize in_degree to [0, 1]
  const inDegreeComponent = Math.min(
    1,
    Math.max(0, maxInDegree / IN_DEGREE_NORMALIZATION_FACTOR),
  );

  // Blend: 60% pagerank + 40% fan-in centrality
  const score = pagerankComponent * 0.6 + inDegreeComponent * 0.4;

  return {
    score: Math.round(score * 10000) / 10000, // 4 decimal places
    meta: {
      topNodeName: topNode.name ?? "",
      topNodeType: topNode.node_type ?? "",
      topPagerank: topNode.pagerank ?? null,
      topInDegree: topNode.in_degree ?? null,
      nodeCount: nodes.length,
    },
  };
}
