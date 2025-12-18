"use client";

import { Universe } from "@/components/knowledge-graph/Universe";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { useGraphStore as useGraphStoreStandalone, FilterTab } from "@/stores/useGraphStore";
import { useDataStore } from "@/stores/useStores";
import { Link, Node } from "@Universe/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

// --- TYPE DEFINITIONS ---

interface ApiResponse {
  success: boolean;
  data?: {
    nodes?: Node[];
    edges?: Link[];
  };
}

interface SchemaResponse {
  success: boolean;
  data?: {
    schemas: SchemaExtended[];
  };
}

interface SynchronizedGraphComponentProps {
  endpoint?: string;
  title?: string;
  className?: string;
  height?: string;
  width?: string;
  currentTime?: number;
  onTimeMarkerClick?: (time: number) => void;
}

interface NodeWithTimestamp extends Node {
  start?: number;
  neighbourHood?: string;
}

interface LinkWithTimestamp extends Link {
  properties?: {
    start?: number;
    end?: number;
    [key: string]: any;
  };
}

const findCurrentEdge = (sortedEdges: LinkWithTimestamp[], playerProgress: number): LinkWithTimestamp | null => {
  let low = 0;
  let high = sortedEdges.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const edge = sortedEdges[mid];
    const start = edge.properties?.start || 0;
    const end = edge.properties?.end || start + 1;

    if (playerProgress >= start && playerProgress <= end) {
      return edge;
    }

    if (playerProgress < start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return null;
};

export const SynchronizedGraphComponent = ({
  endpoint: propEndpoint,
  title = "Synchronized Knowledge Graph",
  className,
  height = "h-full",
  width = "w-full",
  currentTime = 0,
  onTimeMarkerClick
}: SynchronizedGraphComponentProps) => {

  return (
    <SynchronizedGraphComponentInner
      endpoint={propEndpoint}
      title={title}
      className={className}
      height={height}
      width={width}
      currentTime={currentTime}
      onTimeMarkerClick={onTimeMarkerClick}
    />
  );
};

const SynchronizedGraphComponentInner = ({
  endpoint: propEndpoint,
  title = "Synchronized Knowledge Graph",
  className,
  height = "h-full",
  width = "w-full",
  currentTime = 0,
  onTimeMarkerClick
}: SynchronizedGraphComponentProps) => {
  const { id: workspaceId } = useWorkspace();
  const [markers, setMarkers] = useState<NodeWithTimestamp[]>([]);
  const [activeEdge, setActiveEdge] = useState<LinkWithTimestamp | null>(null);

  const requestRef = useRef<number | null>(null);
  const previousTimeRef = useRef<number | null>(null);
  const nodesAndEdgesRef = useRef<{ nodes: Node[], edges: Link[] } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const resetData = useDataStore((s) => s.resetData);
  const dataInitial = useDataStore((s) => s.dataInitial);

  // Graph filter state
  const activeFilterTab = useGraphStoreStandalone((s) => s.activeFilterTab);
  const setActiveFilterTab = useGraphStoreStandalone((s) => s.setActiveFilterTab);
  const isFilterLoading = useGraphStoreStandalone((s) => s.isFilterLoading);
  const setIsFilterLoading = useGraphStoreStandalone((s) => s.setIsFilterLoading);

  // Calculate markers from data
  const calculateMarkers = useCallback((data: { nodes: Node[], edges: Link[] }): NodeWithTimestamp[] => {
    const edgesWithStart = data.edges
      .filter((e) => e?.properties?.start)
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        start: edge.properties!.start as number,
      }));

    const markers = data.nodes
      .filter((node) => data.edges.some((ed) => ed.source === node.ref_id || ed.target === node.ref_id))
      .map((node) => {
        const matchingEdge = edgesWithStart.find((ed) => node.ref_id === ed.source || node.ref_id === ed.target);
        return { ...node, start: matchingEdge?.start || 0 } as NodeWithTimestamp;
      })
      .filter((node) => node && node.node_type !== 'Clip' && node.node_type !== 'Episode' && node.node_type !== 'Call' && node.node_type !== 'Show');

    return markers;
  }, []);

  // Handle time-based node visibility updates
  useEffect(() => {
    const update = (time: number) => {
      if (previousTimeRef.current !== null) {
        const deltaTime = time - previousTimeRef.current;

        if (deltaTime > 2000) { // Update every 2 seconds
          if (nodesAndEdgesRef.current) {
            const { nodes, edges } = nodesAndEdgesRef.current;

            const [matchingLinks, remainingLinks] = edges.reduce<[Link[], Link[]]>(
              ([matches, remaining], link) => {
                const linkStart = (link?.properties as any)?.start;
                if (linkStart !== undefined && linkStart < currentTime + 1) {
                  matches.push(link);
                } else {
                  remaining.push(link);
                }
                return [matches, remaining];
              },
              [[], []]
            );

            const [matchingNodes, remainingNodes] = nodes.reduce<[Node[], Node[]]>(
              ([matches, remaining], node) => {
                if (matchingLinks.some((edge) => edge.target === node.ref_id || edge.source === node.ref_id)) {
                  matches.push(node);
                } else {
                  remaining.push(node);
                }
                return [matches, remaining];
              },
              [[], []]
            );

            nodesAndEdgesRef.current = {
              nodes: remainingNodes,
              edges: remainingLinks,
            };

            if (matchingNodes.length || matchingLinks.length) {
              addNewNode({
                nodes: matchingNodes.map(node => ({
                  ...node,
                  x: 0,
                  y: 0,
                  z: 0,
                  edge_count: 0
                })),
                edges: matchingLinks
              });
            }
          }

          previousTimeRef.current = time;
        }
      } else {
        previousTimeRef.current = time;
      }

      requestRef.current = requestAnimationFrame(update);
    };

    requestRef.current = requestAnimationFrame(update);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [currentTime, addNewNode]);

  // Update active edge based on current time
  useEffect(() => {
    if (dataInitial?.links) {
      const edgesFiltered = dataInitial.links.filter((link) => link?.properties?.start) || [];
      const sortedEdges = edgesFiltered
        .slice()
        .sort((a, b) => ((a?.properties as any)?.start || 0) - ((b?.properties as any)?.start || 0));

      const edge = findCurrentEdge(sortedEdges as LinkWithTimestamp[], currentTime);
      setActiveEdge(edge);
    }
  }, [currentTime, dataInitial]);

  // Load schema data
  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const response = await fetch(`/api/swarm/jarvis/schema?id=${workspaceId}`);
        const data: SchemaResponse = await response.json();

        if (data.data) {
          setSchemas(data.data.schemas.filter((schema) => !schema.is_deleted));
          if (!data.success) throw new Error("Failed to fetch schema data");
        }
      } catch (err) {
        console.error("Failed to load schema:", err);
      }
    };

    fetchSchema();
  }, [workspaceId, setSchemas]);

  // Load nodes and calculate markers
  useEffect(() => {
    const fetchNodes = async () => {
      resetData();
      setIsFilterLoading(true);
      try {
        const requestUrl = propEndpoint
          ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}`
          : `/api/swarm/jarvis/nodes?id=${workspaceId}`;

        const response = await fetch(requestUrl);
        const data: ApiResponse = await response.json();

        if (!data.success) throw new Error("Failed to fetch nodes data");

        if (data.data?.nodes && data.data.nodes.length > 0) {
          const nodesWithPosition = data.data.nodes.map(node => ({
            ...node,
            x: 0,
            y: 0,
            z: 0,
            edge_count: 0
          }));

          // Store data for time-based processing
          nodesAndEdgesRef.current = {
            nodes: nodesWithPosition,
            edges: data.data.edges || []
          };

          // Calculate and set markers
          const computedMarkers = calculateMarkers({
            nodes: nodesWithPosition,
            edges: data.data.edges || []
          });
          setMarkers(computedMarkers);

          // Add initial nodes to store
          addNewNode({
            nodes: nodesWithPosition,
            edges: data.data.edges || []
          });
        }
      } catch (err) {
        console.error("Failed to load nodes:", err);
      } finally {
        setIsFilterLoading(false);
      }
    };

    fetchNodes();
  }, [workspaceId, addNewNode, resetData, propEndpoint, calculateMarkers]);

  // Fetch data based on active filter tab
  const fetchFilteredData = useCallback(async (tab: FilterTab) => {
    if (!workspaceId) return;

    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    resetData();
    setIsFilterLoading(true);

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let requestUrl: string;

      switch (tab) {
        case 'all':
          // Use existing graph/search/latest endpoint
          requestUrl = propEndpoint
            ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}`
            : `/api/swarm/jarvis/nodes?id=${workspaceId}`;
          break;

        case 'code':
          // Filter for code-related nodes
          const codeNodeTypes = JSON.stringify(['Function', 'Endpoint', 'Page', 'Datamodel']);
          requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(`graph/search`)}&node_type=${encodeURIComponent(codeNodeTypes)}`;
          break;

        case 'comms':
          // Filter for communication nodes
          const commsNodeTypes = JSON.stringify(['Episode', 'Call', 'Message']);
          requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(`graph/search`)}&node_type=${encodeURIComponent(commsNodeTypes)}`;
          break;

        case 'tasks':
          // Fetch latest 10 tasks from tasks API
          requestUrl = `/api/tasks?workspaceId=${workspaceId}&limit=10`;
          const tasksResponse = await fetch(requestUrl, { signal: abortController.signal });
          const tasksData = await tasksResponse.json();

          if (tasksData.success && Array.isArray(tasksData.data)) {
            // Transform tasks to graph nodes
            const taskNodes = tasksData.data.map((task: any) => ({
              ref_id: task.id,
              node_type: 'Task',
              name: task.title,
              label: task.title,
              properties: {
                name: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
              } as any,
              x: 0,
              y: 0,
              z: 0,
              edge_count: 0,
            }));

            addNewNode({
              nodes: taskNodes,
              edges: [],
            });
          }
          setIsFilterLoading(false);
          return;

        default:
          requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}`;
      }

      const response = await fetch(requestUrl, { signal: abortController.signal });
      const data: ApiResponse = await response.json();

      if (!data.success) throw new Error("Failed to fetch filtered data");

      if (data.data?.nodes && data.data.nodes.length > 0) {
        const nodesWithPosition = data.data.nodes.map((node: Node) => ({
          ...node,
          x: 0,
          y: 0,
          z: 0,
          edge_count: 0,
        }));

        addNewNode({
          nodes: nodesWithPosition,
          edges: data.data.edges || [],
        });
      }
    } catch (error) {
      // If the request was aborted, don't show error or set loading to false
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }
      console.error("Failed to load filtered data:", error);
    } finally {
      // Only set loading to false if this request wasn't aborted
      if (abortControllerRef.current === abortController) {
        setIsFilterLoading(false);
        abortControllerRef.current = null;
      }
    }
  }, [workspaceId, resetData, addNewNode, propEndpoint]);

  // Handle filter tab changes
  const handleTabChange = useCallback((tab: FilterTab) => {
    setActiveFilterTab(tab);
    fetchFilteredData(tab);
  }, [setActiveFilterTab, fetchFilteredData]);

  // Load initial data when filter tab changes
  useEffect(() => {
    if (activeFilterTab) {
      fetchFilteredData(activeFilterTab);
    }
  }, []);

  return (
    <div
      data-testid="synchronized-graph-component"
      className={`dark ${height} ${width} border rounded-lg relative bg-card flex flex-col ${className || ''}`}
    >
      {/* Current Time Indicator */}
      {currentTime > 0 && (
        <div className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-md text-sm">
          <span className="text-muted-foreground">Time: </span>
          <span className="font-mono">{Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}</span>
        </div>
      )}

      {/* Active Edge Indicator */}
      {activeEdge && (
        <div className="absolute top-4 right-4 z-10 bg-blue-500/20 backdrop-blur-sm px-3 py-1 rounded-md text-sm">
          <span className="text-blue-400">Active: </span>
          <span className="text-blue-300">Edge {activeEdge.source?.slice(0, 8)}...</span>
        </div>
      )}

      {/* Time Markers */}
      {/* {markers.length > 0 && onTimeMarkerClick && (
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="bg-background/80 backdrop-blur-sm rounded-md p-2">
            <div className="text-xs text-muted-foreground mb-2">Timeline Markers</div>
            <div className="flex gap-1 overflow-x-auto">
              {markers
                .filter(marker => marker.start !== undefined)
                .sort((a, b) => (a.start || 0) - (b.start || 0))
                .slice(0, 10) // Limit to first 10 markers
                .map((marker, index) => (
                  <button
                    key={marker.ref_id || index}
                    onClick={() => onTimeMarkerClick(marker.start || 0)}
                    className={`px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${currentTime >= (marker.start || 0)
                        ? 'bg-blue-500 text-white'
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      }`}
                    title={`${marker.node_type}: ${marker.properties?.name || marker.ref_id} at ${Math.floor((marker.start || 0) / 60)}:${String(Math.floor((marker.start || 0) % 60)).padStart(2, '0')}`}
                  >
                    {Math.floor((marker.start || 0) / 60)}:{String(Math.floor((marker.start || 0) % 60)).padStart(2, '0')}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )} */}

      <div className="border rounded overflow-hidden bg-card flex-1">
        {isFilterLoading ? (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2">
              <Spinner className="w-6 h-6" />
              <div className="text-sm text-muted-foreground">Loading filtered data...</div>
            </div>
          </div>
        ) : null}
        {!dataInitial?.nodes || dataInitial.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">
              No synchronized data found
            </div>
          </div>
        ) : (
          <Universe />
        )}
      </div>
    </div>
  );
};
