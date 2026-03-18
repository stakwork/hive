"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import type CameraControlsImpl from "camera-controls";
import {
  buildGraph,
  computeRadialLayout,
  extractInitialSubgraph,
  extractSubgraph,
  VIRTUAL_CENTER,
  GraphView,
  OffscreenIndicators,
  PrevNodeIndicator,
  type RawNode,
  type RawEdge,
  type ViewState,
  type Pulse,
} from "@/graph-viz-kit";

// ---- Hardcoded sample data ----
const SAMPLE_NODES: RawNode[] = [
  { id: "hive", label: "Hive", icon: "\u2318" },
  { id: "auth", label: "Authentication", icon: "\u2B21", status: "done" },
  { id: "dashboard", label: "Dashboard", icon: "\u2B21", status: "executing" },
  { id: "tasks", label: "Task Engine", icon: "\u2B21", status: "executing" },
  { id: "chat", label: "Chat", icon: "\u2B21", status: "done" },
  { id: "graph", label: "Graph Viz", icon: "\u2B21", status: "executing" },
  { id: "auth-login", label: "Login Flow", status: "done" },
  { id: "auth-oauth", label: "OAuth Providers", status: "done" },
  { id: "auth-session", label: "Session Mgmt", status: "done" },
  { id: "dash-metrics", label: "Metrics Cards", status: "done" },
  { id: "dash-activity", label: "Activity Feed", status: "executing" },
  { id: "dash-search", label: "Global Search", status: "idle" },
  { id: "task-create", label: "Task Creation", status: "done" },
  { id: "task-assign", label: "Auto Assignment", status: "executing" },
  { id: "task-workflow", label: "Workflow Engine", status: "executing" },
  { id: "task-ai", label: "AI Task Solver", status: "executing" },
  { id: "chat-rt", label: "Real-time Sync", status: "done" },
  { id: "chat-ai", label: "AI Assistant", status: "executing" },
  { id: "chat-files", label: "File Sharing", status: "idle" },
  { id: "graph-layout", label: "Radial Layout", status: "done" },
  { id: "graph-render", label: "3D Renderer", status: "done" },
  { id: "graph-pulse", label: "Pulse Effects", status: "done" },
  { id: "graph-nav", label: "Navigation", status: "executing" },
  { id: "alice", label: "Alice", icon: "\u263A" },
  { id: "bob", label: "Bob", icon: "\u263A" },
  { id: "carol", label: "Carol", icon: "\u263A" },
];

const SAMPLE_EDGES: RawEdge[] = [
  { source: "hive", target: "auth" },
  { source: "hive", target: "dashboard" },
  { source: "hive", target: "tasks" },
  { source: "hive", target: "chat" },
  { source: "hive", target: "graph" },
  { source: "auth", target: "auth-login" },
  { source: "auth", target: "auth-oauth" },
  { source: "auth", target: "auth-session" },
  { source: "dashboard", target: "dash-metrics" },
  { source: "dashboard", target: "dash-activity" },
  { source: "dashboard", target: "dash-search" },
  { source: "tasks", target: "task-create" },
  { source: "tasks", target: "task-assign" },
  { source: "tasks", target: "task-workflow" },
  { source: "tasks", target: "task-ai" },
  { source: "chat", target: "chat-rt" },
  { source: "chat", target: "chat-ai" },
  { source: "chat", target: "chat-files" },
  { source: "graph", target: "graph-layout" },
  { source: "graph", target: "graph-render" },
  { source: "graph", target: "graph-pulse" },
  { source: "graph", target: "graph-nav" },
  { source: "hive", target: "alice" },
  { source: "hive", target: "bob" },
  { source: "hive", target: "carol" },
  { source: "alice", target: "tasks" },
  { source: "alice", target: "task-ai" },
  { source: "bob", target: "dashboard" },
  { source: "bob", target: "graph" },
  { source: "carol", target: "auth" },
  { source: "carol", target: "chat" },
];

const MINIMAP_SIZE = 180;
const MINIMAP_CAM_HEIGHT = 200;

