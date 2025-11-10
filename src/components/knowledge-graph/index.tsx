"use client";

import { GitHubStatusWidget } from "@/components/dashboard/github-status-widget";
import { IngestionStatusWidget } from "@/components/dashboard/ingestion-status-widget";
import { PoolStatusWidget } from "@/components/dashboard/pool-status-widget";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { useDataStore } from "@/stores/useStores";
import { Link, Node } from "@Universe/types";
import { useEffect, useState } from "react";
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
  showWidgets?: boolean;
}

export const GraphComponent = ({
  endpoint: propEndpoint,
  enableRotation = false,
  className,
  height = "h-full",
  width = "w-full",
  showWidgets = false
}: GraphComponentProps = {}) => {
  return (
    <GraphComponentInner
      endpoint={propEndpoint}
      enableRotation={enableRotation}
      className={className}
      height={height}
      width={width}
      showWidgets={showWidgets}
    />
  );
};

const GraphComponentInner = ({
  endpoint: propEndpoint,
  enableRotation = false,
  className,
  height = "h-full",
  width = "w-full",
  showWidgets = false
}: GraphComponentProps) => {
  const { id: workspaceId } = useWorkspace();
  const [nodesLoading, setNodesLoading] = useState(false);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const resetData = useDataStore((s) => s.resetData);
  const dataInitial = useDataStore((s) => s.dataInitial);


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

  // --- load nodes ---
  useEffect(() => {
    const fetchNodes = async () => {
      // resetData()
      setNodesLoading(true);
      try {

        const requestUrl = propEndpoint ? `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(propEndpoint)}` : `/api/swarm/jarvis/nodes?id=${workspaceId}`;

        const response = await fetch(requestUrl);
        const data: ApiResponse = await response.json();
        if (!data.success) throw new Error("Failed to fetch nodes data");
        if (data.data?.nodes && data.data.nodes.length > 0) {

          addNewNode({
            nodes: data.data.nodes.map(node => ({
              ...node,

              x: 0,
              y: 0,
              z: 0,
              edge_count: 0
            })),
            edges: data.data.edges || []
          })


        }
      } catch (err) {
        console.error("Failed to load nodes:", err);
      } finally {
        setNodesLoading(false);
      }
    };

    if (dataInitial?.nodes && dataInitial.nodes.length > 0) {
      return;
    }

    fetchNodes();
  }, [workspaceId, addNewNode, resetData, propEndpoint, dataInitial]);

  return (
    <div data-testid="graph-component" className={`dark ${height} ${width} border rounded-lg relative bg-card flex flex-col ${className || ''}`}>
      {/* Ingestion widget in top-left corner - only when we have data */}
      {showWidgets && dataInitial?.nodes && dataInitial.nodes.length > 0 && <IngestionStatusWidget />}

      {/* Status widgets in top-right corner - only show on dashboard */}
      {showWidgets && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <GitHubStatusWidget />
          <PoolStatusWidget />
        </div>
      )}

      <div className="border rounded overflow-hidden bg-card flex-1">
        {nodesLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-lg text-gray-300">Loading...</div>
          </div>
        ) : (!dataInitial?.nodes || dataInitial.nodes.length === 0) ? (
          <div className="flex h-full items-center justify-center">
            {showWidgets ? (
              <IngestionStatusWidget centered />
            ) : (
              <div className="text-lg text-gray-300">No data found</div>
            )}
          </div>
        ) : (
          <Universe enableRotation={enableRotation} />
        )}
      </div>

    </div >
  );
};
