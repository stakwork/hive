"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { Link, Node } from "@Universe/types";
import { useEffect, useState } from "react";
import { Universe } from "../../app/w/[slug]/graph/Universe";

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




// --- MAIN COMPONENT ---
interface GraphComponentProps {
  endpoint?: string;
}

export const GraphComponent = ({ endpoint: propEndpoint }: GraphComponentProps = {}) => {
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
      resetData()
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
    fetchNodes();
  }, [workspaceId, addNewNode, resetData, propEndpoint]);


  return (
    <div className="dark h-auto w-full border rounded-lg p-4 relative bg-card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Graph Visualization</h3>
        <div className="flex items-center gap-2">
          {dataInitial?.nodes && dataInitial.nodes.length > 0 && (
            <div className="text-sm text-gray-400">
              {dataInitial.nodes.length} nodes • {dataInitial.links.length} connections
            </div>
          )}
        </div>
      </div>

      <div className="border rounded overflow-hidden bg-card">
        {nodesLoading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-300">Loading...</div>
          </div>
        ) : !dataInitial?.nodes || dataInitial.nodes.length === 0 ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-300">
              No data found
            </div>
          </div>
        ) : (
          <Universe />
        )}
      </div>

    </div >
  );
};