export function GraphPortal() {
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);
  const cameraRef = useRef<CameraControlsImpl>(null);
  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" });
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [simulating, setSimulating] = useState(false);
  const simRef = useRef<number | null>(null);

  const graph = useMemo(() => {
    const g = buildGraph(SAMPLE_NODES, SAMPLE_EDGES);
    const sub = extractInitialSubgraph(g);
    const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
      sub.centerId, sub.neighborsByDepth, g.edges, { parentId: sub.parentId }
    );
    for (const [id, pos] of positions) {
      if (id !== VIRTUAL_CENTER) g.nodes[id].position = pos;
    }
    g.initialDepthMap = sub.depthMap;
    g.treeEdgeSet = treeEdgeSet;
    g.childrenOf = childrenOf;
    return g;
  }, []);

  const handleNodeClick = useCallback((nodeId: number) => {
    if (!expanded) return;
    if (viewState.mode === "subgraph" && viewState.selectedNodeId === nodeId) return;

    const sub = extractSubgraph(graph, nodeId, 30, { useAdj: "undirected" });
    setViewState(prev => {
      const prevVisible = prev.mode === "subgraph" ? prev.visibleNodeIds : [];
      const prevSet = new Set(prevVisible);
      const newNodes = sub.nodeIds.filter(n => !prevSet.has(n));
      const prevHistory = prev.mode === "subgraph" ? prev.navigationHistory : [];
      const existingIdx = prevHistory.indexOf(nodeId);
      const newHistory = existingIdx !== -1
        ? prevHistory.slice(0, existingIdx + 1)
        : [...prevHistory, nodeId];
      return {
        mode: "subgraph" as const,
        selectedNodeId: nodeId,
        navigationHistory: newHistory,
        depthMap: sub.depthMap,
        neighborsByDepth: sub.neighborsByDepth,
        parentId: sub.parentId,
        visibleNodeIds: [...prevVisible, ...newNodes],
      };
    });

    const cam = cameraRef.current;
    if (cam) {
      const p = graph.nodes[nodeId].position;
      const treeKids = graph.childrenOf?.get(nodeId) ?? [];
      const allPts = [p, ...treeKids.map(nid => graph.nodes[nid].position)];
      const cx = allPts.reduce((s, pt) => s + pt.x, 0) / allPts.length;
      const cz = allPts.reduce((s, pt) => s + pt.z, 0) / allPts.length;
      let maxRadius = 0;
      for (const pt of allPts) {
        const dx = pt.x - cx, dz = pt.z - cz;
        maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dz * dz));
      }
      const fovRad = (50 / 2) * (Math.PI / 180);
      const cameraHeight = Math.max(5, (maxRadius * 1.05) / Math.tan(fovRad));
      cam.setLookAt(cx, p.y + cameraHeight, cz + 0.1, cx, p.y, cz, true);
    }
  }, [graph, viewState, expanded]);

  const handleReset = useCallback(() => {
    setViewState({ mode: "overview" });
    const cam = cameraRef.current;
    if (cam) cam.setLookAt(0, MINIMAP_CAM_HEIGHT, 0.1, 0, 0, 0, true);
  }, []);

  const handleExpand = useCallback(() => {
    setFading(true);
    setTimeout(() => setExpanded(true), 250);
    setTimeout(() => setFading(false), 300);
  }, []);

  const handleCollapse = useCallback(() => {
    setFading(true);
    setTimeout(() => {
      setExpanded(false);
      setViewState({ mode: "overview" });
    }, 250);
    setTimeout(() => setFading(false), 300);
  }, []);

  // Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !expanded) return;
      if (viewState.mode === "subgraph") handleReset();
      else handleCollapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, viewState.mode, handleReset, handleCollapse]);

  // Pulse simulation
  useEffect(() => {
    if (!simulating) {
      if (simRef.current !== null) cancelAnimationFrame(simRef.current);
      simRef.current = null;
      setPulses([]);
      return;
    }
    let activePulses: Pulse[] = [];
    let nextSpawn = 0;
    const tick = (time: number) => {
      if (time > nextSpawn) {
        const edge = graph.edges[Math.floor(Math.random() * graph.edges.length)];
        if (edge) activePulses.push({ src: edge.src, dst: edge.dst, progress: 0 });
        nextSpawn = time + 600 + Math.random() * 600;
      }
      activePulses = activePulses
        .map(p => ({ ...p, progress: p.progress + 0.035 }))
        .filter(p => p.progress <= 1);
      setPulses([...activePulses]);
      simRef.current = requestAnimationFrame(tick);
    };
    simRef.current = requestAnimationFrame(tick);
    return () => { if (simRef.current !== null) cancelAnimationFrame(simRef.current); };
  }, [simulating, graph]);

  const containerStyle: React.CSSProperties = expanded
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 50,
        borderRadius: 0,
        background: "rgba(5, 5, 10, 0.92)",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.25s ease",
      }
    : {
        position: "fixed",
        bottom: 24,
        left: 24,
        width: MINIMAP_SIZE,
        height: MINIMAP_SIZE,
        zIndex: 50,
        borderRadius: "50%",
        overflow: "hidden",
        background: "transparent",
        cursor: "pointer",
        border: "1.5px solid rgba(77, 217, 232, 0.4)",
        boxShadow: "0 0 16px rgba(77, 217, 232, 0.15), inset 0 0 20px rgba(0, 0, 0, 0.5)",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.25s ease",
      };

  return (
    <div style={containerStyle} onClick={expanded ? undefined : handleExpand}>
      <Canvas
        camera={{ position: [0, MINIMAP_CAM_HEIGHT, 0.1], fov: 50, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent", pointerEvents: expanded ? "auto" : "none" }}
      >
        <GraphView
          graph={graph}
          viewState={expanded ? viewState : { mode: "overview" }}
          onNodeClick={expanded ? handleNodeClick : () => {}}
          minimap={!expanded}
          pulses={expanded ? pulses : undefined}
        />
        <CameraControls
          ref={cameraRef}
          minDistance={2}
          maxDistance={200}
          dollyToCursor
          smoothTime={0.8}
          enabled={expanded}
        />
        {expanded && (
          <>
            <OffscreenIndicators graph={graph} viewState={viewState} onNodeClick={handleNodeClick} />
            <PrevNodeIndicator graph={graph} viewState={viewState} onNodeClick={handleNodeClick} />
          </>
        )}
        <EffectComposer>
          <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.4} mipmapBlur radius={0.3} />
        </EffectComposer>
      </Canvas>

      {/* Expanded overlay controls */}
      {expanded && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {/* Close */}
          <button
            onClick={handleCollapse}
            style={{
              position: "absolute", top: 20, right: 20, zIndex: 20,
              width: 36, height: 36, borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.5)", color: "#aaa",
              fontSize: 18, cursor: "pointer", pointerEvents: "auto",
              display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            {"\u2715"}
          </button>

          {/* Reset */}
          {viewState.mode === "subgraph" && (
            <button
              onClick={handleReset}
              style={{
                position: "absolute", bottom: 20, right: 60, zIndex: 20,
                width: 36, height: 36, borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.5)", color: "#aaa",
                fontSize: 18, cursor: "pointer", pointerEvents: "auto",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(4px)",
              }}
            >
              {"\u2302"}
            </button>
          )}

          {/* Simulate */}
          <button
            onClick={() => setSimulating(s => !s)}
            style={{
              position: "absolute", bottom: 20, right: 20, zIndex: 20,
              width: 36, height: 36, borderRadius: 8,
              border: simulating ? "1px solid rgba(77, 217, 232, 0.6)" : "1px solid rgba(255,255,255,0.1)",
              background: simulating ? "rgba(77, 217, 232, 0.15)" : "rgba(0,0,0,0.5)",
              color: simulating ? "#4dd9e8" : "#aaa",
              fontSize: 18, cursor: "pointer", pointerEvents: "auto",
              display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            {"\u26A1"}
          </button>
        </div>
      )}
    </div>
  );
}
