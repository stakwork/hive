"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import type CameraControlsImpl from "camera-controls";
import { buildGraph, appendToGraph, type RawNode, type RawEdge } from "@/graph-viz/graph/buildGraph";
import { extractSubgraph } from "@/graph-viz/graph/extract";
import { buildEntityTree } from "@/graph-viz/graph/buildEntityTree";
import { layoutEntityTree } from "@/graph-viz/graph/layoutEntity";
import { GraphView, type Pulse } from "@/graph-viz/components/GraphView";
import { OffscreenIndicators } from "@/graph-viz/components/OffscreenIndicators";
import { PrevNodeIndicator } from "@/graph-viz/components/PrevNodeIndicator";
import type { ViewState } from "@/graph-viz/graph/types";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { WorkspaceMember } from "@/hooks/useWorkspaceMembers";

interface NodeMeta {
  workspace: string;
  entityType: string;
  status?: string;
  connectedMembers: string[];
}

const FEATURE_STATUS: Record<string, "executing" | "done" | "idle"> = {
  IN_PROGRESS: "executing",
  COMPLETED: "done",
  BACKLOG: "idle",
  PLANNED: "idle",
  CANCELLED: "idle",
  ERROR: "idle",
  BLOCKED: "idle",
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
  prArtifact?: { content?: { url?: string; status?: string; repo?: string } } | null;
}

interface WhiteboardSummary {
  id: string;
  name: string;
  featureId: string | null;
}


interface WorkspaceData {
  slug: string;
  workspaceId: string;
  name: string;
  members: WorkspaceMember[];
  features: FeatureSummary[];
  tasks: TaskSummary[];
  whiteboards: WhiteboardSummary[];
}

