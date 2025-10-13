"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getLayoutedElements } from "./layouts/dagre";
import type { DependencyGraphProps, GraphEntity } from "./types";

const DEFAULT_NODE_WIDTH = 250;
const DEFAULT_NODE_HEIGHT = 80;

export function DependencyGraph<T extends GraphEntity>({
  entities,
  getDependencies,
  renderNode,
  onNodeClick,
  direction = "LR",
  emptyStateMessage = "No items to display",
  noDependenciesMessage = {
    title: "No Dependencies Yet",
    description: "Add dependencies to see them visualized here.",
  },
}: DependencyGraphProps<T>) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = entities.map((entity) => ({
      id: entity.id,
      type: "customNode",
      data: entity,
      position: { x: 0, y: 0 },
    }));

    const edges: Edge[] = [];
    entities.forEach((entity) => {
      const dependencies = getDependencies(entity);
      dependencies.forEach((depId) => {
        const depExists = entities.find((e) => e.id === depId);
        if (depExists) {
          edges.push({
            id: `${depId}-${entity.id}`,
            source: depId,
            target: entity.id,
            type: "smoothstep",
            animated: true,
            style: { stroke: "#3b82f6", strokeWidth: 3 },
            markerEnd: {
              type: "arrowclosed",
              width: 20,
              height: 20,
            },
          });
        }
      });
    });

    return getLayoutedElements(nodes, edges, {
      nodeWidth: DEFAULT_NODE_WIDTH,
      nodeHeight: DEFAULT_NODE_HEIGHT,
      direction,
      ranksep: 100,
      nodesep: 50,
    });
  }, [entities, getDependencies, direction]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick]
  );

  const CustomNode = useCallback(
    ({ data }: { data: T }) => <>{renderNode(data)}</>,
    [renderNode]
  );

  const nodeTypes = useMemo(
    () => ({
      customNode: CustomNode,
    }),
    [CustomNode]
  );

  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] text-muted-foreground">
        {emptyStateMessage}
      </div>
    );
  }

  const hasDependencies = entities.some(
    (entity) => getDependencies(entity).length > 0
  );

  if (!hasDependencies) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] text-center text-muted-foreground">
        <p className="text-lg font-medium mb-2">
          {noDependenciesMessage.title}
        </p>
        <p className="text-sm">{noDependenciesMessage.description}</p>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .react-flow__controls {
          display: flex !important;
          flex-direction: column !important;
          gap: 8px !important;
          box-shadow: none !important;
          border: none !important;
          background: transparent !important;
        }
        .react-flow__controls-button {
          background: white !important;
          border: 1px solid #d1d5db !important;
          border-radius: 6px !important;
          width: 32px !important;
          height: 32px !important;
          padding: 0 !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .react-flow__controls-button:hover {
          background: #f3f4f6 !important;
          border-color: #9ca3af !important;
        }
        .react-flow__controls-button svg {
          fill: #374151 !important;
          width: 16px !important;
          height: 16px !important;
        }
        @media (prefers-color-scheme: dark) {
          .react-flow__controls-button {
            background: #1f2937 !important;
            border-color: #4b5563 !important;
          }
          .react-flow__controls-button:hover {
            background: #374151 !important;
            border-color: #6b7280 !important;
          }
          .react-flow__controls-button svg {
            fill: #d1d5db !important;
          }
        }
      `}} />
      <div className="h-[600px] w-full border rounded-lg bg-gray-50 dark:bg-gray-950 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 3, stroke: "#3b82f6" },
          markerEnd: {
            type: "arrowclosed",
            width: 20,
            height: 20,
          },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <svg style={{ position: "absolute", width: 0, height: 0 }}>
          <defs>
            <marker
              id="arrowclosed"
              markerWidth="20"
              markerHeight="20"
              refX="10"
              refY="10"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <polygon
                points="0 0, 20 10, 0 20, 5 10"
                fill="#3b82f6"
                stroke="#3b82f6"
                strokeWidth="1"
              />
            </marker>
          </defs>
        </svg>
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="#94a3b8"
        />
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={false}
        />
      </ReactFlow>
      </div>
    </>
  );
}
