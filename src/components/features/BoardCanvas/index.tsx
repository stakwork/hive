"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { getLayoutedElements } from "@/components/features/DependencyGraph/layouts/dagre";
import { RoadmapTaskNode } from "@/components/features/DependencyGraph/nodes";
import { FeatureGroupNode, FeatureGroupNodeData } from "./FeatureGroupNode";
import type { BoardFeature } from "@/types/roadmap";
import type { TicketListItem } from "@/types/roadmap";

// Layout constants
export const TASK_NODE_WIDTH = 300;
export const TASK_NODE_HEIGHT = 100;
export const HEADER_HEIGHT = 48;
export const GROUP_PADDING = 20;
export const MIN_GROUP_WIDTH = 340;
const GROUP_GAP = 60; // horizontal gap between feature columns

interface BoardCanvasProps {
  features: BoardFeature[];
  slug: string;
}

interface TaskNodeData extends TicketListItem, Record<string, unknown> {
  onNavigate: (taskId: string) => void;
}

export function buildNodesAndEdges(
  features: BoardFeature[],
  slug: string,
  onNavigateTask: (taskId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];

  let currentX = 0;

  for (const feature of features) {
    const featureTaskIds = new Set(feature.tasks.map((t) => t.id));

    // Build internal edges (within-feature task deps only — cross-feature doesn't exist yet)
    const internalEdges: Edge[] = [];
    feature.tasks.forEach((task) => {
      task.dependsOnTaskIds.forEach((depId) => {
        if (!featureTaskIds.has(depId)) return; // skip stale/cross-feature refs
        const edgeId = `${depId}-${task.id}`;
        const edge: Edge = {
          id: edgeId,
          source: depId,
          target: task.id,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#3b82f6", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
          },
        };
        internalEdges.push(edge);
        allEdges.push(edge);
      });
    });

    // Layout tasks with Dagre TB so dep arrows flow top → bottom
    let groupWidth = MIN_GROUP_WIDTH;
    let groupHeight = HEADER_HEIGHT + 60; // minimum for empty group
    const childNodes: Node[] = [];

    if (feature.tasks.length > 0) {
      const rawTaskNodes: Node[] = feature.tasks.map((t) => ({
        id: t.id,
        type: "taskNode",
        data: { ...t, onNavigate: onNavigateTask } as TaskNodeData,
        position: { x: 0, y: 0 },
      }));

      const { nodes: dagreTaskNodes } = getLayoutedElements(
        rawTaskNodes,
        internalEdges,
        {
          nodeWidth: TASK_NODE_WIDTH,
          nodeHeight: TASK_NODE_HEIGHT,
          direction: "TB",
          ranksep: 60,
          nodesep: 40,
        },
      );

      // Compute bounding box of laid-out task nodes
      let maxRight = 0;
      let maxBottom = 0;
      dagreTaskNodes.forEach((n) => {
        maxRight = Math.max(maxRight, n.position.x + TASK_NODE_WIDTH);
        maxBottom = Math.max(maxBottom, n.position.y + TASK_NODE_HEIGHT);
      });

      groupWidth = Math.max(maxRight + GROUP_PADDING * 2, MIN_GROUP_WIDTH);
      groupHeight = HEADER_HEIGHT + maxBottom + GROUP_PADDING * 2;

      // Center task layout horizontally within the group
      const centerOffsetX = Math.max(
        (groupWidth - GROUP_PADDING * 2 - maxRight) / 2,
        0,
      );

      dagreTaskNodes.forEach((n) => {
        childNodes.push({
          ...n,
          parentId: feature.id,
          extent: "parent" as const,
          draggable: false,
          position: {
            x: n.position.x + GROUP_PADDING + centerOffsetX,
            y: n.position.y + HEADER_HEIGHT + GROUP_PADDING,
          },
        });
      });
    }

    // Feature group node — positioned in a horizontal row
    allNodes.push({
      id: feature.id,
      type: "featureGroup",
      data: {
        featureId: feature.id,
        title: feature.title,
        status: feature.status,
        taskCount: feature.tasks.length,
        slug,
      } as FeatureGroupNodeData,
      position: { x: currentX, y: 0 },
      style: { width: groupWidth, height: groupHeight },
    });

    allNodes.push(...childNodes);
    currentX += groupWidth + GROUP_GAP;
  }

  return { nodes: allNodes, edges: allEdges };
}

interface BoardInnerProps {
  features: BoardFeature[];
  slug: string;
}

function BoardInner({ features, slug }: BoardInnerProps) {
  const router = useRouter();
  const { fitView } = useReactFlow();

  const onNavigateTask = useCallback(
    (taskId: string) => {
      router.push(`/w/${slug}/task/${taskId}`);
    },
    [router, slug],
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(features, slug, onNavigateTask),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, slug],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Recompute when features/filter change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(
      features,
      slug,
      onNavigateTask,
    );
    setNodes(newNodes);
    setEdges(newEdges);
    setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, slug]);

  const onNavigateTaskRef = useRef(onNavigateTask);
  useEffect(() => {
    onNavigateTaskRef.current = onNavigateTask;
  }, [onNavigateTask]);

  const nodeTypes = useMemo(
    () => ({
      featureGroup: ({ data }: { data: FeatureGroupNodeData }) => (
        <FeatureGroupNode data={data} />
      ),
      taskNode: ({ data }: { data: TaskNodeData }) => (
        <RoadmapTaskNode data={data} direction="TB" />
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "taskNode") {
        onNavigateTaskRef.current(node.id);
      }
      // Feature group header clicks handled inside FeatureGroupNode
    },
    [],
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
        style: { strokeWidth: 2, stroke: "#3b82f6" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      }}
      proOptions={{ hideAttribution: true }}
      fitView
      fitViewOptions={{ padding: 0.3 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#94a3b8" />
      <Controls showZoom showFitView showInteractive={false} />
    </ReactFlow>
  );
}

export function BoardCanvas({ features, slug }: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <div
        className="h-full w-full border rounded-lg bg-gray-50 dark:bg-gray-950 relative"
        data-testid="board-canvas"
      >
        <BoardInner features={features} slug={slug} />
      </div>
    </ReactFlowProvider>
  );
}
