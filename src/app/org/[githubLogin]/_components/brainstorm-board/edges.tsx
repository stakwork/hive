"use client";

import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { inkPath } from "./rough";

export const RED = "#c8452c";
const BROWN = "#8a6a43";
const INK = "#2f2b26";
const SLATE = "#4b5f73";

export interface BoardEdgeData extends Record<string, unknown> {
  kind: "chosen" | "ghost" | "built" | "normal";
  /** The source node was written by a person. */
  fromPerson: boolean;
  /** An unchosen option's edge: quieter. */
  dim?: boolean;
}

function colour(d: BoardEdgeData) {
  if (d.kind === "chosen") return RED;
  if (d.kind === "built") return BROWN;
  return d.fromPerson ? INK : SLATE;
}

/** From a person's node: a rough double ink stroke, jitter seeded by the edge id. */
export function InkEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<BoardEdgeData>>) {
  const d = data ?? { kind: "normal", fromPerson: true };
  const c = colour(d);
  const ghost = d.kind === "ghost";
  const opacity = ghost ? 0.4 : d.dim ? 0.55 : 1;
  const dash = ghost ? "6 6" : undefined;
  return (
    <g opacity={opacity} data-edge-kind={d.kind}>
      <path d={inkPath(`${id}a`, sourceX, sourceY, targetX, targetY)} fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={dash} />
      <path d={inkPath(`${id}b`, sourceX, sourceY, targetX, targetY, 2.6)} fill="none" stroke={c} strokeWidth={1.1} strokeLinecap="round" strokeDasharray={dash} opacity={0.7} />
    </g>
  );
}

/** From an agent's node: a crisp curve ending in a dot. */
export function AgentEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<BoardEdgeData>>) {
  const d = data ?? { kind: "normal", fromPerson: false };
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const c = colour(d);
  const ghost = d.kind === "ghost";
  return (
    <g opacity={ghost ? 0.4 : d.dim ? 0.55 : 1} data-edge-kind={d.kind}>
      <BaseEdge id={id} path={path} style={{ stroke: c, strokeWidth: 1.6, strokeDasharray: ghost ? "6 6" : undefined }} />
      <circle cx={targetX} cy={targetY} r={4} fill={c} />
    </g>
  );
}

export const edgeTypes = { ink: InkEdge, agent: AgentEdge };
