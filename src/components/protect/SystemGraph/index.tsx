"use client";

import React, { useEffect, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import type { ProtectEndpoint } from "@/types/protect";

const NODE_WIDTH = 190;
const NODE_HEIGHT = 64;
const LABEL_WIDTH = 96;
const LABEL_HEIGHT = 28;
const MIN_STROKE = 2;
const MAX_STROKE = 6;

// One hue per system, assigned in sorted order so colours are stable across reloads.
const PALETTE = [
  "#3b82f6", // blue
  "#a855f7", // purple
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#f97316", // orange
  "#84cc16", // lime
  "#ec4899", // pink
];

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
  color: string;
  endpointCount: number;
  internalCalls: number;
  selected: boolean;
  dimmed: boolean;
}

interface PairCounts {
  caller: string;
  callee: string;
  endpoints: number;
  callSites: number;
}

interface PairStats extends PairCounts, Record<string, unknown> {
  maxEndpoints: number;
  color: string;
  selected: boolean;
  dimmed: boolean;
  /** Label anchor from dagre, in flow coordinates. */
  labelX: number;
  labelY: number;
}

type SystemNodeType = Node<SystemNodeData, "system">;
type PairEdgeType = Edge<PairStats, "pair">;

/** `stakwork/hive` -> `hive`; the full id stays available as a tooltip. */
function shortSystem(system: string): string {
  const slash = system.lastIndexOf("/");
  return slash === -1 ? system : system.slice(slash + 1);
}

function pairKey(caller: string, callee: string): string {
  return `${caller}→${callee}`;
}

