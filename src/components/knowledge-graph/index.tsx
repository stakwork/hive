"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { FilterTab } from "@/stores/graphStore.types";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { useDataStore, useGraphStore } from "@/stores/useStores";
import { Link, Node } from "@Universe/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Universe } from "./Universe";
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
}: GraphComponentProps = {}) => {
  return (
    <GraphComponentInner
      endpoint={propEndpoint || ''}
      enableRotation={enableRotation}
      className={className || ''}
      height={height}
      width={width}
    />
  );
};

type Props = {
  endpoint: string;
  enableRotation: boolean;
  className: string;
  height: string;
  width: string;
}

const GraphComponentInner = ({
  endpoint: propEndpoint,
  enableRotation = false,
  className,
  height = "h-full",
  width = "w-full",
}: Props) => {
  const { id: workspaceId, slug, workspace } = useWorkspace();
  const [nodesLoading, setNodesLoading] = useState(false);
  const currentRequestRef = useRef<AbortController | null>(null);
  const isInitialMountRef = useRef(true);
  const isOnboarding = useDataStore((s) => s.isOnboarding);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const resetData = useDataStore((s) => s.resetData);
  const dataInitial = useDataStore((s) => s.dataInitial);
  const activeFilterTab = useGraphStore((s) => s.activeFilterTab);
  const setNodeTypeOrder = useDataStore((s) => s.setNodeTypeOrder);


  // Sync workspace nodeTypeOrder configuration to dataStore
  useEffect(() => {
    if (workspace?.nodeTypeOrder) {
      setNodeTypeOrder(workspace.nodeTypeOrder);
    }
  }, [workspace?.nodeTypeOrder, setNodeTypeOrder]);

  useEffect(() => {
    const fetchSchema = async () => {
      const response = await fetch(`/api/swarm/jarvis/schema?id=${workspaceId}`);
      const data: SchemaResponse = await response.json();

      if (data.data) {
        setSchemas(data.data.schemas.filter((schema) => !schema.is_deleted))
        if (!data.success) throw new Error("Failed to fetch schema data");
      };
    };
    fetchSchema();
  }, [workspaceId, setSchemas]);

  // Fetch data based on active filter tab
  const fetchFilteredData = useCallback(async (tab: FilterTab, forceRefresh = false) => {
    if (!workspaceId) return;

    // Cancel previous request if it exists
    if (currentRequestRef.current) {
      currentRequestRef.current.abort();
    }

    // Only reset data if this is a forced refresh
    if (forceRefresh) {
      resetData();
    }

    setNodesLoading(true);

    // Create new abort controller for this request
    const abortController = new AbortController();
    currentRequestRef.current = abortController;

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
          requestUrl = `/api/workspaces/${slug}/graph/nodes?node_type=${encodeURIComponent(codeNodeTypes)}&limit=1000&limit_mode=per_type`;
          break;

        case 'comms':
          // Filter for communication nodes
          const commsNodeTypes = JSON.stringify(['Episode', 'Call', 'Message', 'Person']);
          requestUrl = `/api/workspaces/${slug}/graph/nodes?node_type=${encodeURIComponent(commsNodeTypes)}&limit=1000&limit_mode=per_type`;
          break;

        case 'concepts':
          // Filter for communication nodes
          const conceptsNodeTypes = JSON.stringify(['Function', 'Endpoint', 'Feature', 'File']);
          requestUrl = `/api/workspaces/${slug}/graph/gitree?node_type=${encodeURIComponent(conceptsNodeTypes)}&limit=10000&limit_mode=per_type`;
          break;

        case 'tasks':
          // Fetch latest 10 tasks from tasks API
          requestUrl = `/api/tasks?workspaceId=${workspaceId}&limit=1000`;
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
          setNodesLoading(false);
          return;

        default:
          requestUrl = propEndpoint
            ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}`
            : `/api/swarm/jarvis/nodes?id=${workspaceId}`;
      }

      console.log('requestUrl', requestUrl);

      const response = await fetch(requestUrl, { signal: abortController.signal });
      const data: ApiResponse = await response.json();

      if (!data.success) {
        console.error("[Graph] API returned error:", data);
        throw new Error(`Failed to fetch graph data: ${data.message || 'Unknown error'}`);
      }

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
      console.error('Failed to fetch graph data:', error);
    } finally {
      // Only set loading to false if this request wasn't aborted
      if (currentRequestRef.current === abortController) {
        setNodesLoading(false);
        currentRequestRef.current = null;
      }
    }
  }, [workspaceId, resetData, addNewNode, propEndpoint, slug]);

  // Load data when filter changes
  useEffect(() => {

    if (isOnboarding) return;
    const hasExistingData = dataInitial?.nodes && dataInitial.nodes.length > 0;

    if (isInitialMountRef.current) {
      // First mount: only fetch if no data exists
      isInitialMountRef.current = false;
      if (!hasExistingData) {
        console.log('Initial mount - no existing data, fetching for tab:', activeFilterTab);
        fetchFilteredData(activeFilterTab);
      } else {
        console.log('Initial mount - found existing data, skipping fetch for tab:', activeFilterTab);
      }
    } else {
      // Subsequent changes: this is an actual tab change, always fetch with refresh
      console.log('Tab changed, fetching with refresh for tab:', activeFilterTab);
      fetchFilteredData(activeFilterTab, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterTab, isOnboarding]);

  return (
    <div data-testid="graph-component" className={`dark ${height} ${width} border rounded-lg relative bg-card flex flex-col ${className || ''}`}>

      <div className="border rounded overflow-hidden bg-card flex-1">
        {nodesLoading && !isOnboarding ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">Loading...</div>
          </div>
        ) : ((!dataInitial?.nodes || dataInitial.nodes.length === 0) && !isOnboarding) ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">No data found</div>
          </div>
        ) : (
          null
        )}
        <Universe enableRotation={enableRotation} />
      </div>

    </div >
  );
};
