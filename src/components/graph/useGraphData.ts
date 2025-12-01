import { useState, useEffect } from "react";

interface GraphNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface UseGraphDataOptions {
  endpoint?: string;
  params?: Record<string, string>;
  enabled?: boolean;
  transform?: (data: any) => GraphData;
}

interface UseGraphDataReturn {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export const DEFAULT_TRANSFORM = (data: any): GraphData => {
  // Handle API response that returns {nodes, edges}
  if (data.nodes && data.edges) {
    return {
      nodes: data.nodes.map((node: any) => ({
        id: node.ref_id || node.id,
        name: node.properties?.name || node.properties?.title || node.name || "Unnamed",
        type: node.node_type || node.labels?.find((l: string) => l !== "Data_Bank") || node.type || "Unknown",
        ...node,
      })),
      edges: data.edges.map((edge: any) => ({
        source: edge.source,
        target: edge.target,
        ...edge,
      })),
    };
  }

  return { nodes: [], edges: [] };
};

export function useGraphData({
  endpoint = "/api/subgraph",
  params = {},
  enabled = true,
  transform = DEFAULT_TRANSFORM,
}: UseGraphDataOptions = {}): UseGraphDataReturn {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams(params).toString();
        const url = queryParams ? `${endpoint}?${queryParams}` : endpoint;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const transformed = transform(data);

        setNodes(transformed.nodes);
        setEdges(transformed.edges);
      } catch (err) {
        console.error("Error fetching graph data:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch graph data");
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [endpoint, JSON.stringify(params), enabled, refetchTrigger]);

  const refetch = () => {
    setRefetchTrigger((prev) => prev + 1);
  };

  return { nodes, edges, loading, error, refetch };
}