function SystemNode({ data }: NodeProps<SystemNodeType>) {
  return (
    <div
      className={cn(
        "flex h-full items-stretch overflow-hidden rounded-xl border bg-card shadow-md transition-all",
        data.selected ? "border-foreground/60 shadow-lg" : "border-border/60",
        data.dimmed && "opacity-40",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={data.system}
      data-testid={`system-node-${data.system}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <div className="w-1.5 shrink-0" style={{ backgroundColor: data.color }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3">
        <div className="truncate text-sm font-semibold tracking-tight">{data.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {data.endpointCount} {data.endpointCount === 1 ? "endpoint" : "endpoints"}
          {data.internalCalls > 0 && ` · ${data.internalCalls} internal`}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />
    </div>
  );
}

function PairEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<PairEdgeType>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 24,
  });
  if (!data) return null;
  const maxRatio = Math.min(1, data.endpoints / Math.max(1, data.maxEndpoints));
  const strokeWidth = MIN_STROKE + (MAX_STROKE - MIN_STROKE) * maxRatio;
  const opacity = data.dimmed ? 0.18 : data.selected ? 1 : 0.75;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: data.color, strokeWidth, opacity, transition: "opacity 150ms" }}
        interactionWidth={16}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            "nodrag nopan pointer-events-auto absolute select-none rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-sm transition-opacity",
            data.selected ? "bg-foreground text-background" : "bg-card text-foreground",
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)`,
            borderColor: data.color,
            opacity: data.dimmed ? 0.3 : 1,
          }}
          title={`${shortSystem(data.caller)} → ${shortSystem(data.callee)}: ${data.endpoints} endpoints, ${data.callSites} call sites`}
        >
          {data.endpoints} {data.endpoints === 1 ? "endpoint" : "endpoints"}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { system: SystemNode };
const edgeTypes = { pair: PairEdge };

function buildGraph(endpoints: ProtectEndpoint[], selection: SystemGraphSelection) {
  const owned = new Map<string, number>();
  const internal = new Map<string, number>();
  const pairs = new Map<string, PairCounts>();

  for (const endpoint of endpoints) {
    owned.set(endpoint.system, (owned.get(endpoint.system) ?? 0) + 1);
    for (const caller of endpoint.callers) {
      if (caller.system === endpoint.system) {
        internal.set(endpoint.system, (internal.get(endpoint.system) ?? 0) + 1);
        continue;
      }
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

  const systems = Array.from(owned.keys()).sort();
  const colorOf = new Map(systems.map((system, i) => [system, PALETTE[i % PALETTE.length]]));
  const maxEndpoints = Math.max(1, ...Array.from(pairs.values(), (pair) => pair.endpoints));
  const hasSelection = selection.system !== null || selection.caller !== null;

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 150, nodesep: 56, edgesep: 24, ranker: "network-simplex" });
  systems.forEach((system) => graph.setNode(system, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  for (const pair of pairs.values()) {
    // Reserving label space lets dagre route edges so pills don't overlap.
    graph.setEdge(pair.caller, pair.callee, {
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT,
      labelpos: "c",
      weight: pair.endpoints,
    });
  }
  dagre.layout(graph);

  const nodes: SystemNodeType[] = systems.map((system) => {
    const { x, y } = graph.node(system);
    const selected = selection.system === system && selection.caller === null;
    const involved =
      selection.system === system ||
      selection.caller === system ||
      (selection.caller === null && selection.system !== null &&
        pairs.has(pairKey(system, selection.system)));
    return {
      id: system,
      type: "system",
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      draggable: false,
      data: {
        label: shortSystem(system),
        system,
        color: colorOf.get(system) ?? PALETTE[0],
        endpointCount: owned.get(system) ?? 0,
        internalCalls: internal.get(system) ?? 0,
        selected,
        dimmed: hasSelection && !involved,
      },
    };
  });

  const edges: PairEdgeType[] = Array.from(pairs.values()).map((pair) => {
    const selected = selection.caller === pair.caller && selection.system === pair.callee;
    const involved =
      selected ||
      (selection.caller === null && selection.system === pair.callee) ||
      (selection.system === null && selection.caller === pair.caller);
    const label = graph.edge(pair.caller, pair.callee);
    return {
      id: pairKey(pair.caller, pair.callee),
      source: pair.caller,
      target: pair.callee,
      type: "pair",
      data: {
        ...pair,
        maxEndpoints,
        color: colorOf.get(pair.caller) ?? PALETTE[0],
        selected,
        dimmed: hasSelection && !involved,
        labelX: label?.x ?? 0,
        labelY: label?.y ?? 0,
      },
      markerEnd: `url(#system-arrow-${pair.caller.replace(/[^a-z0-9]/gi, "_")})`,
    };
  });

  return { nodes, edges, colors: Array.from(colorOf.entries()) };
}

/** Fixed-size arrowheads, one per caller colour, unaffected by stroke width. */
function ArrowDefs({ colors }: { colors: Array<[string, string]> }) {
  return (
    <svg className="absolute h-0 w-0">
      <defs>
        {colors.map(([system, color]) => (
          <marker
            key={system}
            id={`system-arrow-${system.replace(/[^a-z0-9]/gi, "_")}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="10"
            markerHeight="10"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const fit = () => fitView({ padding: 0.15, duration: 200 });
    const timer = setTimeout(fit, 50);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", fit);
    };
  }, [signature, fitView]);
  return null;
}

function SystemGraphInner({ endpoints, selection, onSelect }: SystemGraphProps) {
  const { nodes, edges, colors } = useMemo(
    () => buildGraph(endpoints, selection),
    [endpoints, selection],
  );
  const signature = useMemo(() => nodes.map((node) => node.id).join("|"), [nodes]);

  return (
    <>
      <ArrowDefs colors={colors} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
        minZoom={0.3}
        maxZoom={1.5}
        onNodeClick={(_event, node) => {
          const system = node.id;
          const alreadySelected = selection.system === system && selection.caller === null;
          onSelect(alreadySelected ? { system: null, caller: null } : { system, caller: null });
        }}
        onEdgeClick={(_event, edge) => {
          const pair = (edge as PairEdgeType).data;
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
      </ReactFlow>
    </>
  );
}

/**
 * Systems as nodes, one edge per caller -> callee pair, weighted by how many
 * endpoints the caller hits. Self-calls are folded into the node as
 * "internal". Clicking an edge or node narrows `selection`, which the
 * endpoint table uses as its filter.
 */
export function SystemGraph({ className, ...props }: SystemGraphProps) {
  return (
    <div
      className={cn("relative h-[380px] w-full overflow-hidden rounded-lg bg-muted/30", className)}
      data-testid="protect-system-graph"
    >
      <ReactFlowProvider>
        <SystemGraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
