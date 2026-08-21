"use client";

import React from "react";
import type { TimelineLayout, RunColumn } from "@/lib/harvey-lab/timeline-layout";
import type { SubgraphNode } from "@/lib/harvey-lab/hill-climb-series";

// ── Layout constants ──────────────────────────────────────────────────────────

const COLUMN_WIDTH = 280;
const NODE_W = 200;
const NODE_H = 50;
const LANE_Y = { trigger: 100, output: 230, fix: 370 } as const;
const EVALSET_X = 24;
const EVALSET_Y = 24;
const EVALSET_W = 160;
const EVALSET_H = 40;
const FIRST_COL_X = 320;
const SVG_PADDING_BOTTOM = 60;

// ── Score color helpers ───────────────────────────────────────────────────────

function scoreColor(scorePct: number | null): string {
  if (scorePct === null) return "#6b7280"; // neutral gray
  if (scorePct >= 0.75) return "#16a34a"; // green
  if (scorePct >= 0.45) return "#d97706"; // amber
  return "#dc2626"; // red
}

function scoreFill(scorePct: number | null): string {
  if (scorePct === null) return "none";
  if (scorePct >= 0.75) return "#dcfce7";
  if (scorePct >= 0.45) return "#fef3c7";
  return "#fee2e2";
}

// ── Node label helper ─────────────────────────────────────────────────────────

function nodeLabel(node: SubgraphNode, fallback: string): string {
  const name = node.properties?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return node.node_type ?? fallback;
}

// ── Clamp / format helpers ────────────────────────────────────────────────────

function fmtPct(pct: number): string {
  return `${Math.round(pct * 100)}%`;
}

function fmtDelta(delta: number): string {
  const pts = Math.round(Math.abs(delta) * 100);
  return delta >= 0 ? `+${pts} pts` : `−${pts} pts`;
}

// ── SVG sub-components ────────────────────────────────────────────────────────

interface NodeBoxProps {
  x: number;
  y: number;
  label: string;
  sublabel?: string;
  stroke?: string;
  fill?: string;
  strokeDasharray?: string;
}