function useAllWorkspacesData(workspaces: WorkspaceSummary[] | undefined) {
  const [data, setData] = useState<WorkspaceData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaces || workspaces.length === 0) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const results = await Promise.all(
          workspaces.map(async (ws) => {
            const [membersRes, featuresRes, tasksRes, wbRes] = await Promise.all([
              fetch(`/api/workspaces/${ws.slug}/members`).then(r => r.ok ? r.json() : null).catch(() => null),
              fetch(`/api/features?workspaceId=${ws.id}&limit=100`).then(r => r.ok ? r.json() : null).catch(() => null),
              fetch(`/api/tasks?workspaceId=${ws.id}&limit=100&showAllStatuses=true&includeLatestMessage=true`).then(r => r.ok ? r.json() : null).catch(() => null),
              fetch(`/api/whiteboards?workspaceId=${ws.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
            ]);

            const members: WorkspaceMember[] = [
              ...(membersRes?.owner ? [membersRes.owner] : []),
              ...(membersRes?.members || []),
            ];

            return {
              slug: ws.slug,
              workspaceId: ws.id,
              name: ws.name,
              members,
              features: featuresRes?.data || [],
              tasks: tasksRes?.data || [],
              whiteboards: wbRes?.data || [],
            };
          })
        );
        if (!cancelled) setData(results);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaces]);

  return { data, loading };
}

type NodeLoader = () => Promise<{ nodes: RawNode[]; edges: RawEdge[] }>;

function createRepoCodeLoader(slug: string, prefix: string): NodeLoader {
  return async () => {
    const nodeTypes = JSON.stringify(["Function", "Endpoint", "File", "Page", "Datamodel"]);
    const res = await fetch(
      `/api/workspaces/${slug}/graph/nodes?node_type=${encodeURIComponent(nodeTypes)}&limit=100&limit_mode=per_type`
    );
    if (!res.ok) return { nodes: [], edges: [] };
    const json = await res.json();
    const rawNodes = (json.data?.nodes || []) as Record<string, unknown>[];
    const rawEdges = (json.data?.edges || []) as Record<string, unknown>[];

    const refIdSet = new Set(rawNodes.map(n => n.ref_id as string));
    const hasParent = new Set<string>();
    for (const e of rawEdges) {
      if (refIdSet.has(e.source as string) && refIdSet.has(e.target as string)) {
        hasParent.add(e.target as string);
      }
    }

    const typeGroups = new Map<string, typeof rawNodes>();
    for (const n of rawNodes) {
      if (!hasParent.has(n.ref_id as string)) {
        const t = n.node_type as string;
        if (!typeGroups.has(t)) typeGroups.set(t, []);
        typeGroups.get(t)!.push(n);
      }
    }

    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];

    for (const [nodeType, groupNodes] of typeGroups) {
      const typeGroupId = `${prefix}repo-type-${nodeType}`;
      nodes.push({ id: typeGroupId, label: nodeType });
      edges.push({ source: `${prefix}repo-code`, target: typeGroupId });
      for (const n of groupNodes) {
        const name = (n.properties as Record<string, unknown>)?.name as string || n.name as string || n.ref_id as string;
        nodes.push({ id: `${prefix}repo-${n.ref_id}`, label: truncLabel(name), content: n.node_type as string });
        edges.push({ source: typeGroupId, target: `${prefix}repo-${n.ref_id}` });
      }
    }

    for (const n of rawNodes) {
      if (hasParent.has(n.ref_id as string)) {
        const name = (n.properties as Record<string, unknown>)?.name as string || n.name as string || n.ref_id as string;
        nodes.push({ id: `${prefix}repo-${n.ref_id}`, label: truncLabel(name), content: n.node_type as string });
      }
    }

    for (const e of rawEdges) {
      if (refIdSet.has(e.source as string) && refIdSet.has(e.target as string)) {
        edges.push({ source: `${prefix}repo-${e.source}`, target: `${prefix}repo-${e.target}` });
      }
    }

    return { nodes, edges };
  };
}

function createRepoPRLoader(tasks: TaskSummary[], slug: string, prefix: string): NodeLoader {
  return async () => {
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];

    const PR_STATUS: Record<string, "executing" | "done" | "idle"> = {
      IN_PROGRESS: "executing",
      DONE: "done",
      CANCELLED: "idle",
    };

    for (const task of tasks) {
      const pr = task.prArtifact?.content;
      if (!pr?.url) continue;
      const match = pr.url.match(/\/pull\/(\d+)/);
      const prLabel = match ? `#${match[1]}` : truncLabel(task.title);
      const prNodeId = `${prefix}pr-${task.id}`;
      nodes.push({
        id: prNodeId,
        label: prLabel,
        status: PR_STATUS[pr.status || ""] || "idle",
        content: pr.status || "unknown",
        link: `/w/${slug}/task/${task.id}`,
      });
      edges.push({ source: `${prefix}repo-prs`, target: prNodeId });
    }

    return { nodes, edges };
  };
}

function createInfraLoader(slug: string, prefix: string): NodeLoader {
  return async () => {
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];

    const POD_STATE: Record<string, "executing" | "done" | "idle"> = {
      running: "executing",
      pending: "idle",
      failed: "idle",
      unknown: "idle",
    };

    try {
      const res = await fetch(`/api/w/${slug}/pool/basic-workspaces`);
      if (!res.ok) return { nodes, edges };
      const json = await res.json();
      const vms = json.data?.workspaces || [];

      for (const vm of vms) {
        const id = vm.id || vm.subdomain;
        if (!id) continue;
        const nodeId = `${prefix}pod-${id}`;
        const state = vm.state || "unknown";
        const usage = vm.usage_status === "used" ? "used" : "idle";
        const user = vm.user_info ? ` (${vm.user_info})` : "";
        nodes.push({
          id: nodeId,
          label: truncLabel(id),
          status: POD_STATE[state] || "idle",
          content: `${state} · ${usage}${user}`,
        });
        edges.push({ source: `${prefix}infra-pods`, target: nodeId });
      }
    } catch {
      // ignore — pool might not be active
    }

    return { nodes, edges };
  };
}


const MAX_LABEL_LENGTH = 30;
function truncLabel(text: string): string {
  return text.length > MAX_LABEL_LENGTH ? text.slice(0, MAX_LABEL_LENGTH - 1) + "\u2026" : text;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  userRole?: string;
  memberCount?: number;
}

function buildWorkspaceGraph(
  allData: WorkspaceData[],
): { nodes: RawNode[]; edges: RawEdge[]; nodeMeta: Map<string, NodeMeta> } {
  const nodes: RawNode[] = [];
  const edges: RawEdge[] = [];
  const nodeMeta = new Map<string, NodeMeta>();
  const hasMultiple = allData.length > 1;

  const meta = (id: string, workspace: string, entityType: string, status?: string) => {
    nodeMeta.set(id, { workspace, entityType, status, connectedMembers: [] });
  };

  for (const ws of allData) {
    const wsId = hasMultiple ? `ws-${ws.slug}` : "workspace";
    const prefix = hasMultiple ? `${ws.slug}-` : "";

    nodes.push({ id: wsId, label: ws.name, link: `/w/${ws.slug}/dashboard` });
    meta(wsId, ws.slug, "workspace");

    // Group nodes
    nodes.push({ id: `${prefix}group-members`, label: "Members" });
    nodes.push({ id: `${prefix}group-features`, label: "Features" });
    meta(`${prefix}group-members`, ws.slug, "group");
    meta(`${prefix}group-features`, ws.slug, "group");
    edges.push({ source: wsId, target: `${prefix}group-members` });
    edges.push({ source: wsId, target: `${prefix}group-features` });

    // Repository — loadable
    nodes.push({ id: `${prefix}group-repo`, label: "Repository" });
    edges.push({ source: wsId, target: `${prefix}group-repo` });
    nodes.push({ id: `${prefix}repo-code`, label: "Code", loaderId: `${prefix}repo-code` });
    edges.push({ source: `${prefix}group-repo`, target: `${prefix}repo-code` });
    nodes.push({ id: `${prefix}repo-prs`, label: "Pull Requests", loaderId: `${prefix}repo-prs` });
    edges.push({ source: `${prefix}group-repo`, target: `${prefix}repo-prs` });

    // Infrastructure — loadable
    nodes.push({ id: `${prefix}group-infra`, label: "Infrastructure" });
    edges.push({ source: wsId, target: `${prefix}group-infra` });
    nodes.push({ id: `${prefix}infra-pods`, label: "Pods", loaderId: `${prefix}infra-pods` });
    edges.push({ source: `${prefix}group-infra`, target: `${prefix}infra-pods` });

    // Members
    const userIdToMemberId = new Map<string, string>();
    for (const member of ws.members) {
      const label = truncLabel(member.user.name || member.user.email || "Unknown");
      const nodeId = `${prefix}member-${member.id}`;
      nodes.push({ id: nodeId, label, content: member.role });
      meta(nodeId, ws.slug, "member");
      edges.push({ source: `${prefix}group-members`, target: nodeId });
      userIdToMemberId.set(member.userId, nodeId);
    }

    // Features — auto-cluster by status when > 15
    const CLUSTER_THRESHOLD = 15;
    const addFeatureNode = (feature: FeatureSummary, parentId: string) => {
      const featureNodeId = `${prefix}feature-${feature.id}`;
      const featureVis = FEATURE_STATUS[feature.status] || "idle";
      nodes.push({
        id: featureNodeId,
        label: truncLabel(feature.title),
        status: featureVis,
        content: feature.status,
        link: `/w/${ws.slug}/plan/${feature.id}`,
      });
      meta(featureNodeId, ws.slug, "feature", featureVis);
      edges.push({ source: parentId, target: featureNodeId });
      const ownerId = feature.assignee?.id || feature.createdBy.id;
      const memberNodeId = userIdToMemberId.get(ownerId);
      if (memberNodeId) {
        edges.push({ source: memberNodeId, target: featureNodeId, type: "references" });
        // Track connected member name for filtering
        const memberMeta = nodeMeta.get(memberNodeId);
        const featureMeta = nodeMeta.get(featureNodeId);
        if (featureMeta) {
          const memberLabel = nodes.find(n => n.id === memberNodeId)?.label || "";
          featureMeta.connectedMembers.push(memberLabel);
        }
        if (memberMeta) {
          memberMeta.connectedMembers.push(truncLabel(feature.title));
        }
      }
    };

    if (ws.features.length > CLUSTER_THRESHOLD) {
      const featureBuckets: Record<string, FeatureSummary[]> = { Active: [], Done: [], Backlog: [] };
      for (const f of ws.features) {
        const vis = FEATURE_STATUS[f.status] || "idle";
        if (vis === "executing") featureBuckets.Active.push(f);
        else if (vis === "done") featureBuckets.Done.push(f);
        else featureBuckets.Backlog.push(f);
      }
      for (const [bucketLabel, bucket] of Object.entries(featureBuckets)) {
        if (bucket.length === 0) continue;
        const parentId = bucket.length === 1 ? `${prefix}group-features` : `${prefix}features-${bucketLabel.toLowerCase()}`;
        if (bucket.length > 1) {
          nodes.push({ id: parentId, label: `${bucketLabel} (${bucket.length})` });
          edges.push({ source: `${prefix}group-features`, target: parentId });
        }
        for (const feature of bucket) addFeatureNode(feature, parentId);
      }
    } else {
      for (const feature of ws.features) addFeatureNode(feature, `${prefix}group-features`);
    }

    // Whiteboards
    if (ws.whiteboards.length > 0) {
      nodes.push({ id: `${prefix}group-whiteboards`, label: "Whiteboards" });
      edges.push({ source: wsId, target: `${prefix}group-whiteboards` });
      for (const wb of ws.whiteboards) {
        const wbNodeId = `${prefix}wb-${wb.id}`;
        nodes.push({
          id: wbNodeId,
          label: truncLabel(wb.name),
          link: `/w/${ws.slug}/whiteboards/${wb.id}`,
        });
        edges.push({ source: `${prefix}group-whiteboards`, target: wbNodeId });
        if (wb.featureId) {
          edges.push({ source: `${prefix}feature-${wb.featureId}`, target: wbNodeId, type: "references" });
        }
      }
    }
  }

  return { nodes, edges, nodeMeta };
}

// ---- Contextual query actions ----
// Returns actions available for a given selected node based on its metadata
function getNodeActions(nodeIdx: number, graph: ReturnType<typeof buildGraph>, meta: Map<string, NodeMeta>, allNodeIds: string[]): { label: string; matches: Set<number> }[] {
  const rawId = allNodeIds[nodeIdx];
  if (!rawId) return [];
  const m = meta.get(rawId);
  if (!m) return [];

  const actions: { label: string; matches: Set<number> }[] = [];

  if (m.entityType === "member") {
    // "Their Features" — find all features connected to this member across all workspaces
    const memberLabel = graph.nodes[nodeIdx].label;
    const featureIdxs = new Set<number>();
    for (let i = 0; i < allNodeIds.length; i++) {
      const fm = meta.get(allNodeIds[i]);
      if (fm?.entityType === "feature" && fm.connectedMembers.some(n => n === memberLabel)) {
        featureIdxs.add(i);
      }
    }
    if (featureIdxs.size > 0) actions.push({ label: "Features", matches: featureIdxs });

    // "Across workspaces" — find this member name in other workspaces
    const crossWs = new Set<number>();
    for (let i = 0; i < allNodeIds.length; i++) {
      const om = meta.get(allNodeIds[i]);
      if (om?.entityType === "member" && i !== nodeIdx && graph.nodes[i].label === memberLabel) {
        crossWs.add(i);
      }
    }
    if (crossWs.size > 0) actions.push({ label: "In other workspaces", matches: crossWs });
  }

  if (m.entityType === "feature") {
    // "Assignee" — find the connected member
    const assigneeIdxs = new Set<number>();
    for (let i = 0; i < allNodeIds.length; i++) {
      const om = meta.get(allNodeIds[i]);
      if (om?.entityType === "member" && m.connectedMembers.includes(graph.nodes[i].label)) {
        assigneeIdxs.add(i);
      }
    }
    if (assigneeIdxs.size > 0) actions.push({ label: "Assignee", matches: assigneeIdxs });
  }

  if (m.entityType === "workspace") {
    // "Active features" — all executing features in this workspace
    const activeIdxs = new Set<number>();
    for (let i = 0; i < allNodeIds.length; i++) {
      const om = meta.get(allNodeIds[i]);
      if (om?.entityType === "feature" && om.workspace === m.workspace && om.status === "executing") {
        activeIdxs.add(i);
      }
    }
    if (activeIdxs.size > 0) actions.push({ label: "Active features", matches: activeIdxs });

    // "All members"
    const memberIdxs = new Set<number>();
    for (let i = 0; i < allNodeIds.length; i++) {
      const om = meta.get(allNodeIds[i]);
      if (om?.entityType === "member" && om.workspace === m.workspace) {
        memberIdxs.add(i);
      }
    }
    if (memberIdxs.size > 0) actions.push({ label: "All members", matches: memberIdxs });
  }

  // Universal: "Connected across workspaces" — all nodes reachable via cross-edges
  const connected = new Set<number>();
  const adj = graph.adj[nodeIdx] || [];
  for (const nb of adj) {
    const nbMeta = meta.get(allNodeIds[nb]);
    if (nbMeta && nbMeta.workspace !== m.workspace) {
      connected.add(nb);
    }
  }
  if (connected.size > 0) actions.push({ label: "Across workspaces", matches: connected });

  return actions;
}

const actionBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 20,
  border: "1px solid rgba(77, 217, 232, 0.4)",
  background: "rgba(10, 10, 20, 0.85)",
  backdropFilter: "blur(12px)",
  color: "rgba(77, 217, 232, 0.9)",
  fontSize: 11,
  fontFamily: "'Barlow', sans-serif",
  fontWeight: 600,
  cursor: "pointer",
  pointerEvents: "auto" as const,
  whiteSpace: "nowrap" as const,
  boxShadow: "0 0 12px rgba(77, 217, 232, 0.15)",
  transition: "transform 0.15s, background 0.15s",
};

// ---- Gamepad controller ----
const DEAD_ZONE = 0.2;

function stickVal(val: number): number {
  return Math.abs(val) < DEAD_ZONE ? 0 : val;
}

interface GamepadControllerProps {
  graph: ReturnType<typeof buildGraph>;
  viewState: ViewState;
  cameraRef: React.RefObject<CameraControlsImpl | null>;
  onNodeClick: (id: number) => void;
  onReset: () => void;
  onCollapse: () => void;
  expanded: boolean;
  actions: { label: string; matches: Set<number> }[];
  onAction: (matches: Set<number>) => void;
  onNavigate: (link: string) => void;
  onCursorChange: (id: number | null) => void;
  cursorId: number | null;
}

function GamepadController({
  graph, viewState, cameraRef, onNodeClick, onReset, onCollapse,
  expanded, actions, onAction, onNavigate, onCursorChange, cursorId,
}: GamepadControllerProps) {
  const prevButtons = useRef<boolean[]>([]);
  const actionIdx = useRef(0);
  // Flick model: track whether stick was in center zone last frame
  const stickWasCentered = useRef(true);

  useEffect(() => {
    if (!expanded) return;
    let raf: number;

    const tick = () => {
      const gp = navigator.getGamepads?.()[0];
      if (!gp) { raf = requestAnimationFrame(tick); return; }

      const cam = cameraRef.current;
      const buttons = gp.buttons.map(b => b.pressed);
      const prev = prevButtons.current;
      const justPressed = (i: number) => buttons[i] && !prev[i];

      // Right stick → orbit camera
      const rx = stickVal(gp.axes[2] ?? 0);
      const ry = stickVal(gp.axes[3] ?? 0);
      if (cam && (rx !== 0 || ry !== 0)) {
        cam.rotate(rx * 0.04, ry * 0.04, true);
      }

      // R2 / L2 → zoom
      const zoomIn = gp.buttons[7]?.value ?? 0;
      const zoomOut = gp.buttons[6]?.value ?? 0;
      if (cam && (zoomIn > 0.1 || zoomOut > 0.1)) {
        cam.dolly((zoomOut - zoomIn) * 2, true);
      }

      // Left stick → move cursor between sibling nodes (flick model)
      const lx = stickVal(gp.axes[0]);
      const ly = stickVal(gp.axes[1]);
      const stickMagnitude = Math.sqrt(lx * lx + ly * ly);
      const stickPushed = stickMagnitude > 0.7;
      const stickCentered = stickMagnitude < 0.3;

      if (stickCentered) stickWasCentered.current = true;

      if (stickPushed && stickWasCentered.current) {
        stickWasCentered.current = false;
        const currentId = cursorId ?? (viewState.mode === "subgraph" ? viewState.selectedNodeId : -1);

        // Find parent and siblings
        let parentId = -1;
        let siblings: number[] = [];
        if (currentId >= 0 && graph.childrenOf) {
          for (const [pid, kids] of graph.childrenOf.entries()) {
            if (kids.includes(currentId)) {
              parentId = pid;
              siblings = kids;
              break;
            }
          }
        }
        // Fallback: top-level nodes
        if (siblings.length === 0) {
          for (const [id, depth] of graph.initialDepthMap ?? []) {
            if (depth <= 1 && id >= 0) siblings.push(id);
          }
        }

        if (siblings.length > 0) {
          // Sort siblings by angle around their parent center
          const cx = parentId >= 0 ? graph.nodes[parentId].position.x : 0;
          const cz = parentId >= 0 ? graph.nodes[parentId].position.z : 0;
          const sorted = siblings
            .map(id => ({
              id,
              angle: Math.atan2(graph.nodes[id].position.z - cz, graph.nodes[id].position.x - cx),
            }))
            .sort((a, b) => a.angle - b.angle);

          let curIdx = sorted.findIndex(s => s.id === currentId);
          const isHorizontal = Math.abs(lx) > Math.abs(ly);

          if (isHorizontal) {
            // No current node → start from first/last based on direction
            if (curIdx < 0) curIdx = lx > 0 ? -1 : sorted.length;
            const dir = lx > 0 ? 1 : -1;
            const nextIdx = (curIdx + dir + sorted.length) % sorted.length;
            const nextId = sorted[nextIdx].id;
            onCursorChange(nextId);
            if (cam) {
              const p = graph.nodes[nextId].position;
              cam.setTarget(p.x, p.y, p.z, true);
            }
          } else {
            if (ly < -0.5 && parentId >= 0) {
              // Up → go to parent
              onCursorChange(parentId);
              if (cam) {
                const p = graph.nodes[parentId].position;
                cam.setTarget(p.x, p.y, p.z, true);
              }
            } else if (ly > 0.5) {
              // Down → go to first child of current (or first sibling if no current)
              const target = currentId >= 0 ? currentId : sorted[0].id;
              const children = graph.childrenOf?.get(target) ?? [];
              if (children.length > 0) {
                onCursorChange(children[0]);
                if (cam) {
                  const p = graph.nodes[children[0]].position;
                  cam.setTarget(p.x, p.y, p.z, true);
                }
              }
            }
          }
        }
      }

      // X button (0) → enter/drill into cursor or selected node
      if (justPressed(0)) {
        const target = cursorId ?? (viewState.mode === "subgraph" ? viewState.selectedNodeId : -1);
        if (target >= 0) {
          onNodeClick(target);
          onCursorChange(null);
        }
      }

      // O button (1) → go back
      if (justPressed(1)) {
        if (cursorId !== null) {
          // Clear cursor first
          onCursorChange(null);
        } else if (viewState.mode === "subgraph") {
          const history = viewState.navigationHistory;
          if (history.length >= 2) {
            onNodeClick(history[history.length - 2]);
          } else {
            onReset();
          }
        } else {
          onCollapse();
        }
      }

      // L1 (4) / R1 (5) → cycle contextual actions
      if (actions.length > 0) {
        if (justPressed(5)) {
          actionIdx.current = (actionIdx.current + 1) % actions.length;
          onAction(actions[actionIdx.current].matches);
        }
        if (justPressed(4)) {
          actionIdx.current = (actionIdx.current - 1 + actions.length) % actions.length;
          onAction(actions[actionIdx.current].matches);
        }
      }

      // Triangle (3) → open link
      if (justPressed(3)) {
        const target = cursorId ?? (viewState.mode === "subgraph" ? viewState.selectedNodeId : -1);
        if (target >= 0) {
          const node = graph.nodes[target];
          if (node?.link) onNavigate(node.link);
        }
      }

      prevButtons.current = buttons;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expanded, graph, viewState, cameraRef, onNodeClick, onReset, onCollapse, actions, onAction, onNavigate, cursorId]);

  return null;
}

const MINIMAP_SIZE = 180;
const MINIMAP_CAM_HEIGHT = 200;

export function GraphPortal() {
  const router = useRouter();
  const { workspaces } = useWorkspace();
  const { data: allWsData, loading } = useAllWorkspacesData(workspaces);
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);
  const cameraRef = useRef<CameraControlsImpl>(null);
  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" });
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [simulating, setSimulating] = useState(false);
  const simRef = useRef<number | null>(null);

  // On-demand loader system
  const loadedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const graphRef = useRef<ReturnType<typeof buildGraph> | null>(null);

  const loaders = useMemo(() => {
    const map: Record<string, NodeLoader> = {};
    for (const ws of allWsData) {
      const p = allWsData.length > 1 ? `${ws.slug}-` : "";
      map[`${p}repo-code`] = createRepoCodeLoader(ws.slug, p);
      map[`${p}repo-prs`] = createRepoPRLoader(ws.tasks, ws.slug, p);
      map[`${p}infra-pods`] = createInfraLoader(ws.slug, p);
    }
    return map;
  }, [allWsData]);

  const triggerLoader = useCallback(async (loaderId: string) => {
    if (loadedRef.current.has(loaderId) || loadingRef.current.has(loaderId)) return;
    const loader = loaders[loaderId];
    if (!loader) return;
    loadingRef.current.add(loaderId);
    // Set loading indicator directly on the graph node — progress >= 0 triggers the ring spinner
    const g = graphRef.current;
    if (g) {
      const node = g.nodes.find(n => n.loaderId === loaderId);
      if (node) node.progress = 0;
    }
    try {
      const { nodes: newNodes, edges: newEdges } = await loader();
      loadedRef.current.add(loaderId);
      const g = graphRef.current;
      if (g && newNodes.length > 0) {
        // Append to existing graph — indices stay stable
        const newIdMap = appendToGraph(g, newNodes, newEdges, idMapRef.current);
        for (const [id, idx] of newIdMap) idMapRef.current.set(id, idx);
        allNodeIdsRef.current = [...allNodeIdsRef.current, ...newNodes.map(n => n.id)];
        // Re-layout to position new nodes
        const entityTree = buildEntityTree(g);
        layoutEntityTree(entityTree, g, "radial");
        g.entityTree = entityTree;
        // Clear loading progress on the loader node
        const loaderNode = g.nodes.find(n => n.loaderId === loaderId);
        if (loaderNode) loaderNode.progress = undefined;
      }
      // Bump version to trigger re-render (graph is mutated, same ref)
      setGraphVersion(v => v + 1);
      setGamepadCursor(null);
      setQueryMatches(null);
    } finally {
      loadingRef.current.delete(loaderId);
    }
  }, [loaders]);

  const nodeMetaRef = useRef<Map<string, NodeMeta>>(new Map());
  const allNodeIdsRef = useRef<string[]>([]);
  const [queryMatches, setQueryMatches] = useState<Set<number> | null>(null);
  const [gamepadCursor, setGamepadCursor] = useState<number | null>(null);

  // Merge query matches and gamepad cursor into one searchMatches set
  const searchMatches = useMemo(() => {
    if (!queryMatches && gamepadCursor === null) return null;
    const set = new Set(queryMatches ?? []);
    if (gamepadCursor !== null) set.add(gamepadCursor);
    return set.size > 0 ? set : null;
  }, [queryMatches, gamepadCursor]);

  // Build base graph once from workspace data — stable node indices
  const idMapRef = useRef<Map<string, number>>(new Map());
  const [graphVersion, setGraphVersion] = useState(0);

  // Build graph from workspace data — only rebuilds when workspace data changes
  const graph = useMemo(() => {
    if (allWsData.length === 0) return null;
    const { nodes, edges, nodeMeta } = buildWorkspaceGraph(allWsData);
    nodeMetaRef.current = nodeMeta;
    allNodeIdsRef.current = nodes.map(n => n.id);
    const g = buildGraph(nodes, edges);
    const idMap = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) idMap.set(nodes[i].id, i);
    idMapRef.current = idMap;
    loadedRef.current.clear(); // reset loaded loaders when base data changes
    const entityTree = buildEntityTree(g);
    layoutEntityTree(entityTree, g, "radial");
    g.entityTree = entityTree;
    return g;
  }, [allWsData]);
  // graphVersion triggers re-render only — graph is mutated in place by appendToGraph
  void graphVersion;

  const handleQueryAction = useCallback((matches: Set<number>) => {
    setQueryMatches(prev => prev === matches ? null : matches);
  }, []);

  const clearQuery = useCallback(() => setQueryMatches(null), []);
  graphRef.current = graph;

  const handleNodeClick = useCallback((nodeId: number) => {
    if (!expanded || !graph) return;
    if (viewState.mode === "subgraph" && viewState.selectedNodeId === nodeId) return;
    setGamepadCursor(null);

    // Trigger on-demand loading if node has a loaderId
    const node = graph.nodes[nodeId];
    if (node?.loaderId) {
      triggerLoader(node.loaderId);
    }

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
  }, [graph, viewState, expanded, triggerLoader]);

  const handleReset = useCallback(() => {
    setViewState({ mode: "overview" });
    setQueryMatches(null);
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

  // Current contextual actions for gamepad
  const currentActions = viewState.mode === "subgraph"
    ? getNodeActions(viewState.selectedNodeId, graph, nodeMetaRef.current, allNodeIdsRef.current)
    : [];

  const handleGamepadNavigate = (link: string) => {
    handleCollapse();
    router.push(link);
  };

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
          searchMatches={expanded ? searchMatches : null}
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
              const nodeId = viewState.selectedNodeId;
              const node = graph.nodes[nodeId];
              if (!node) return null;
              const p = node.position;
              const actions = getNodeActions(nodeId, graph, nodeMetaRef.current, allNodeIdsRef.current);
              return (
                <>
                  {/* Link button */}
                  {node.link && (
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
                  )}
                  {/* Contextual query actions */}
                  {actions.length > 0 && (
                    <Html position={[p.x, p.y, p.z]} center style={{ pointerEvents: "none" }}>
                      <div style={{
                        position: "absolute",
                        top: node.link ? -90 : -52,
                        left: -60,
                        display: "flex",
                        gap: 6,
                        pointerEvents: "auto",
                      }}>
                        {actions.map(a => (
                          <button
                            key={a.label}
                            onClick={() => handleQueryAction(a.matches)}
                            style={{
                              ...actionBtnStyle,
                              ...(queryMatches === a.matches ? {
                                borderColor: "rgba(255, 220, 80, 0.6)",
                                color: "rgba(255, 220, 80, 0.95)",
                                background: "rgba(40, 30, 0, 0.85)",
                              } : {}),
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                          >
                            {a.label} ({a.matches.size})
                          </button>
                        ))}
                      </div>
                    </Html>
                  )}
                </>
              );
            })()}
          </>
        )}
        <EffectComposer>
          <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.4} mipmapBlur radius={0.3} />
        </EffectComposer>
      </Canvas>

      {/* Gamepad controller */}
      <GamepadController
        graph={graph}
        viewState={viewState}
        cameraRef={cameraRef}
        onNodeClick={handleNodeClick}
        onReset={handleReset}
        onCollapse={handleCollapse}
        expanded={expanded}
        actions={currentActions}
        onAction={handleQueryAction}
        onNavigate={handleGamepadNavigate}
        cursorId={gamepadCursor}
        onCursorChange={setGamepadCursor}
      />

      {/* Expanded overlay controls */}
      {expanded && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {/* Active query indicator — top left */}
          {queryMatches && (
            <button
              onClick={clearQuery}
              style={{
                position: "absolute", top: 20, left: 20, zIndex: 20,
                padding: "6px 14px", borderRadius: 20,
                border: "1px solid rgba(255, 220, 80, 0.4)",
                background: "rgba(40, 30, 0, 0.85)",
                backdropFilter: "blur(8px)",
                color: "rgba(255, 220, 80, 0.9)",
                fontSize: 12, fontFamily: "'Barlow', sans-serif", fontWeight: 600,
                cursor: "pointer", pointerEvents: "auto",
              }}
            >
              {queryMatches.size} matches \u2715
            </button>
          )}
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
