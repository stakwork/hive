"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { select, zoom as d3Zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3";
import { Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RUN_GRAPH_NODE_RADIUS, type RunGraphLayout, type RunGraphPoint } from "@/lib/strut-run-graph/layout";
import { linkState, type RunGraphLink, type RunGraphLinkState } from "@/lib/strut-run-graph/walk";

export interface RunGraphCanvasNode {
  id: string;
  name: string;
  type: string;
}

interface RunGraphCanvasProps {
  layout: RunGraphLayout;
  nodes: RunGraphCanvasNode[];
  links: RunGraphLink[];
  colorMap: Record<string, string>;
  /** Nodes no call has touched yet at this step of the replay. */
  hiddenIds: ReadonlySet<string>;
  /** Nodes drawn with a ring: the step's own, and the selection. */
  activeIds: ReadonlySet<string>;
  /** The replay's step; null = the whole run. */
  step: number | null;
  /** Width at the right of the canvas that something else is drawn over. */
  insetRight?: number;
  onNodeClick: (id: string) => void;
}

const FIT_PADDING = 32;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
/** Below this zoom only the emphasised nodes are named: the rest would be a smear. */
const NAMES_FROM_ZOOM = 0.8;
const MAX_NAME_CHARS = 24;
/** A step that touched more than this names none of them at a distance, for the same reason. */
const MAX_NAMED_ACTIVE = 12;

/** Gap between a node and the end of a link that points at it. */
const ARROW_GAP = 3;

// Text and arrowheads hold their size on screen while the graph zooms under
// them (`--k` is the zoom), up to a size that still fits where they sit.
const NAME_FONT = "clamp(11px, calc(11px / var(--k)), 26px)";
const LANE_FONT = "clamp(14px, calc(13px / var(--k)), 34px)";
const CELL_FONT = "clamp(11px, calc(11px / var(--k)), 20px)";
const ARROW_SCALE = "scale(calc(1 / max(var(--k), 0.25)))";

const LINK_CLASS: Record<Exclude<RunGraphLinkState, "hidden">, string> = {
  edge: "stroke-muted-foreground/70",
  walked: "stroke-sky-500",
  current: "stroke-sky-400",
};
/** An edge between two cells, under the hover that brings it out. */
const FAR_EDGE_OPACITY = 0.3;
const LINK_WIDTH: Record<Exclude<RunGraphLinkState, "hidden">, number> = { edge: 1.25, walked: 1.75, current: 2.75 };
const ARROW_CLASS: Record<"walked" | "current", string> = { walked: "fill-sky-500", current: "fill-sky-400" };

