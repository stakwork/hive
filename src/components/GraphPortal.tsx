"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import type CameraControlsImpl from "camera-controls";
import { buildGraph, type RawNode, type RawEdge } from "@/graph-viz/graph/buildGraph";
import { extractSubgraph } from "@/graph-viz/graph/extract";
import { buildEntityTree } from "@/graph-viz/graph/buildEntityTree";
import { layoutEntityTree } from "@/graph-viz/graph/layoutEntity";
import { GraphView, type Pulse } from "@/graph-viz/components/GraphView";
import { OffscreenIndicators } from "@/graph-viz/components/OffscreenIndicators";
import { PrevNodeIndicator } from "@/graph-viz/components/PrevNodeIndicator";
import type { ViewState } from "@/graph-viz/graph/types";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceMembers, type WorkspaceMember } from "@/hooks/useWorkspaceMembers";

const ROLE_STATUS: Record<string, "executing" | "done" | "idle"> = {
  OWNER: "executing",
  ADMIN: "executing",
  PM: "executing",
  DEVELOPER: "done",
  STAKEHOLDER: "idle",
  VIEWER: "idle",
};

const FEATURE_STATUS: Record<string, "executing" | "done" | "idle"> = {
  IN_PROGRESS: "executing",
  COMPLETED: "done",
  BACKLOG: "idle",
  PLANNED: "idle",
  CANCELLED: "idle",
  ERROR: "idle",
  BLOCKED: "idle",
};

const TASK_STATUS: Record<string, "executing" | "done" | "idle"> = {
  IN_PROGRESS: "executing",
  DONE: "done",
  COMPLETED: "done",
  TODO: "idle",
  PENDING: "idle",
  CANCELLED: "idle",
  BLOCKED: "idle",
  ERROR: "idle",
  HALTED: "idle",
  FAILED: "idle",
};

interface FeatureSummary {
  id: string;
  title: string;
  status: string;
  assignee: { id: string } | null;
  createdBy: { id: string };
}

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  workflowStatus: string | null;
  assignee: { id: string } | null;
  createdBy: { id: string };
  feature: { id: string } | null;
}

interface WhiteboardSummary {
  id: string;
  name: string;
  featureId: string | null;
}

interface GraphNodeSummary {
  ref_id: string;
  node_type: string;
  name: string;
}

interface GraphEdgeSummary {
  source: string;
  target: string;
}

function useWorkspaceFeatures(workspaceId: string | undefined) {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/features?workspaceId=${workspaceId}&limit=100`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setFeatures(json.data || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  return { features, loading };
}

function useRepositoryNodes(slug: string | undefined) {
  const [repoNodes, setRepoNodes] = useState<GraphNodeSummary[]>([]);
  const [repoEdges, setRepoEdges] = useState<GraphEdgeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    let cancelled = false;
    const nodeTypes = JSON.stringify(["Function", "Endpoint", "File", "Page", "Datamodel"]);
    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/graph/nodes?node_type=${encodeURIComponent(nodeTypes)}&limit=100&limit_mode=per_type`
        );
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled && json.data) {
          const nodes = (json.data.nodes || []).map((n: Record<string, unknown>) => ({
            ref_id: n.ref_id as string,
            node_type: n.node_type as string,
            name: (n.properties as Record<string, unknown>)?.name as string || n.name as string || n.ref_id as string,
          }));
          const edges = (json.data.edges || []).map((e: Record<string, unknown>) => ({
            source: e.source as string,
            target: e.target as string,
          }));
          setRepoNodes(nodes);
          setRepoEdges(edges);
        }
      } catch {
        // ignore - swarm might not be available
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return { repoNodes, repoEdges, loading };
}

