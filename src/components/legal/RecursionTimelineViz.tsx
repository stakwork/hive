"use client";

import React from "react";
import type { TimelineLayout, RunColumn } from "@/lib/harvey-lab/timeline-layout";

// ── Layout constants ──────────────────────────────────────────────────────────

const COLUMN_WIDTH = 280;
const LANE_Y = { trigger: 80, output: 200, fix: 340 };
const NODE_W = 200;
const NODE_H = 50;

/** X offset for column 0, leaving room for the EvalSet anchor box. */
const FIRST_COL_X = 320;
const EVALSET_X = 24;
const EVALSET_Y = 24;
const EVALSET_W = 180;
const EVALSET_H = 44;

const ARROW_MARKER_ID = "timeline-arrow";

// ── Color helpers ─────────────────────────────────────────────────────────────

function outputStroke(scorePct: number | null): string {
  if (scorePct === null) return "#6b7280"; // neutral gray
  if (scorePct >= 0.75) return "#16a34a";  // green
  if (scorePct >= 0.45) return "#d97706";  // amber
  return "#dc2626";                         // red
}

function outputFill(scorePct: number | null): string {
  if (scorePct === null) return "#f3f4f6";
  if (scorePct >= 0.75) return "#dcfce7";
  if (scorePct >= 0.45) return "#fef3c7";
  return "#fee2e2";
}

// ── Node helpers ──────────────────────────────────────────────────────────────

function colX(runIndex: number): number {
  return FIRST_COL_X + runIndex * COLUMN_WIDTH;
}

/** Center X of a node box at a given column. */
function nodeXCenter(runIndex: number): number {
  return colX(runIndex) + NODE_W / 2;
}

/** Left edge of a node box. */
function nodeXLeft(runIndex: number): number {
  return colX(runIndex);
}

/** Right edge of a node box. */
function nodeXRight(runIndex: number): number {
  return colX(runIndex) + NODE_W;
}

// ── SVG sub-components ────────────────────────────────────────────────────────

function NodeBox({
  x,
  y,
  w,
  h,
  label,
  sublabel,
  stroke,
  fill,
  dashed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sublabel?: string;
  stroke: string;
  fill: string;
  dashed?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x + w / 2}
        y={y + (sublabel ? h / 2 - 5 : h / 2 + 5)}
        textAnchor="middle"
        fontSize={11}
        fill={stroke === "#6b7280" ? "#374151" : "#111827"}
        fontFamily="ui-monospace, monospace"
        dominantBaseline="middle"
      >
        {label}
      </text>
      {sublabel && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 10}
          textAnchor="middle"
          fontSize={9}
          fill="#6b7280"
          fontFamily="ui-sans-serif, sans-serif"
          dominantBaseline="middle"
        >
          {sublabel}
        </text>
      )}
    </g>
  );
}

/** Cubic bezier connecting right edge of src to left edge of target. */
function BezierArrow({
  x1,
  y1,
  x2,
  y2,
  markerId,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  markerId: string;
}) {
  const cx1 = x1 + (x2 - x1) / 2;
  const cx2 = x1 + (x2 - x1) / 2;
  return (
    <path
      d={`M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
      fill="none"
      stroke="#94a3b8"
      strokeWidth={1.5}
      markerEnd={`url(#${markerId})`}
    />
  );
}

/** Straight vertical line. */
function VerticalLine({
  x,
  y1,
  y2,
}: {
  x: number;
  y1: number;
  y2: number;
}) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke="#94a3b8"
      strokeWidth={1}
      strokeDasharray="3 3"
    />
  );
}

// ── Column renderer ───────────────────────────────────────────────────────────

