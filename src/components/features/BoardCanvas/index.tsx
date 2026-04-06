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
export const TASK_NODE_HEIGHT = 110;
export const HEADER_HEIGHT = 48;
export const GROUP_PADDING = 20;
export const MIN_GROUP_WIDTH = 320;

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
  // Build a set of all valid task IDs (for filtering stale deps)
  const allTaskIds = new Set<string>();
  features.forEach((f) => f.tasks.forEach((t) => allTaskIds.add(t.id)));

  // Compute group heights
  const getGroupHeight = (taskCount: number) =>
    taskCount === 0
      ? HEADER_HEIGHT + 60
      : HEADER_HEIGHT + GROUP_PADDING * 2 + taskCount * TASK_NODE_HEIGHT;

  // Build feature group nodes (for dagre layout)
  const groupNodes: Node<FeatureGroupNodeData>[] = features.map((feature) => ({
    id: feature.id,
    type: "featureGroup",
    data: {
      featureId: feature.id,
      title: feature.title,
      status: feature.status,
      taskCount: feature.tasks.length,
      slug,
    },
    position: { x: 0, y: 0 },
    style: {
      width: MIN_GROUP_WIDTH,
      height: getGroupHeight(feature.tasks.length),
    },
  }));

  // Build edges from dependsOnTaskIds (only valid cross-set deps)
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();

  features.forEach((feature) => {
    feature.tasks.forEach((task) => {
      task.dependsOnTaskIds.forEach((depId) => {
        // Filter out stale references
        if (!allTaskIds.has(depId) || !allTaskIds.has(task.id)) return;
        const edgeId = `${depId}-${task.id}`;
        if (seenEdges.has(edgeId)) return;
        seenEdges.add(edgeId);
        edges.push({
          id: edgeId,
          source: depId,
          target: task.id,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#3b82f6", strokeWidth: 3 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        });
      });
    });
  });

  // Layout group nodes with dagre (LR, using cross-feature edges for spacing)
  // We build proxy edges between feature groups based on task deps so dagre spaces them well
  const proxyEdges: Edge[] = [];
  edges.forEach((edge) => {
    // Find which feature each task belongs to
    let sourceFeatureId: string | undefined;
    let targetFeatureId: string | undefined;
    features.forEach((f) => {
      f.tasks.forEach((t) => {
        if (t.id === edge.source) sourceFeatureId = f.id;
        if (t.id === edge.target) targetFeatureId = f.id;
      });
    });
    if (
      sourceFeatureId &&
      targetFeatureId &&
      sourceFeatureId !== targetFeatureId
    ) {
      const proxyId = `proxy-${sourceFeatureId}-${targetFeatureId}`;
      if (!proxyEdges.find((e) => e.id === proxyId)) {
        proxyEdges.push({
          id: proxyId,
          source: sourceFeatureId,
          target: targetFeatureId,
        });
      }
    }
  });

  const { nodes: layoutedGroupNodes } = getLayoutedElements(
    groupNodes,
    proxyEdges,
    {
      nodeWidth: MIN_GROUP_WIDTH,
      nodeHeight: getGroupHeight(0), // use min height for rough layout
      direction: "LR",
      ranksep: 250,
      nodesep: 150,
    },
  );

  // Build final nodes: layouted group nodes + task child nodes
  const allNodes: Node[] = [...layoutedGroupNodes];

  features.forEach((feature) => {
    const groupNode = layoutedGroupNodes.find((n) => n.id === feature.id);
    if (!groupNode) return;

    feature.tasks.forEach((task, index) => {
      allNodes.push({
        id: task.id,
        type: "taskNode",
        data: { ...task, onNavigate: onNavigateTask } as TaskNodeData,
        parentId: feature.id,
        extent: "parent",
        position: {
          x: GROUP_PADDING,
          y: HEADER_HEIGHT + GROUP_PADDING + index * TASK_NODE_HEIGHT,
        },
        draggable: false,
      });
    });
  });

  return { nodes: allNodes, edges };
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

  // Recompute when features change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(
      features,
      slug,
      onNavigateTask,
    );
    setNodes(newNodes);
    setEdges(newEdges);
    // fitView after state update settles
    setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, slug]);

  // Stable node types - use refs so they don't change on re-render
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
        <RoadmapTaskNode
          data={data}
          direction="LR"
        />
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Task nodes: navigate to task page
      if (node.type === "taskNode") {
        onNavigateTaskRef.current(node.id);
      }
      // Feature group node clicks handled inside FeatureGroupNode header
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
        style: { strokeWidth: 3, stroke: "#3b82f6" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
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
