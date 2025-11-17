"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { useDataStore, useGraphStore } from "@/stores/useStores";
import { Link, Node } from "@Universe/types";
import { useCallback, useEffect, useState } from "react";
import { Universe } from "./Universe";
import { FilterTab } from "@/stores/graphStore.types";
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

// --- MAIN COMPONENT ---
interface GraphComponentProps {
  endpoint?: string;
  title?: string;
  enablePolling?: boolean;
  enableRotation?: boolean;
  className?: string;
  height?: string;
  width?: string;
  topLeftWidget?: React.ReactNode;
  topRightWidget?: React.ReactNode;
  bottomLeftWidget?: React.ReactNode;
  bottomRightWidget?: React.ReactNode;
}

export const GraphComponent = ({
  endpoint: propEndpoint,
  enableRotation = false,
  className,
  height = "h-full",
  width = "w-full",
  topLeftWidget,
  topRightWidget,
  bottomLeftWidget,
  bottomRightWidget
}: GraphComponentProps = {}) => {
  return (
    <GraphComponentInner
      endpoint={propEndpoint}
      enableRotation={enableRotation}
      className={className}
      height={height}
      width={width}
      topLeftWidget={topLeftWidget}
      topRightWidget={topRightWidget}
      bottomLeftWidget={bottomLeftWidget}
      bottomRightWidget={bottomRightWidget}
    />
  );
};

const GraphComponentInner = ({
  endpoint: propEndpoint,
  enableRotation = false,
  className,
  height = "h-full",
  width = "w-full",
  topLeftWidget,
  topRightWidget,
  bottomLeftWidget,
  bottomRightWidget
}: GraphComponentProps) => {
  const { id: workspaceId } = useWorkspace();
  const [nodesLoading, setNodesLoading] = useState(false);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const resetData = useDataStore((s) => s.resetData);
  const dataInitial = useDataStore((s) => s.dataInitial);
  const activeFilterTab = useGraphStore((s) => s.activeFilterTab);


  useEffect(() => {
    const fetchSchema = async () => {
      const response = await fetch(`/api/swarm/jarvis/schema?id=${workspaceId}`);
      const data: SchemaResponse = await response.json();

      console.log("schema data", data);
      if (data.data) {

        setSchemas(data.data.schemas.filter((schema) => !schema.is_deleted))
        if (!data.success) throw new Error("Failed to fetch schema data");
        console.log("schema data", data);
      };
    };
    fetchSchema();
  }, [workspaceId, setSchemas]);

  // Fetch data based on active filter tab
  const fetchFilteredData = useCallback(async (tab: FilterTab) => {
    if (!workspaceId) return;

    resetData();
    setNodesLoading(true);

    try {
      let requestUrl: string;

      switch (tab) {
        case 'all':
          // Use existing endpoint or default
          requestUrl = propEndpoint
            ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}`
            : `/api/swarm/jarvis/nodes?id=${workspaceId}`;
          break;

        case 'code':
          // Filter for code-related nodes
          const codeNodeTypes = JSON.stringify(['Function', 'Endpoint', 'Page', 'Datamodel']);
          requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(`graph/search?limit=10&top_node_count=100`)}&node_type=${encodeURIComponent(codeNodeTypes)}`;
          break;

        case 'comms':
          // Filter for communication nodes
          const commsNodeTypes = JSON.stringify(['Episode', 'Message']);
          requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(`graph/search?limit=10&top_node_count=10`)}&node_type=${encodeURIComponent(commsNodeTypes)}`;
          break;

        case 'tasks':
          // Fetch latest 10 tasks from tasks API
          requestUrl = `/api/tasks?workspaceId=${workspaceId}&limit=10`;
          console.log('[Graph Filter] Fetching tasks from:', requestUrl);
          const tasksResponse = await fetch(requestUrl);
          console.log('[Graph Filter] Response status:', tasksResponse.status, tasksResponse.ok);
          const tasksData = await tasksResponse.json();
          console.log('[Graph Filter] Tasks response:', JSON.stringify(tasksData, null, 2));
          console.log('[Graph Filter] tasksData.success:', tasksData.success);
          console.log('[Graph Filter] Is array?', Array.isArray(tasksData.data));
          console.log('[Graph Filter] Data length:', tasksData.data?.length);

          if (tasksData.success && Array.isArray(tasksData.data)) {
            console.log('[Graph Filter] Found', tasksData.data.length, 'tasks');
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

            console.log('[Graph Filter] Transformed task nodes:', taskNodes);
            addNewNode({
              nodes: taskNodes,
              edges: [],
            });
          } else {
            console.log('[Graph Filter] No tasks data or request failed');
          }
          setNodesLoading(false);
          return;

        default:
          requestUrl = propEndpoint
            ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}`
            : `/api/swarm/jarvis/nodes?id=${workspaceId}`;
      }

      const response = await fetch(requestUrl);
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
    } catch (err) {
      console.error("Failed to load filtered data:", err);
    } finally {
      setNodesLoading(false);
    }
  }, [workspaceId, resetData, addNewNode, propEndpoint]);

  // Load data when filter changes
  useEffect(() => {
    fetchFilteredData(activeFilterTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterTab]);

  return (
    <div data-testid="graph-component" className={`dark ${height} ${width} border rounded-lg relative bg-card flex flex-col ${className || ''}`}>
      {/* Top-left widget */}
      {topLeftWidget && (
        <div className="absolute top-4 left-4 z-10">{topLeftWidget}</div>
      )}

      {/* Top-right widget */}
      {topRightWidget && (
        <div className="absolute top-4 right-4 z-10">{topRightWidget}</div>
      )}

      {/* Bottom-left widget */}
      {bottomLeftWidget && (
        <div className="absolute bottom-4 left-4 z-10">{bottomLeftWidget}</div>
      )}

      {/* Bottom-right widget */}
      {bottomRightWidget && (
        <div className="absolute bottom-4 right-4 z-10">{bottomRightWidget}</div>
      )}

      <div className="border rounded overflow-hidden bg-card flex-1">
        {nodesLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">Loading...</div>
          </div>
        ) : (!dataInitial?.nodes || dataInitial.nodes.length === 0) ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">No data found</div>
          </div>
        ) : (
          <Universe enableRotation={enableRotation} />
        )}
      </div>

    </div >
  );
};