function RunColumnGroup({ col }: { col: RunColumn }) {
  const { runIndex, trigger, output, proposedFix, scorePct, scoreDelta } = col;
  const cx = nodeXCenter(runIndex);
  const lx = nodeXLeft(runIndex);

  const outputStrokeColor = outputStroke(scorePct);
  const outputFillColor = outputFill(scorePct);

  // Score delta label: suppress when col 0, delta is 0, or scorePct is null
  const showDelta =
    runIndex > 0 && scoreDelta !== null && scoreDelta !== 0 && scorePct !== null;
  const deltaText = showDelta
    ? scoreDelta! > 0
      ? `+${Math.round(scoreDelta! * 100)} pts`
      : `−${Math.round(Math.abs(scoreDelta!) * 100)} pts`
    : null;
  const deltaColor =
    showDelta && scoreDelta! > 0 ? "#16a34a" : "#dc2626";

  return (
    <g data-column={runIndex}>
      {/* Run badge */}
      <text
        x={cx}
        y={LANE_Y.trigger - 30}
        textAnchor="middle"
        fontSize={11}
        fontWeight="600"
        fill="#475569"
        fontFamily="ui-sans-serif, sans-serif"
      >
        Run {runIndex + 1}
      </text>

      {/* EvalTrigger node (baseline column only) */}
      {trigger && (
        <NodeBox
          x={lx}
          y={LANE_Y.trigger}
          w={NODE_W}
          h={NODE_H}
          label="EvalTrigger"
          sublabel={runIndex === 0 ? "baseline" : undefined}
          stroke="#3b82f6"
          fill="#eff6ff"
        />
      )}

      {/* ProposedFix node (columns 1+) */}
      {proposedFix && (
        <NodeBox
          x={lx}
          y={LANE_Y.fix}
          w={NODE_W}
          h={NODE_H}
          label="ProposedFix"
          stroke="#8b5cf6"
          fill="#f5f3ff"
        />
      )}

      {/* EvalTriggerOutput node */}
      {output && (
        <>
          <NodeBox
            x={lx}
            y={LANE_Y.output}
            w={NODE_W}
            h={NODE_H}
            label={
              scorePct !== null
                ? `${Math.round(scorePct * 100)}%`
                : "EvalTriggerOutput"
            }
            sublabel={
              scorePct !== null
                ? "EvalTriggerOutput"
                : undefined
            }
            stroke={outputStrokeColor}
            fill={outputFillColor}
          />
          {/* Score delta label below output node */}
          {deltaText && (
            <text
              x={cx}
              y={LANE_Y.output + NODE_H + 16}
              textAnchor="middle"
              fontSize={10}
              fill={deltaColor}
              fontFamily="ui-sans-serif, sans-serif"
              fontWeight="500"
            >
              {deltaText}
            </text>
          )}
        </>
      )}

      {/* Vertical lines within a column */}
      {/* Trigger → Output (baseline: HAS_OUTPUT) */}
      {trigger && output && (
        <VerticalLine
          x={cx}
          y1={LANE_Y.trigger + NODE_H}
          y2={LANE_Y.output}
        />
      )}
      {/* Fix → Output (PRODUCED_BY) */}
      {proposedFix && output && (
        <VerticalLine
          x={cx}
          y1={LANE_Y.fix}
          y2={LANE_Y.output + NODE_H}
        />
      )}
    </g>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  layout: TimelineLayout;
  /** SVG height in pixels (default 480). */
  height?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecursionTimelineViz({ layout, height = 480 }: Props) {
  const { columns, evalSetNode } = layout;

  if (columns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-4 text-center">
        No timeline data available.
      </p>
    );
  }

  const totalWidth = FIRST_COL_X + columns.length * COLUMN_WIDTH + 40;

  // EvalSet dashed line: right edge of EvalSet box → top-center of col-0 trigger node
  const evalSetRightX = EVALSET_X + EVALSET_W;
  const evalSetMidY = EVALSET_Y + EVALSET_H / 2;
  const col0TriggerTopX = nodeXCenter(0);
  const col0TriggerTopY = LANE_Y.trigger;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={totalWidth}
        height={height}
        aria-label="Recursion timeline"
        style={{ display: "block" }}
      >
        <defs>
          <marker
            id={ARROW_MARKER_ID}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* EvalSet anchor node */}
        {evalSetNode && (
          <>
            <NodeBox
              x={EVALSET_X}
              y={EVALSET_Y}
              w={EVALSET_W}
              h={EVALSET_H}
              label="EvalSet"
              stroke="#6b7280"
              fill="#f9fafb"
              dashed
            />
            {/* Dashed connection from EvalSet → col-0 trigger */}
            {columns[0]?.trigger && (
              <line
                x1={evalSetRightX}
                y1={evalSetMidY}
                x2={col0TriggerTopX}
                y2={col0TriggerTopY}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )}
          </>
        )}

        {/* Lane labels */}
        <text x={EVALSET_X} y={LANE_Y.trigger + NODE_H / 2 + 4} fontSize={9} fill="#94a3b8" fontFamily="ui-sans-serif, sans-serif" textAnchor="start">Trigger</text>
        <text x={EVALSET_X} y={LANE_Y.output + NODE_H / 2 + 4} fontSize={9} fill="#94a3b8" fontFamily="ui-sans-serif, sans-serif" textAnchor="start">Output</text>
        <text x={EVALSET_X} y={LANE_Y.fix + NODE_H / 2 + 4} fontSize={9} fill="#94a3b8" fontFamily="ui-sans-serif, sans-serif" textAnchor="start">Fix</text>

        {/* Inter-column bezier edges */}
        {columns.map((col, i) => {
          if (i === 0) return null;
          const prev = columns[i - 1];

          // Source: right edge of prev column's trigger or fix node (whichever exists)
          const srcNode = prev.trigger ?? prev.proposedFix;
          const srcY = prev.trigger
            ? LANE_Y.trigger + NODE_H / 2
            : LANE_Y.fix + NODE_H / 2;
          const srcX = nodeXRight(prev.runIndex);

          // Target: left edge of current column's fix node (or trigger for col 0)
          const tgtNode = col.proposedFix ?? col.trigger;
          const tgtY = col.proposedFix
            ? LANE_Y.fix + NODE_H / 2
            : LANE_Y.trigger + NODE_H / 2;
          const tgtX = nodeXLeft(col.runIndex);

          if (!srcNode || !tgtNode) return null;

          return (
            <BezierArrow
              key={`edge-${i}`}
              x1={srcX}
              y1={srcY}
              x2={tgtX}
              y2={tgtY}
              markerId={ARROW_MARKER_ID}
            />
          );
        })}

        {/* Render each column */}
        {columns.map((col) => (
          <RunColumnGroup key={col.runIndex} col={col} />
        ))}
      </svg>
    </div>
  );
}
