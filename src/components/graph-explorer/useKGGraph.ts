import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraph,
  computeRadialLayout,
  extractInitialSubgraph,
  extractSubgraph,
  VIRTUAL_CENTER,
} from "@/graph-viz-kit";
import type { Graph, RawEdge, RawNode, ViewState } from "@/graph-viz-kit";

export interface KGGraphHandle {
  graph: Graph;
  viewState: ViewState;
  selectNode: (id: number) => void;
  goOverview: () => void;
  searchMatches: Set<number> | null;
  setSearchMatches: (matches: Set<number> | null) => void;
}

function buildAndLayout(nodes: RawNode[], edges: RawEdge[]): Graph {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], adj: [], outAdj: [], inAdj: [] };
  }
  const graph = buildGraph(nodes, edges);
  const sub = extractInitialSubgraph(graph);
  const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
    sub.centerId,
    sub.neighborsByDepth,
    graph.edges,
    { parentId: sub.parentId }
  );
  for (const [id, pos] of positions) {
    if (id !== VIRTUAL_CENTER && graph.nodes[id]) {
      graph.nodes[id].position = pos;
    }
  }
  graph.initialDepthMap = sub.depthMap;
  graph.treeEdgeSet = treeEdgeSet;
  graph.childrenOf = childrenOf;
  return graph;
}

function makeOverviewState(): ViewState {
  return { mode: "overview" };
}

export function useKGGraph(
  rawNodes: RawNode[],
  rawEdges: RawEdge[]
): KGGraphHandle {
  // Stable ref so graph rebuild only happens when data changes
  const nodesKey = rawNodes.map((n) => n.id).join(",");
  const edgesKey = rawEdges.map((e) => `${e.source}→${e.target}`).join(",");

  const graph = useMemo(
    () => buildAndLayout(rawNodes, rawEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodesKey, edgesKey]
  );

  const [viewState, setViewState] = useState<ViewState>(makeOverviewState);
  const [searchMatches, setSearchMatches] = useState<Set<number> | null>(null);

  // Reset to overview whenever graph data changes
  const prevGraphRef = useRef(graph);
  useEffect(() => {
    if (prevGraphRef.current !== graph) {
      prevGraphRef.current = graph;
      setViewState(makeOverviewState());
    }
  }, [graph]);

  const selectNode = useCallback(
    (id: number) => {
      if (!graph.nodes[id]) return;
      const sub = extractSubgraph(graph, id);
      setViewState({
        mode: "subgraph",
        selectedNodeId: id,
        navigationHistory: [id],
        depthMap: sub.depthMap,
        neighborsByDepth: sub.neighborsByDepth,
        parentId: sub.parentId,
        visibleNodeIds: sub.nodeIds,
      });
    },
    [graph]
  );

  const goOverview = useCallback(() => {
    setViewState(makeOverviewState());
  }, []);

  return { graph, viewState, selectNode, goOverview, searchMatches, setSearchMatches };
}
