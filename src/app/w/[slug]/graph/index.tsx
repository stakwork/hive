"use client";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getLanguageFromFile } from "@/lib/syntax-utils";
import { useDataStore } from "@/stores/useDataStore";
import { SchemaExtended, useSchemaStore } from "@/stores/useSchemaStore";
import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs, vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Universe } from "./Universe";
import { Node } from "./Universe/types";

// --- TYPE DEFINITIONS ---

interface ApiResponse {
  success: boolean;
  data?: {
    nodes?: Node[];
    edges?: { source: string; target: string;[key: string]: unknown }[];
  };
}


interface SchemaResponse {
  success: boolean;
  data?: {
    schemas: SchemaExtended[];
  };
}


interface D3Node {
  id: string;
  name: string;
  uuid?: string;
  type: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  [key: string]: unknown;
}

interface D3Link {
  source: string | D3Node;
  target: string | D3Node;
  [key: string]: unknown;
}

// --- COLOR PALETTE ---
const COLOR_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#6366f1",
  "#ec4899",
  "#f97316",
  "#84cc16",
  "#64748b",
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#eab308",
];

// --- HELPERS ---
const getNodeColor = (type: string, nodeTypes: string[]): string => {
  const index = nodeTypes.indexOf(type);
  if (index !== -1) {
    return COLOR_PALETTE[index % COLOR_PALETTE.length];
  }
  return "#6b7280";
};

const getConnectedNodeIds = (nodeId: string, links: D3Link[]): Set<string> => {
  const connectedIds = new Set<string>();
  links.forEach((link) => {
    const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
    const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
    if (sourceId === nodeId) connectedIds.add(targetId);
    else if (targetId === nodeId) connectedIds.add(sourceId);
  });
  return connectedIds;
};

// --- POPUP ---
interface NodePopupProps {
  node: D3Node;
  onClose: () => void;
  connectedNodes: D3Node[];
  isDarkMode?: boolean;
  nodeTypes: string[];
  onNodeClick?: (node: D3Node) => void;
}

