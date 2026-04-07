import type { Graph, GraphEdge } from "./types";

export interface RawNode {
  id: string;
  label: string;
  link?: string;
  icon?: string;
  status?: "executing" | "done" | "idle";
  progress?: number;
  content?: string;
}

export interface RawEdge {
  source: string;
  target: string;
  label?: string;
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
  const graphEdges: GraphEdge[] = [];

  for (const e of edges) {
    const src = idToIndex.get(e.source);
    const dst = idToIndex.get(e.target);
    if (src === undefined || dst === undefined) continue;

    graphEdges.push({ src, dst, label: e.label });
    adj[src].push(dst);
    adj[dst].push(src);
    outAdj[src].push(dst);
    inAdj[dst].push(src);
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
  }));

  return { nodes: graphNodes, edges: graphEdges, adj, outAdj, inAdj };
}