function useWorkspaceTasks(workspaceId: string | undefined) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tasks?workspaceId=${workspaceId}&limit=100&showAllStatuses=true`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setTasks(json.data || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  return { tasks, loading };
}

function useWorkspaceWhiteboards(workspaceId: string | undefined) {
  const [whiteboards, setWhiteboards] = useState<WhiteboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/whiteboards?workspaceId=${workspaceId}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setWhiteboards(json.data || []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  return { whiteboards, loading };
}

const MAX_LABEL_LENGTH = 30;
function truncLabel(text: string): string {
  return text.length > MAX_LABEL_LENGTH ? text.slice(0, MAX_LABEL_LENGTH - 1) + "\u2026" : text;
}

function buildWorkspaceGraph(
  workspaceName: string,
  slug: string,
  members: WorkspaceMember[],
  features: FeatureSummary[],
  repoNodes: GraphNodeSummary[],
  repoEdges: GraphEdgeSummary[],
  tasks: TaskSummary[],
  whiteboards: WhiteboardSummary[],
): { nodes: RawNode[]; edges: RawEdge[] } {
  const nodes: RawNode[] = [
    { id: "workspace", label: workspaceName },
  ];
  const edges: RawEdge[] = [];

  // Top-level group nodes
  nodes.push({ id: "group-members", label: "Members" });
  nodes.push({ id: "group-features", label: "Features" });
  edges.push({ source: "workspace", target: "group-members" });
  edges.push({ source: "workspace", target: "group-features" });

  if (repoNodes.length > 0) {
    nodes.push({ id: "group-repo", label: "Repository" });
    edges.push({ source: "workspace", target: "group-repo" });
  }

  // Members as children of the members group
  const userIdToMemberId = new Map<string, string>();
  for (const member of members) {
    const label = truncLabel(member.user.name || member.user.email || "Unknown");
    const nodeId = `member-${member.id}`;
    nodes.push({
      id: nodeId,
      label,
      content: member.role,
    });
    edges.push({ source: "group-members", target: nodeId });
    userIdToMemberId.set(member.userId, nodeId);
  }

  // Features — auto-cluster by status when > 15
  const CLUSTER_THRESHOLD = 15;

  if (features.length > CLUSTER_THRESHOLD) {
    const featureBuckets: Record<string, FeatureSummary[]> = {
      Active: [],
      Done: [],
      Backlog: [],
    };
    for (const f of features) {
      const vis = FEATURE_STATUS[f.status] || "idle";
      if (vis === "executing") featureBuckets.Active.push(f);
      else if (vis === "done") featureBuckets.Done.push(f);
      else featureBuckets.Backlog.push(f);
    }

    for (const [bucketLabel, bucket] of Object.entries(featureBuckets)) {
      if (bucket.length === 0) continue;
      // Skip intermediate node for single-item buckets
      const parentId = bucket.length === 1 ? "group-features" : `features-${bucketLabel.toLowerCase()}`;
      if (bucket.length > 1) {
        nodes.push({ id: parentId, label: `${bucketLabel} (${bucket.length})` });
        edges.push({ source: "group-features", target: parentId });
      }
      for (const feature of bucket) {
        const featureNodeId = `feature-${feature.id}`;
        nodes.push({
          id: featureNodeId,
          label: truncLabel(feature.title),
          status: FEATURE_STATUS[feature.status] || "idle",
          content: feature.status,
          link: `/w/${slug}/plan/${feature.id}`,
        });
        edges.push({ source: parentId, target: featureNodeId });
        const ownerId = feature.assignee?.id || feature.createdBy.id;
        const memberNodeId = userIdToMemberId.get(ownerId);
        if (memberNodeId) {
          edges.push({ source: memberNodeId, target: featureNodeId, type: "references" });
        }
      }
    }
  } else {
    for (const feature of features) {
      const featureNodeId = `feature-${feature.id}`;
      nodes.push({
        id: featureNodeId,
        label: truncLabel(feature.title),
        status: FEATURE_STATUS[feature.status] || "idle",
        content: feature.status,
        link: `/w/${slug}/plan/${feature.id}`,
      });
      edges.push({ source: "group-features", target: featureNodeId });
      const ownerId = feature.assignee?.id || feature.createdBy.id;
      const memberNodeId = userIdToMemberId.get(ownerId);
      if (memberNodeId) {
        edges.push({ source: memberNodeId, target: featureNodeId, type: "references" });
      }
    }
  }

  // Repository nodes — group by type, then use swarm edges within each group
  const repoRefIdSet = new Set(repoNodes.map((n) => n.ref_id));
  const hasParent = new Set<string>();

  // Identify nodes that have a parent via swarm edges
  for (const edge of repoEdges) {
    if (repoRefIdSet.has(edge.source) && repoRefIdSet.has(edge.target)) {
      hasParent.add(edge.target);
    }
  }

  // Group orphan nodes (no swarm parent) by node_type
  const typeGroups = new Map<string, GraphNodeSummary[]>();
  for (const node of repoNodes) {
    if (!hasParent.has(node.ref_id)) {
      const list = typeGroups.get(node.node_type) || [];
      list.push(node);
      typeGroups.set(node.node_type, list);
    }
  }

  // Create type group nodes under Repository
  for (const [nodeType, groupNodes] of typeGroups) {
    const typeGroupId = `repo-type-${nodeType}`;
    nodes.push({ id: typeGroupId, label: nodeType });
    edges.push({ source: "group-repo", target: typeGroupId });

    for (const node of groupNodes) {
      nodes.push({
        id: `repo-${node.ref_id}`,
        label: truncLabel(node.name),
        content: node.node_type,
      });
      edges.push({ source: typeGroupId, target: `repo-${node.ref_id}` });
    }
  }

  // Non-orphan nodes (have a swarm parent)
  for (const node of repoNodes) {
    if (hasParent.has(node.ref_id)) {
      nodes.push({
        id: `repo-${node.ref_id}`,
        label: truncLabel(node.name),
        content: node.node_type,
      });
    }
  }

  // Swarm edges as structural (tree) edges
  for (const edge of repoEdges) {
    if (repoRefIdSet.has(edge.source) && repoRefIdSet.has(edge.target)) {
      edges.push({
        source: `repo-${edge.source}`,
        target: `repo-${edge.target}`,
      });
    }
  }

  // Tasks as a top-level group — auto-cluster by status when > threshold
  if (tasks.length > 0) {
    nodes.push({ id: "group-tasks", label: "Tasks" });
    edges.push({ source: "workspace", target: "group-tasks" });

    const addTaskNode = (task: TaskSummary, parentId: string) => {
      const taskNodeId = `task-${task.id}`;
      const taskStatusKey = task.workflowStatus || task.status;
      nodes.push({
        id: taskNodeId,
        label: truncLabel(task.title),
        status: TASK_STATUS[taskStatusKey] || "idle",
        content: taskStatusKey,
        link: `/w/${slug}/task/${task.id}`,
      });
      edges.push({ source: parentId, target: taskNodeId });
      const ownerId = task.assignee?.id || task.createdBy.id;
      const memberNodeId = userIdToMemberId.get(ownerId);
      if (memberNodeId) {
        edges.push({ source: memberNodeId, target: taskNodeId, type: "references" });
      }
      if (task.feature) {
        edges.push({ source: `feature-${task.feature.id}`, target: taskNodeId, type: "references" });
      }
    };

    if (tasks.length > CLUSTER_THRESHOLD) {
      const taskBuckets: Record<string, TaskSummary[]> = {
        "In Progress": [],
        Completed: [],
        Queued: [],
      };
      for (const t of tasks) {
        const vis = TASK_STATUS[t.workflowStatus || t.status] || "idle";
        if (vis === "executing") taskBuckets["In Progress"].push(t);
        else if (vis === "done") taskBuckets.Completed.push(t);
        else taskBuckets.Queued.push(t);
      }

      for (const [bucketLabel, bucket] of Object.entries(taskBuckets)) {
        if (bucket.length === 0) continue;
        const parentId = bucket.length === 1 ? "group-tasks" : `tasks-${bucketLabel.toLowerCase().replace(/\s/g, "-")}`;
        if (bucket.length > 1) {
          nodes.push({ id: parentId, label: `${bucketLabel} (${bucket.length})` });
          edges.push({ source: "group-tasks", target: parentId });
        }
        for (const task of bucket) addTaskNode(task, parentId);
      }
    } else {
      for (const task of tasks) addTaskNode(task, "group-tasks");
    }
  }

  // Whiteboards as a top-level group
  if (whiteboards.length > 0) {
    nodes.push({ id: "group-whiteboards", label: "Whiteboards" });
    edges.push({ source: "workspace", target: "group-whiteboards" });

    for (const wb of whiteboards) {
      const wbNodeId = `wb-${wb.id}`;
      nodes.push({
        id: wbNodeId,
        label: truncLabel(wb.name),
        link: `/w/${slug}/whiteboards/${wb.id}`,
      });
      edges.push({ source: "group-whiteboards", target: wbNodeId });

      // Cross edge to parent feature
      if (wb.featureId) {
        edges.push({ source: `feature-${wb.featureId}`, target: wbNodeId, type: "references" });
      }
    }
  }

  return { nodes, edges };
}

const MINIMAP_SIZE = 180;
const MINIMAP_CAM_HEIGHT = 200;

export function GraphPortal() {
  const router = useRouter();
  const { workspace, slug } = useWorkspace();
  const { members, loading: membersLoading } = useWorkspaceMembers(slug);
  const { features, loading: featuresLoading } = useWorkspaceFeatures(workspace?.id);
  const { repoNodes, repoEdges, loading: repoLoading } = useRepositoryNodes(slug);
  const { tasks, loading: tasksLoading } = useWorkspaceTasks(workspace?.id);
  const { whiteboards, loading: wbLoading } = useWorkspaceWhiteboards(workspace?.id);
  const loading = membersLoading || featuresLoading || repoLoading || tasksLoading || wbLoading;
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);
  const cameraRef = useRef<CameraControlsImpl>(null);
  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" });
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [simulating, setSimulating] = useState(false);
  const simRef = useRef<number | null>(null);

  const graph = useMemo(() => {
    if (members.length === 0) return null;
    const { nodes, edges } = buildWorkspaceGraph(
      workspace?.name || slug || "Workspace",
      slug || "",
      members,
      features,
      repoNodes,
      repoEdges,
      tasks,
      whiteboards,
    );
    const g = buildGraph(nodes, edges);

    const entityTree = buildEntityTree(g);
    layoutEntityTree(entityTree, g, "radial");
    g.entityTree = entityTree;
    return g;
  }, [members, features, repoNodes, repoEdges, tasks, whiteboards, workspace?.name, slug]);

  const handleNodeClick = useCallback((nodeId: number) => {
    if (!expanded || !graph) return;
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
    if (!simulating || !graph) {
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

  if (loading || !graph) return null;

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
        camera={{ position: [0, MINIMAP_CAM_HEIGHT, 0.1], fov: 50, near: 0.1, far: 2000 }}
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
            {viewState.mode === "subgraph" && (() => {
              const node = graph.nodes[viewState.selectedNodeId];
              if (!node?.link) return null;
              const p = node.position;
              return (
                <Html position={[p.x, p.y, p.z]} center style={{ pointerEvents: "none" }}>
                  <button
                    onClick={() => { handleCollapse(); router.push(node.link!); }}
                    title={`Open ${node.label}`}
                    style={{
                      position: "absolute",
                      top: -52,
                      left: 12,
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      border: "1.5px solid rgba(77, 217, 232, 0.5)",
                      background: "rgba(10, 10, 20, 0.85)",
                      backdropFilter: "blur(12px)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                      boxShadow: "0 0 20px rgba(77, 217, 232, 0.2), inset 0 0 12px rgba(77, 217, 232, 0.05)",
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = "scale(1.15)";
                      e.currentTarget.style.boxShadow = "0 0 28px rgba(77, 217, 232, 0.4)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.boxShadow = "0 0 20px rgba(77, 217, 232, 0.2)";
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4dd9e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </Html>
              );
            })()}
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
