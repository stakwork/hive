"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getLayoutedElements } from "./layouts/dagre";
import type { DependencyGraphProps, GraphEntity } from "./types";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

// Account for actual rendered size including padding, borders, and shadows
// The RoadmapTaskNode has min-w-[250px] but renders larger with content
const DEFAULT_NODE_WIDTH = 300;
const DEFAULT_NODE_HEIGHT = 100;

/**
 * Watches React Flow's internal container dimensions and fires fitView exactly
 * once each time the container transitions from hidden (0×0) to visible (non-zero).
 * This correctly handles the case where the graph is mounted inside a hidden
 * Radix UI tab (display: none → 0×0) and only becomes visible later.
 */
function FitWhenVisible() {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const wasHidden = useRef(true);

  useEffect(() => {
    const isVisible = width > 0 && height > 0;
    if (isVisible && wasHidden.current) {
      wasHidden.current = false;
      setTimeout(() => fitView({ padding: 0.1, duration: 200 }), 50);
    } else if (!isVisible) {
      wasHidden.current = true; // reset so re-opening re-fits
    }
  }, [width, height, fitView]);

  return null;
}

/**
 * Inner graph component. Kept separate so it can safely use `useReactFlow`
 * (which requires a ReactFlowProvider ancestor).
 *
 * The critical pattern here is that `nodeTypes` is derived from a stable ref
 * (`renderNodeRef`) rather than from a freshly-created callback. This prevents
 * React Flow from remounting nodes on every render, which would tear down
 * edge handle connections and make edges invisible.
 */
function GraphInner<T extends GraphEntity>({
  entities,
  getDependencies,
  renderNode,
  onNodeClick,
  direction = "LR",
}: Pick<
  DependencyGraphProps<T>,
  "entities" | "getDependencies" | "renderNode" | "onNodeClick" | "direction"
>) {
  // Keep the latest renderNode in a ref so the node component (defined below)
  // always calls the current version without ever needing to be recreated.
  const renderNodeRef = useRef(renderNode);
  useEffect(() => {
    renderNodeRef.current = renderNode;
  }, [renderNode]);

  // nodeTypes must be a stable object — defined once per mount.
  // Using renderNodeRef.current inside means the node always renders fresh
  // data without the nodeTypes object itself ever changing.
  const nodeTypes = useMemo(
    () => ({
      customNode: ({ data }: { data: T }) => <>{renderNodeRef.current(data)}</>,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // intentionally empty — we want this created ONCE
  );

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
      ranksep: 200,
      nodesep: 150,
    });
  }, [entities, getDependencies, direction]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-sync nodes/edges whenever entities change (status colors, new/deleted tasks, deps)
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
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
      <FitWhenVisible />
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
  );
}

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
  className,
}: DependencyGraphProps<T>) {
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
    <ReactFlowProvider>
      <div className={cn("h-[600px] w-full border rounded-lg bg-gray-50 dark:bg-gray-950 relative", className)}>
        <GraphInner
          entities={entities}
          getDependencies={getDependencies}
          renderNode={renderNode}
          onNodeClick={onNodeClick}
          direction={direction}
        />
      </div>
    </ReactFlowProvider>
  );
}