function clipName(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}…` : name;
}

interface DrawnLink {
  key: string;
  link: RunGraphLink;
  state: Exclude<RunGraphLinkState, "hidden">;
  from: RunGraphPoint;
  to: RunGraphPoint;
  /** Direction of the link, in degrees. */
  angle: number;
  /** Its two nodes sit in different cells. */
  far: boolean;
}

/**
 * A run's nodes where `layout` put them: the stages as lanes, a looping
 * stage's iterations as cells, the graph's edges and the run's hops between
 * the nodes. Pans and zooms; opens showing all of it.
 */
export function RunGraphCanvas({
  layout,
  nodes,
  links,
  colorMap,
  hiddenIds,
  activeIds,
  step,
  insetRight = 0,
  onNodeClick,
}: RunGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  /** The viewer has panned or zoomed: a run that grows no longer refits under them. */
  const movedRef = useRef(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .extent(() => [
        [0, 0],
        [sizeRef.current.width, sizeRef.current.height],
      ])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) movedRef.current = true;
        viewRef.current?.setAttribute("transform", event.transform.toString());
        svg.style.setProperty("--k", String(event.transform.k));
        svg.dataset.names = event.transform.k >= NAMES_FROM_ZOOM ? "all" : "emphasised";
      });
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      sizeRef.current = { width, height };
      setSize((prev) =>
        prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height },
      );
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior || !size || layout.width <= 0 || layout.height <= 0) return;
    // Too narrow to give the inset up: the graph is fitted under it.
    const width = size.width - (size.width > 3 * insetRight ? insetRight : 0);
    const k = Math.max(
      MIN_ZOOM,
      Math.min(1, width / (layout.width + 2 * FIT_PADDING), size.height / (layout.height + 2 * FIT_PADDING)),
    );
    const transform = zoomIdentity
      .translate(width / 2, size.height / 2)
      .scale(k)
      .translate(-layout.width / 2, -layout.height / 2);
    select(svg).call(behavior.transform, transform);
  }, [size, insetRight, layout.width, layout.height]);

  useEffect(() => {
    if (!movedRef.current) fit();
  }, [fit]);

  const refit = useCallback(() => {
    movedRef.current = false;
    fit();
  }, [fit]);

  const drawn = useMemo<DrawnLink[]>(() => {
    const list: DrawnLink[] = [];
    for (const link of links) {
      if (hiddenIds.has(link.source) || hiddenIds.has(link.target)) continue;
      const { state, hop } = linkState(link, step);
      if (state === "hidden") continue;
      const source = layout.positions.get(hop?.source ?? link.source);
      const target = layout.positions.get(hop?.target ?? link.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy);
      const reach = RUN_GRAPH_NODE_RADIUS + ARROW_GAP;
      if (length <= 2 * reach) continue;
      const ux = dx / length;
      const uy = dy / length;
      list.push({
        key: `${link.source}|${link.edgeType ?? ""}|${link.target}`,
        link,
        state,
        from: { x: source.x + ux * RUN_GRAPH_NODE_RADIUS, y: source.y + uy * RUN_GRAPH_NODE_RADIUS },
        to: { x: target.x - ux * reach, y: target.y - uy * reach },
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        far: source.cell !== target.cell,
      });
    }
    // The run's own path is drawn over the edges it did not take.
    const order: Record<DrawnLink["state"], number> = { edge: 0, walked: 1, current: 2 };
    return list.sort((a, b) => order[a.state] - order[b.state]);
  }, [links, hiddenIds, step, layout.positions]);

  const beside = useMemo(() => {
    if (!hoverId) return null;
    const ids = new Set([hoverId]);
    for (const { link } of drawn) {
      if (link.source === hoverId) ids.add(link.target);
      if (link.target === hoverId) ids.add(link.source);
    }
    return ids;
  }, [hoverId, drawn]);

  return (
    <div className="absolute inset-0">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        data-testid="run-graph-svg"
        data-names="emphasised"
      >
        <g ref={viewRef}>
          <g data-testid="run-graph-lanes">
            {layout.lanes.map((lane) => (
              <g key={lane.stage} data-testid="run-graph-lane" data-stage={lane.stage}>
                <title>
                  {lane.stage}: {lane.calls} calls, {lane.nodes} nodes
                </title>
                <rect
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  rx={16}
                  className="fill-muted/30 stroke-border"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={lane.x + 20}
                  y={lane.y + 40}
                  className="fill-foreground font-medium"
                  style={{ fontSize: LANE_FONT }}
                >
                  {lane.stage}
                </text>
                {lane.cells
                  .filter((cell) => cell.iteration !== null)
                  .map((cell) => (
                    <g key={cell.iteration} data-testid="run-graph-cell">
                      <rect
                        x={cell.x}
                        y={cell.y}
                        width={cell.width}
                        height={cell.height}
                        rx={10}
                        className="fill-card stroke-border"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={cell.x + 12}
                        y={cell.y + 22}
                        className="fill-muted-foreground font-mono"
                        style={{ fontSize: CELL_FONT }}
                      >
                        #{cell.iteration}
                      </text>
                    </g>
                  ))}
              </g>
            ))}
          </g>

          <g data-testid="run-graph-links" fill="none" strokeLinecap="round">
            {drawn.map(({ key, link, state, from, to, angle, far }) => {
              const hovered = link.source === hoverId || link.target === hoverId;
              const opacity = hoverId !== null ? (hovered ? 1 : 0.12) : far && state === "edge" ? FAR_EDGE_OPACITY : 1;
              return (
                <g
                  key={key}
                  data-testid="run-graph-link"
                  data-state={state}
                  opacity={opacity}
                  className="pointer-events-none"
                >
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={LINK_CLASS[state]}
                    strokeWidth={LINK_WIDTH[state]}
                    vectorEffect="non-scaling-stroke"
                  />
                  {state !== "edge" && (
                    <g transform={`translate(${to.x},${to.y}) rotate(${angle})`}>
                      <path
                        d="M2 0L-9 -4.5L-9 4.5Z"
                        className={ARROW_CLASS[state]}
                        stroke="none"
                        style={{ transform: ARROW_SCALE }}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          <g data-testid="run-graph-nodes">
            {nodes.map((node) => {
              const point = layout.positions.get(node.id);
              if (!point || hiddenIds.has(node.id)) return null;
              const active = activeIds.has(node.id);
              const emphasised = node.id === hoverId || (active && activeIds.size <= MAX_NAMED_ACTIVE);
              return (
                <g
                  key={node.id}
                  transform={`translate(${point.x},${point.y})`}
                  opacity={beside && !beside.has(node.id) ? 0.25 : 1}
                  className="cursor-pointer"
                  data-testid="run-graph-node"
                  data-active={active}
                  onClick={() => onNodeClick(node.id)}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId((id) => (id === node.id ? null : id))}
                >
                  <circle
                    r={RUN_GRAPH_NODE_RADIUS}
                    fill={colorMap[node.type] ?? "#6b7280"}
                    className={active ? "stroke-foreground" : "stroke-card"}
                    strokeWidth={active ? 3 : 1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    y={-(RUN_GRAPH_NODE_RADIUS + 6)}
                    textAnchor="middle"
                    className={`pointer-events-none fill-foreground stroke-card font-medium ${
                      emphasised ? "" : "[[data-names=emphasised]_&]:hidden"
                    }`}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                    style={{ fontSize: NAME_FONT }}
                  >
                    {clipName(node.name)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <Button
        variant="outline"
        size="icon"
        className="absolute right-3 top-3 h-7 w-7"
        aria-label="Show all of it"
        onClick={refit}
        data-testid="run-graph-fit"
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
