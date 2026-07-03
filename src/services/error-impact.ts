/**
 * Error impact scoring service.
 *
 * Computes a "blast-radius" impact score for an ErrorIssue from the centrality
 * (PageRank + fan-in / call-graph in-degree) of the File/Function nodes it
 * references via REFERENCES edges in the workspace knowledge graph.
 *
 * The score is pure code-centrality — occurrence count is NOT blended in here.
 * Occurrence count is only used as a tie-breaker at query time.
 */

export interface CentralityInput {
  pagerank?: number;
  in_degree?: number;
  name?: string;
  node_type?: string;
}

export interface ImpactMeta {
  topNodeName: string | null;
  topNodeType: string | null;
  topPagerank: number;
  topInDegree: number;
  nodeCount: number;
}

export interface ImpactScoreResult {
  score: number;
  meta: ImpactMeta;
}

/**
 * Compute an impact score from a list of centrality-annotated nodes.
 *
 * Formula (tunable — see comment):
 *   For each node: nodeScore = pagerank + (in_degree * IN_DEGREE_WEIGHT)
 *   Final score   = max(nodeScore) across all nodes, normalized to [0, 1]
 *                   using reasonable ceiling values for pagerank and in_degree.
 *
 * Rationale: we pick the *most central* node referenced by the issue
 * (the one that would cause the most blast radius) rather than averaging,
 * because even a single heavily-depended-upon file/function makes an error
 * high-impact. In-degree (call-graph fan-in) is weighted lower than PageRank
 * because PageRank already incorporates global graph topology.
 *
 * Returns null when nodes is empty — callers must treat null as "unscored"
 * and never coerce it to 0 in ways that would hide it from the UI.
 */
export function computeImpactScore(nodes: CentralityInput[]): ImpactScoreResult | null {
  if (!nodes || nodes.length === 0) return null;

  // Tuning constants — easy to adjust as we gather real data.
  const IN_DEGREE_WEIGHT = 0.01; // scale in_degree (raw counts) down to pagerank range
  const PAGERANK_CEIL = 1.0;     // practical upper bound for pagerank in a workspace graph
  const IN_DEGREE_CEIL = 200;    // practical upper bound for in_degree fan-in

  let bestScore = -Infinity;
  let bestNode: CentralityInput | null = null;

  for (const node of nodes) {
    const pr = typeof node.pagerank === "number" ? Math.max(0, node.pagerank) : 0;
    const id = typeof node.in_degree === "number" ? Math.max(0, node.in_degree) : 0;
    const nodeScore = pr + id * IN_DEGREE_WEIGHT;
    if (nodeScore > bestScore) {
      bestScore = nodeScore;
      bestNode = node;
    }
  }

  if (bestNode === null || bestScore < 0) return null;

  // Normalize to [0, 1]: combine ceiling for both components.
  const maxRaw = PAGERANK_CEIL + IN_DEGREE_CEIL * IN_DEGREE_WEIGHT;
  const score = Math.min(1, Math.max(0, bestScore / maxRaw));

  const topPr = typeof bestNode.pagerank === "number" ? bestNode.pagerank : 0;
  const topId = typeof bestNode.in_degree === "number" ? bestNode.in_degree : 0;

  return {
    score,
    meta: {
      topNodeName: bestNode.name ?? null,
      topNodeType: bestNode.node_type ?? null,
      topPagerank: topPr,
      topInDegree: topId,
      nodeCount: nodes.length,
    },
  };
}
