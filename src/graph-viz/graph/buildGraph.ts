import type { Graph, GraphEdge } from "./types";
import { isStructuralEdge } from "./types";

export interface RawNode {
  id: string;
  label: string;
  link?: string;
  icon?: string;
  status?: "executing" | "done" | "idle";
  progress?: number;
  content?: string;
  loaderId?: string;
}

export interface RawEdge {
  source: string;
  target: string;
  label?: string;
  type?: string;
}

export function buildGraph(nodes: RawNode[], edges: RawEdge[]): Graph {
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    idToIndex.set(nodes[i].id, i);
  }

  const n = nodes.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  const inAdj: number[][] = Array.from({ length: n }, () => []);
  const structuralAdj: number[][] = Array.from({ length: n }, () => []);
  const structuralOutAdj: number[][] = Array.from({ length: n }, () => []);
  const structuralInAdj: number[][] = Array.from({ length: n }, () => []);
  const graphEdges: GraphEdge[] = [];
  let hasUnstructuredEdges = false;

  for (const e of edges) {
    const src = idToIndex.get(e.source);
    const dst = idToIndex.get(e.target);
    if (src === undefined || dst === undefined) continue;

    const ge: GraphEdge = { src, dst, label: e.label, type: e.type };
    graphEdges.push(ge);
    adj[src].push(dst);
    adj[dst].push(src);
    outAdj[src].push(dst);
    inAdj[dst].push(src);

    if (isStructuralEdge(ge)) {
      structuralAdj[src].push(dst);
      structuralAdj[dst].push(src);
      structuralOutAdj[src].push(dst);
      structuralInAdj[dst].push(src);
    } else {
      hasUnstructuredEdges = true;
    }
  }

  const graphNodes = nodes.map((node, i) => ({
    id: i,
    label: node.label,
    position: { x: 0, y: 0, z: 0 },
    degree: adj[i].length,
    ...(node.link != null && { link: node.link }),
    ...(node.icon != null && { icon: node.icon }),
    ...(node.status != null && { status: node.status }),
    ...(node.progress != null && { progress: node.progress }),
    ...(node.content != null && { content: node.content }),
    ...(node.loaderId != null && { loaderId: node.loaderId }),
  }));

  // Classify unstructured nodes: BFS from roots through structural edges only
  let unstructuredNodeIds: Set<number> | undefined;
  if (hasUnstructuredEdges) {
    const reached = new Set<number>();
    // Roots = nodes with zero structural in-degree
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (structuralInAdj[i].length === 0 && structuralAdj[i].length > 0) {
        reached.add(i);
        queue.push(i);
      }
    }
    // If no roots found (all have in-edges), seed from node 0
    if (queue.length === 0 && n > 0) {
      // Check if any node has structural edges at all
      for (let i = 0; i < n; i++) {
        if (structuralAdj[i].length > 0) {
          reached.add(i);
          queue.push(i);
          break;
        }
      }
    }
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      for (const nb of structuralAdj[cur]) {
        if (!reached.has(nb)) {
          reached.add(nb);
          queue.push(nb);
        }
      }
    }
    unstructuredNodeIds = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (!reached.has(i)) unstructuredNodeIds.add(i);
    }
    if (unstructuredNodeIds.size === 0) unstructuredNodeIds = undefined;
  }

  return {
    nodes: graphNodes, edges: graphEdges, adj, outAdj, inAdj,
    structuralAdj, structuralOutAdj, structuralInAdj,
    ...(unstructuredNodeIds && { unstructuredNodeIds }),
  };
}
