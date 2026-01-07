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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

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

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

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
      <Empty className="h-[500px]">
        <EmptyHeader>
          <EmptyDescription>{emptyStateMessage}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const hasDependencies = entities.some(
    (entity) => getDependencies(entity).length > 0
  );

  if (!hasDependencies) {
    return (
      <Empty className="h-[500px]">
        <EmptyHeader>
          <EmptyTitle>{noDependenciesMessage.title}</EmptyTitle>
          <EmptyDescription>{noDependenciesMessage.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
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
  );
}
