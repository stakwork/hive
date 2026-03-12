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
 * Fires fitView whenever `open` transitions to true (i.e. the collapsible
 * finishes its open animation and the container has real dimensions).
 * A small delay lets the CSS transition complete before we measure.
 */
function FitViewOnOpen({ open }: { open: boolean }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!open) return;
    // Fire twice: once at 200ms (catches fast renders) and once at 500ms
    // (catches slow collapsible animations where the container was still height:0 at first fire)
    const id1 = setTimeout(() => fitView({ padding: 0.3, duration: 200 }), 200);
    const id2 = setTimeout(() => fitView({ padding: 0.3, duration: 200 }), 500);
    return () => { clearTimeout(id1); clearTimeout(id2); };
  }, [open, fitView]);
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
  open = true,
}: Pick<
  DependencyGraphProps<T>,
  "entities" | "getDependencies" | "renderNode" | "onNodeClick" | "direction" | "open"
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
      fitView
      fitViewOptions={{ padding: 0.3 }}
    >
      <FitViewOnOpen open={open} />
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
  open = true,
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
          open={open}
        />
      </div>
    </ReactFlowProvider>
  );
}