const NodePopup = ({ node, onClose, connectedNodes, isDarkMode = true, nodeTypes, onNodeClick }: NodePopupProps) => {
  const properties = (node as any).properties || {};

  // Extract specific properties
  const file = properties.file;
  const text = properties.text;
  const question = properties.question;
  const interfaceText = properties.interface;
  const body = properties.body;
  const tokenCount = properties.token_count;
  const lineStart = properties.start;
  const lineEnd = properties.end;
  const content = properties.content;

  // Check if this is a Hint node (render body as markdown)
  const isHintNode = node.type === "Hint";

  // Determine if we should show code syntax highlighting (but not for Hint nodes)
  const showCode = file && body && !isHintNode;

  // Format line number range
  const lineRange = lineStart !== undefined && lineEnd !== undefined ? `(${lineStart}-${lineEnd})` : "";

  // Build array of fields to display
  const fields: Array<{ label: string; value: string }> = [];

  if (file) fields.push({ label: "File", value: file });
  if (text) fields.push({ label: "Text", value: text });
  if (content) fields.push({ label: "Content", value: content });
  if (question) fields.push({ label: "Question", value: question });
  if (interfaceText) fields.push({ label: "Interface", value: interfaceText });
  if (tokenCount) fields.push({ label: "Token count", value: String(tokenCount) });

  return (
    <div
      className={`absolute right-4 z-50 border rounded-lg shadow-lg p-4 w-96 ${isDarkMode ? "bg-gray-800 border-gray-600" : "bg-white border-gray-300"}`}
      style={{ top: "90px", maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getNodeColor(node.type, nodeTypes) }} />
            <span
              className={`text-xs font-medium uppercase tracking-wide ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}
            >
              {node.type}
            </span>
          </div>
          <h4 className={`text-lg font-semibold ${isDarkMode ? "text-white" : "text-gray-900"}`}>{node.name}</h4>
        </div>
        <button
          onClick={onClose}
          className={`text-2xl leading-none ml-2 ${isDarkMode ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-600"}`}
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        {/* Render data-driven fields */}
        {fields.map((field) => (
          <div key={field.label} className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
            <span className="font-medium">{field.label}:</span>{" "}
            {field.value.length > 100 ? <p className="mt-1 whitespace-pre-wrap">{field.value}</p> : field.value}
          </div>
        ))}

        {showCode ? (
          <div className="text-sm">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>Code:</span>
              {lineRange && (
                <span className={`text-xs ${isDarkMode ? "text-gray-500" : "text-gray-500"}`}>{lineRange}</span>
              )}
            </div>
            <div className="mt-1 rounded overflow-hidden text-xs">
              <SyntaxHighlighter
                language={getLanguageFromFile(file)}
                style={isDarkMode ? vscDarkPlus : vs}
                customStyle={{
                  margin: 0,
                  padding: "12px",
                  fontSize: "11px",
                  maxHeight: "300px",
                }}
                showLineNumbers={lineStart !== undefined}
                startingLineNumber={lineStart || 1}
              >
                {body}
              </SyntaxHighlighter>
            </div>
          </div>
        ) : isHintNode && body ? (
          <div className="text-sm mt-3">
            <div className={`${isDarkMode ? "prose-invert" : ""}`}>
              <MarkdownRenderer size="compact">{body}</MarkdownRenderer>
            </div>
          </div>
        ) : body ? (
          <div className={`text-sm ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
            <span className="font-medium">Body:</span>
            <p className="mt-1 whitespace-pre-wrap">{body}</p>
          </div>
        ) : null}

        {tokenCount && (
          <div className={`text-xs ${isDarkMode ? "text-gray-500" : "text-gray-500"}`}>Token count: {tokenCount}</div>
        )}

        {connectedNodes.length > 0 && (
          <div className={`mt-4 pt-3 ${isDarkMode ? "border-gray-700" : "border-gray-200"} border-t`}>
            <h5 className={`text-sm font-medium mb-2 ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
              Connected Nodes ({connectedNodes.length})
            </h5>
            <div className="space-y-1">
              {connectedNodes.slice(0, 5).map((connectedNode) => (
                <button
                  key={connectedNode.id}
                  onClick={() => onNodeClick?.(connectedNode)}
                  className={`flex items-center gap-2 text-sm w-full text-left px-2 py-1 rounded transition-colors ${isDarkMode ? "hover:bg-gray-700/50" : "hover:bg-gray-100"
                    }`}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getNodeColor(connectedNode.type, nodeTypes) }}
                  />
                  <span className={`truncate ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
                    {connectedNode.name || connectedNode.uuid || connectedNode.id}
                  </span>
                </button>
              ))}
              {connectedNodes.length > 5 && (
                <div className={`text-xs px-2 ${isDarkMode ? "text-gray-500" : "text-gray-500"}`}>
                  ... and {connectedNodes.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- MAIN COMPONENT ---
export const GraphComponent = () => {
  const { id: workspaceId, workspace } = useWorkspace();
  const [nodes, setNodes] = useState<D3Node[]>([]);
  const [links, setLinks] = useState<D3Link[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const resetData = useDataStore((s) => s.resetData);

  const isDarkMode = true; // Always dark mode
  const nodeTypes = Array.from(new Set(nodes.map((n) => n.type)));


  useEffect(() => {
    const fetchSchema = async () => {
      const response = await fetch(`/api/swarm/stakgraph/schema?id=${workspaceId}`);
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
        const response = await fetch(`/api/swarm/stakgraph/nodes?id=${workspaceId}`);
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
            edges: (data.data.edges || []).map(edge => ({
              ...edge,
              ref_id: typeof edge.source === 'string' ? edge.source : (edge.source as any)?.ref_id || '',
              edge_type: (edge as any).edge_type || 'default'
            }))
          })


          setNodes(
            data.data.nodes.map((node) => ({
              ...node,
              id: (node as any).ref_id || "",
              type: ((node as any).node_type as string) || "",
              name: ((node as any)?.properties?.name as string) || "",
            })) as D3Node[],
          );
          setLinks((data.data.edges as D3Link[]) || []);
        } else {
          setNodes([]);
          setLinks([]);
        }
      } catch (err) {
        console.error("Failed to load nodes:", err);
        setNodes([]);
        setLinks([]);
      } finally {
        setNodesLoading(false);
      }
    };
    fetchNodes();
  }, [workspaceId]);

  // connected nodes for popup
  const connectedNodes = selectedNode
    ? (Array.from(getConnectedNodeIds(selectedNode.id, links))
      .map((id) => nodes.find((node) => node.id === id))
      .filter(Boolean) as D3Node[])
    : [];



  return (
    <div className="dark h-auto w-full border rounded-lg p-4 relative bg-card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Graph Visualization</h3>
        <div className="flex items-center gap-2">
          {nodes.length > 0 && (
            <div className="text-sm text-gray-400">
              {nodes.length} nodes • {links.length} connections
            </div>
          )}
        </div>
      </div>

      <div className="border rounded overflow-hidden bg-card">
        {nodesLoading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-300">Loading...</div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-300">
              No data found
            </div>
          </div>
        ) : (
          <Universe />
        )}
      </div>

      {
        selectedNode && (
          <NodePopup
            node={selectedNode}
            onClose={() => {
              setSelectedNode(null);
            }}
            connectedNodes={connectedNodes}
            isDarkMode={isDarkMode}
            nodeTypes={nodeTypes}
            onNodeClick={(clickedNode) => {
              setSelectedNode(clickedNode);
            }}
          />
        )
      }
    </div >
  );
};
