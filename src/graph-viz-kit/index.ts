// ============================================
// graph-viz-kit — Self-contained 3D graph visualization
//
// Dependencies (add to your project):
//   npm install three @react-three/fiber @react-three/drei @react-three/postprocessing
//   npm install -D @types/three
//
// Usage:
//   import { buildGraph, computeRadialLayout, extractInitialSubgraph, extractSubgraph, VIRTUAL_CENTER } from "./graph-viz-kit";
//   import { GraphView, type Pulse } from "./graph-viz-kit";
//   import { OffscreenIndicators } from "./graph-viz-kit";
//   import { PrevNodeIndicator } from "./graph-viz-kit";
//   import type { Graph, ViewState, RawNode, RawEdge } from "./graph-viz-kit";
//
// Quick start:
//
//   const nodes: RawNode[] = [
//     { id: "a", label: "Node A", icon: "★" },
//     { id: "b", label: "Node B" },
//     { id: "c", label: "Node C" },
//   ];
//   const edges: RawEdge[] = [
//     { source: "a", target: "b" },
//     { source: "a", target: "c" },
//   ];
//
//   const graph = buildGraph(nodes, edges);
//   const sub = extractInitialSubgraph(graph);
//   const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
//     sub.centerId, sub.neighborsByDepth, graph.edges, { parentId: sub.parentId }
//   );
//   for (const [id, pos] of positions) {
//     if (id !== VIRTUAL_CENTER) graph.nodes[id].position = pos;
//   }
//   graph.initialDepthMap = sub.depthMap;
//   graph.treeEdgeSet = treeEdgeSet;
//   graph.childrenOf = childrenOf;
//
//   // Then render inside a <Canvas>:
//   <GraphView graph={graph} viewState={viewState} onNodeClick={handleClick} />
// ============================================

// Graph data types
export type { Graph, GraphNode, GraphEdge, Vec3, ViewState } from "./types";
export { edgeKey } from "./types";

// Build graph from raw data
export type { RawNode, RawEdge } from "./buildGraph";
export { buildGraph } from "./buildGraph";

// Layout algorithm
export { computeRadialLayout, adaptiveRadius } from "./layout";
export type { RadialLayoutResult } from "./layout";

// Subgraph extraction
export { extractSubgraph, extractInitialSubgraph, findBestRoot, VIRTUAL_CENTER } from "./extract";
export type { Subgraph } from "./extract";

// 3D components (use inside @react-three/fiber <Canvas>)
export { GraphView } from "./GraphView";
export type { Pulse } from "./GraphView";
export { PulseLayer } from "./PulseLayer";
export { NodeDetailPanel } from "./NodeDetailPanel";
export { OffscreenIndicators } from "./OffscreenIndicators";
export { PrevNodeIndicator } from "./PrevNodeIndicator";
