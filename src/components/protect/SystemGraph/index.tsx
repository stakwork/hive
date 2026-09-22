"use client";

import React, { useEffect, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import type { ProtectEndpoint } from "@/types/protect";

const NODE_WIDTH = 176;
const NODE_HEIGHT = 56;
const MIN_STROKE = 1.5;
const MAX_STROKE = 8;

export interface SystemGraphSelection {
  /** Owning system of the endpoints shown, or null for all. */
  system: string | null;
  /** Calling system, or null for any. */
  caller: string | null;
}

interface SystemGraphProps {
  endpoints: ProtectEndpoint[];
  selection: SystemGraphSelection;
  onSelect: (selection: SystemGraphSelection) => void;
  className?: string;
}

interface SystemNodeData extends Record<string, unknown> {
  label: string;
  system: string;
  endpointCount: number;
  selected: boolean;
}

interface PairStats extends Record<string, unknown> {
  caller: string;
  callee: string;
  endpoints: number;
  callSites: number;
}

type PairEdge = Edge<PairStats>;

/** `stakwork/hive` -> `hive`; the full id stays available as a tooltip. */
function shortSystem(system: string): string {
  const slash = system.lastIndexOf("/");
  return slash === -1 ? system : system.slice(slash + 1);
}

function pairKey(caller: string, callee: string): string {
  return `${caller}→${callee}`;
}

function SystemNode({ data }: NodeProps<Node<SystemNodeData>>) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
        data.selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={data.system}
      data-testid={`system-node-${data.system}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="truncate font-mono text-sm font-medium">{data.label}</div>
      <div className="text-xs text-muted-foreground">
        {data.endpointCount} {data.endpointCount === 1 ? "endpoint" : "endpoints"}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { system: SystemNode };

function layout<N extends Node>(nodes: N[], edges: Edge[]): N[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 140, nodesep: 40 });
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } };
  });
}

function buildGraph(endpoints: ProtectEndpoint[], selection: SystemGraphSelection) {
  const owned = new Map<string, number>();
  const pairs = new Map<string, PairStats>();

  for (const endpoint of endpoints) {
    owned.set(endpoint.system, (owned.get(endpoint.system) ?? 0) + 1);
    for (const caller of endpoint.callers) {
      if (!owned.has(caller.system)) owned.set(caller.system, 0);
      const key = pairKey(caller.system, endpoint.system);
      const stats = pairs.get(key) ?? {
        caller: caller.system,
        callee: endpoint.system,
        endpoints: 0,
        callSites: 0,
      };
      stats.endpoints += 1;
      stats.callSites += caller.callSites;
      pairs.set(key, stats);
    }
  }

  const maxEndpoints = Math.max(1, ...Array.from(pairs.values(), (pair) => pair.endpoints));

  const nodes: Node<SystemNodeData>[] = Array.from(owned.entries()).map(([system, count]) => ({
    id: system,
    type: "system",
    position: { x: 0, y: 0 },
    draggable: false,
    data: {
      label: shortSystem(system),
      system,
      endpointCount: count,
      selected: selection.system === system && selection.caller === null,
    },
  }));

  const edges: PairEdge[] = Array.from(pairs.values()).map((pair) => {
    const selected = selection.caller === pair.caller && selection.system === pair.callee;
    const dimmed =
      !selected && (selection.caller !== null || selection.system !== null) &&
      selection.system !== pair.callee && selection.system !== pair.caller;
    const width = MIN_STROKE + ((MAX_STROKE - MIN_STROKE) * pair.endpoints) / maxEndpoints;
    return {
      id: pairKey(pair.caller, pair.callee),
      source: pair.caller,
      target: pair.callee,
      type: "default",
      label: `${pair.endpoints} ${pair.endpoints === 1 ? "endpoint" : "endpoints"}`,
      labelStyle: { fontSize: 11, fill: "var(--muted-foreground)" },
      labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      data: pair,
      style: {
        strokeWidth: width,
        stroke: selected ? "var(--primary)" : "var(--muted-foreground)",
        opacity: dimmed ? 0.25 : selected ? 1 : 0.7,
        cursor: "pointer",
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    };
  });

  return { nodes: layout(nodes, edges), edges };
}

function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
    return () => clearTimeout(timer);
  }, [signature, fitView]);
  return null;
}

function SystemGraphInner({ endpoints, selection, onSelect }: SystemGraphProps) {
  const { nodes, edges } = useMemo(() => buildGraph(endpoints, selection), [endpoints, selection]);
  const signature = useMemo(() => nodes.map((node) => node.id).join("|"), [nodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.3}
      maxZoom={1.5}
      onNodeClick={(_event, node) => {
        const system = node.id;
        const alreadySelected = selection.system === system && selection.caller === null;
        onSelect(alreadySelected ? { system: null, caller: null } : { system, caller: null });
      }}
      onEdgeClick={(_event, edge) => {
        const pair = (edge as PairEdge).data;
        if (!pair) return;
        const alreadySelected =
          selection.caller === pair.caller && selection.system === pair.callee;
        onSelect(
          alreadySelected
            ? { system: null, caller: null }
            : { system: pair.callee, caller: pair.caller },
        );
      }}
      onPaneClick={() => onSelect({ system: null, caller: null })}
      proOptions={{ hideAttribution: true }}
    >
      <FitOnChange signature={signature} />
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showZoom showFitView showInteractive={false} />
    </ReactFlow>
  );
}

/**
 * Systems as nodes, one edge per caller -> callee pair, weighted by how many
 * endpoints the caller hits. Clicking an edge or node narrows `selection`,
 * which the endpoint table uses as its filter.
 */
export function SystemGraph({ className, ...props }: SystemGraphProps) {
  return (
    <div className={cn("h-[360px] w-full", className)} data-testid="protect-system-graph">
      <ReactFlowProvider>
        <SystemGraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
