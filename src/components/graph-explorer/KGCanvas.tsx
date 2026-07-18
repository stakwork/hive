"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GraphView, OffscreenIndicators } from "@/graph-viz-kit";
import type { Graph, ViewState } from "@/graph-viz-kit";

interface KGCanvasProps {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
  searchMatches?: Set<number> | null;
}

export default function KGCanvas({
  graph,
  viewState,
  onNodeClick,
  searchMatches,
}: KGCanvasProps) {
  return (
    <Canvas camera={{ position: [0, 15, 30], fov: 60 }}>
      <OrbitControls />
      <GraphView
        graph={graph}
        viewState={viewState}
        onNodeClick={onNodeClick}
        searchMatches={searchMatches}
      />
      <OffscreenIndicators
        graph={graph}
        viewState={viewState}
        onNodeClick={onNodeClick}
      />
    </Canvas>
  );
}
