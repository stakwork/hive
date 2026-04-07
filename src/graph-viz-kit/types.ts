export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GraphNode {
  id: number;
  label: string;
  position: Vec3;
  degree: number;
  link?: string;
  icon?: string;
  status?: "executing" | "done" | "idle";
  progress?: number; // 0–1 for executing nodes
  content?: string; // descriptive text for detail view
}

export interface GraphEdge {
  src: number;
  dst: number;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adj: number[][];
  outAdj: number[][];  // children: source→target (directed)
  inAdj: number[][];   // parents: target→source (directed)
  initialDepthMap?: Map<number, number>;  // from initial layout extraction
  treeEdgeSet?: Set<string>;  // undirected keys for spanning-tree edges
  childrenOf?: Map<number, number[]>;  // BFS tree parent → children from layout

}

/** Undirected edge key (order-independent) */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export type ViewState =
  | { mode: "overview" }
  | {
      mode: "subgraph";
      selectedNodeId: number;
      navigationHistory: number[];                      // ordered list of visited node IDs
      depthMap: Map<number, number>;                   // nodeId → depth
      neighborsByDepth: number[][];                     // [hop1, hop2, ..., hopN]
      parentId?: number;                                 // parent node (via inAdj)
      visibleNodeIds: number[];                         // only grows
    };