function NodeBox({
  x,
  y,
  label,
  sublabel,
  stroke = "#6b7280",
  fill = "none",
  strokeDasharray,
}: NodeBoxProps) {
  return (
    <g>
      <rect
        x={x - NODE_W / 2}
        y={y - NODE_H / 2}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={strokeDasharray}
      />
      <text
        x={x}
        y={y - (sublabel ? 8 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={11}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fill={stroke === "none" ? "#374151" : stroke}
      >
        {label.length > 28 ? label.slice(0, 26) + "…" : label}
      </text>
      {sublabel && (
        <text
          x={x}
          y={y + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill="#6b7280"
        >
          {sublabel.length > 32 ? sublabel.slice(0, 30) + "…" : sublabel}
        </text>
      )}
    </g>
  );
}

/** Cubic bezier connecting right-edge of (x1,y1) to left-edge of (x2,y2). */
function BezierEdge({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const cx1 = x1 + (x2 - x1) * 0.5;
  const cx2 = x2 - (x2 - x1) * 0.5;
  return (
    <path
      d={`M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
      fill="none"
      stroke="#94a3b8"
      strokeWidth={1.5}
      markerEnd="url(#arrowhead)"
    />
  );
}

/** Straight vertical line from (x,y1) down to (x,y2). */
function VerticalEdge({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke="#94a3b8"
      strokeWidth={1.5}
      markerEnd="url(#arrowhead)"
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface RecursionTimelineVizProps {
  layout: TimelineLayout;
  height?: number;
}

export function RecursionTimelineViz({ layout, height = 500 }: RecursionTimelineVizProps) {
  const { columns, evalSetNode } = layout;

  if (columns.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No timeline data available.
      </div>
    );
  }

  const svgWidth = FIRST_COL_X + columns.length * COLUMN_WIDTH + 40;
  const svgHeight = Math.max(
    height,
    LANE_Y.fix + NODE_H / 2 + SVG_PADDING_BOTTOM,
  );

  // Column center X for a given column index
  const colX = (idx: number) => FIRST_COL_X + idx * COLUMN_WIDTH + COLUMN_WIDTH / 2;

  return (
    <div style={{ overflowX: "auto" }} data-testid="timeline-scroll-container">
      <svg
        width={svgWidth}
        height={svgHeight}
        aria-label="Recursion run progression timeline"
        data-testid="timeline-svg"
      >
        {/* ── Arrow marker ───────────────────────────────────────────────── */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth={8}
            markerHeight={6}
            refX={7}
            refY={3}
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
        </defs>

        {/* ── EvalSet node (pinned top-left) ──────────────────────────────── */}
        {evalSetNode && (
          <g data-testid="evalset-node">
            <rect
              x={EVALSET_X}
              y={EVALSET_Y}
              width={EVALSET_W}
              height={EVALSET_H}
              rx={6}
              fill="none"
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={EVALSET_X + EVALSET_W / 2}
              y={EVALSET_Y + EVALSET_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fill="#6366f1"
            >
              {nodeLabel(evalSetNode, "EvalSet")}
            </text>
            {/* Dashed connector from EvalSet right-edge to column-0 trigger top-center */}
            {columns[0]?.trigger && (
              <line
                x1={EVALSET_X + EVALSET_W}
                y1={EVALSET_Y + EVALSET_H / 2}
                x2={colX(0)}
                y2={LANE_Y.trigger - NODE_H / 2}
                stroke="#6366f1"
                strokeWidth={1}
                strokeDasharray="4 3"
                markerEnd="url(#arrowhead)"
              />
            )}
          </g>
        )}

        {/* ── Lane labels ─────────────────────────────────────────────────── */}
        {(["trigger", "output", "fix"] as const).map((lane) => (
          <text
            key={lane}
            x={8}
            y={LANE_Y[lane]}
            dominantBaseline="middle"
            fontSize={9}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill="#9ca3af"
            textAnchor="start"
            transform={`rotate(-90, 8, ${LANE_Y[lane]})`}
          >
            {lane === "trigger" ? "Trigger" : lane === "output" ? "Output" : "Fix"}
          </text>
        ))}

        {/* ── Columns ─────────────────────────────────────────────────────── */}
        {columns.map((col: RunColumn, i: number) => {
          const cx = colX(i);
          const color = scoreColor(col.scorePct);
          const fill = scoreFill(col.scorePct);

          return (
            <g key={i} data-testid={`timeline-column-${i}`}>
              {/* Run N badge */}
              <text
                x={cx}
                y={60}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fill="#374151"
                data-testid={`run-badge-${i}`}
              >
                Run {i + 1}
              </text>

              {/* Trigger node (column 0 only — subsequent columns have no trigger) */}
              {col.trigger && (
                <g data-testid={`trigger-node-${i}`}>
                  <NodeBox
                    x={cx}
                    y={LANE_Y.trigger}
                    label={nodeLabel(col.trigger, "EvalTrigger")}
                    sublabel="EvalTrigger"
                    stroke="#3b82f6"
                  />
                  {/* Vertical edge: trigger → output */}
                  {col.output && (
                    <VerticalEdge
                      x={cx}
                      y1={LANE_Y.trigger + NODE_H / 2}
                      y2={LANE_Y.output - NODE_H / 2}
                    />
                  )}
                </g>
              )}

              {/* ProposedFix node (columns 1+) */}
              {col.proposedFix && (
                <g data-testid={`fix-node-${i}`}>
                  <NodeBox
                    x={cx}
                    y={LANE_Y.fix}
                    label={nodeLabel(col.proposedFix, "ProposedFix")}
                    sublabel="ProposedFix"
                    stroke="#8b5cf6"
                  />
                  {/* Vertical edge: fix → output */}
                  {col.output && (
                    <VerticalEdge
                      x={cx}
                      y1={LANE_Y.fix - NODE_H / 2}
                      y2={LANE_Y.output + NODE_H / 2}
                    />
                  )}
                </g>
              )}

              {/* Output node */}
              {col.output && (
                <g data-testid={`output-node-${i}`}>
                  <NodeBox
                    x={cx}
                    y={LANE_Y.output}
                    label={
                      col.scorePct !== null
                        ? fmtPct(col.scorePct)
                        : nodeLabel(col.output, "EvalTriggerOutput")
                    }
                    sublabel="EvalTriggerOutput"
                    stroke={color}
                    fill={fill}
                    strokeDasharray={col.scorePct === null ? "4 3" : undefined}
                  />
                  {/* Score delta label below output node */}
                  {i > 0 &&
                    col.scoreDelta !== null &&
                    col.scoreDelta !== 0 && (
                      <text
                        x={cx}
                        y={LANE_Y.output + NODE_H / 2 + 16}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                        fill={col.scoreDelta >= 0 ? "#16a34a" : "#dc2626"}
                        data-testid={`score-delta-${i}`}
                      >
                        {fmtDelta(col.scoreDelta)}
                      </text>
                    )}
                </g>
              )}

              {/* Inter-column bezier edge (col 0 → col 1, col 1 → col 2, …) */}
              {i > 0 && (() => {
                const prev = columns[i - 1];
                // Source: right edge of previous column's output or fix node
                const srcY = prev.output ? LANE_Y.output : prev.trigger ? LANE_Y.trigger : LANE_Y.fix;
                const srcX = colX(i - 1) + NODE_W / 2;
                // Target: left edge of current column's fix node (or output if no fix)
                const tgtY = col.proposedFix ? LANE_Y.fix : col.output ? LANE_Y.output : LANE_Y.trigger;
                const tgtX = cx - NODE_W / 2;
                return (
                  <BezierEdge
                    key={`edge-${i}`}
                    x1={srcX}
                    y1={srcY}
                    x2={tgtX}
                    y2={tgtY}
                  />
                );
              })()}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
