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

export type LayoutStrategyName = "radial" | "force" | "auto";

export interface LayoutResult {
  positions: Map<number, Vec3>;
  treeEdgeSet: Set<string>;
  childrenOf: Map<number, number[]>;
}

export interface GraphEdge {
  src: number;
  dst: number;
  label?: string;
  type?: string;
}

export const UNSTRUCTURED_EDGE_TYPES = new Set(["references", "mentions", "relates"]);

export function isStructuralEdge(edge: GraphEdge): boolean {
  return edge.type === undefined || !UNSTRUCTURED_EDGE_TYPES.has(edge.type);
}

export interface UnstructuredRegion {
  id: number;                                // unique region index
  proxyNodeId: number;                       // synthetic node representing the collapsed region
  memberIds: number[];                       // unstructured node indices in this region
  anchorNodeId: number | null;               // structural node this attaches to (null = standalone)
  center: Vec3;                              // region center position
  radius: number;                            // bounding radius
  collapsedPositions: Map<number, Vec3>;     // scattered positions for collapsed view
  expandedLayout?: LayoutResult;             // cached expanded layout (lazy, computed on focus)
  expanded: boolean;                         // whether currently expanded
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adj: number[][];
  outAdj: number[][];  // children: source→target (directed)
  inAdj: number[][];   // parents: target→source (directed)
  structuralAdj?: number[][];   // undirected adjacency from structural edges only
  structuralOutAdj?: number[][]; // directed out-adj from structural edges only
  structuralInAdj?: number[][];  // directed in-adj from structural edges only
  unstructuredNodeIds?: Set<number>; // nodes reachable only via unstructured edges
  unstructuredRegions?: UnstructuredRegion[]; // cloud regions for unstructured nodes (legacy, derived from entity tree)
  initialDepthMap?: Map<number, number>;  // from initial layout extraction
  treeEdgeSet?: Set<string>;  // undirected keys for spanning-tree edges
  childrenOf?: Map<number, number[]>;  // BFS tree parent → children from layout

  /** Recursive entity tree — the primary scene model. */
  entityTree?: import("./entity").GraphEntity;
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
