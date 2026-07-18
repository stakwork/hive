"use client";

/**
 * HillClimbChart.tsx
 *
 * Hand-rolled SVG line chart for the Recursion tab hill-climb view.
 * Shows n_passed across attempts toward a dashed target line at n_total.
 *
 * Design intent: sparse, data-first. The line is the only bold element;
 * axes are whisper-quiet; the target rule is the one accent. No chartjunk.
 */

import React, { useRef, useState, useCallback } from "react";
import { scaleLinear } from "d3-scale";
import { line as d3Line } from "d3-shape";
import type { AttemptPoint } from "@/lib/harvey-lab/attempt-series";

// ── Layout constants ────────────────────────────────────────────────────────
const WIDTH = 420;
const HEIGHT = 120;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 32 };
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const DOT_R = 4;
const DOT_HOVER_R = 6;

// ── Color tokens (CSS vars where possible, fallback hex) ─────────────────
// We inline the Tailwind colour semantics as literal SVG values because SVG
// can't consume utility classes directly. We use the same muted/primary
// palette used in EvalRunsBox and LegalBenchmarkResults.
const COLOR_LINE = "hsl(var(--primary))";
const COLOR_DOT = "hsl(var(--primary))";
const COLOR_DOT_HOVER = "hsl(var(--primary))";
const COLOR_TARGET = "hsl(var(--muted-foreground))";
const COLOR_AXIS = "hsl(var(--border))";
const COLOR_LABEL = "hsl(var(--muted-foreground))";
const COLOR_TOOLTIP_BG = "hsl(var(--popover))";
const COLOR_TOOLTIP_FG = "hsl(var(--popover-foreground))";

interface TooltipState {
  x: number;
  y: number;
  point: AttemptPoint;
}

interface HillClimbChartProps {
  series: AttemptPoint[];
  /** aria-label for the <svg> element */
  label?: string;
}

/**
 * HillClimbChart renders a compact SVG line chart of n_passed per attempt.
 *
 * Single-point series: renders only the dot and target line (no polyline —
 * a line connecting one point to itself is meaningless).
 * Empty series: renders nothing (caller guards this case).
 */
export function HillClimbChart({ series, label = "Hill-climb score chart" }: HillClimbChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (series.length === 0) return null;

  // All n_total values in the series should be the same task, but we take
  // the max to ensure the target line is always at or above any data point.
  const n_total = Math.max(...series.map((p) => p.n_total));

  // ── Scales ──────────────────────────────────────────────────────────────
  const xScale = scaleLinear()
    .domain([0, Math.max(series.length - 1, 1)])
    .range([0, INNER_W]);

  const yScale = scaleLinear()
    .domain([0, n_total])
    .range([INNER_H, 0])
    .nice();

  // ── Polyline path ───────────────────────────────────────────────────────
  const lineGenerator = d3Line<AttemptPoint>()
    .x((d) => xScale(d.attemptIndex))
    .y((d) => yScale(d.n_passed));

  const pathD = series.length > 1 ? lineGenerator(series) ?? undefined : undefined;

  // ── Y-axis ticks: just 0 and n_total, clean ─────────────────────────────
  const yTicks = [0, Math.round(n_total / 2), n_total].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  // ── Hover handlers ──────────────────────────────────────────────────────
  const handleDotEnter = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, point: AttemptPoint) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Position tooltip relative to SVG
      const dotX = MARGIN.left + xScale(point.attemptIndex);
      const dotY = MARGIN.top + yScale(point.n_passed);
      setTooltip({ x: dotX, y: dotY, point });
      void e; // suppress unused param lint
    },
    [xScale, yScale],
  );

  const handleDotLeave = useCallback(() => setTooltip(null), []);

  // ── Tooltip placement: flip left when near right edge ───────────────────
  const tooltipWidth = 130;
  const tooltipHeight = 52;
  const txRaw = tooltip ? tooltip.x + 10 : 0;
  const tx = tooltip ? (txRaw + tooltipWidth > WIDTH ? tooltip.x - tooltipWidth - 6 : txRaw) : 0;
  const ty = tooltip ? Math.max(0, tooltip.y - tooltipHeight / 2) : 0;

  return (
    <div className="relative w-full" style={{ maxWidth: WIDTH }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        aria-label={label}
        role="img"
        className="overflow-visible"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* ── Y-axis ticks ─────────────────────────────────────────── */}
          {yTicks.map((tick) => (
            <g key={tick} transform={`translate(0,${yScale(tick)})`}>
              <line x1={-4} x2={INNER_W} stroke={COLOR_AXIS} strokeWidth={0.5} strokeDasharray="2 3" />
              <text
                x={-8}
                dy="0.35em"
                textAnchor="end"
                fontSize={9}
                fill={COLOR_LABEL}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
              >
                {tick}
              </text>
            </g>
          ))}

          {/* ── X-axis attempt labels ─────────────────────────────────── */}
          {series.map((p) => (
            <text
              key={p.attemptIndex}
              x={xScale(p.attemptIndex)}
              y={INNER_H + 16}
              textAnchor="middle"
              fontSize={9}
              fill={COLOR_LABEL}
              fontFamily="var(--font-mono, ui-monospace, monospace)"
            >
              {p.isBaseline ? "Base" : `R${p.attemptIndex}`}
            </text>
          ))}

          {/* ── Target reference line at n_total ─────────────────────── */}
          <line
            x1={0}
            x2={INNER_W}
            y1={yScale(n_total)}
            y2={yScale(n_total)}
            stroke={COLOR_TARGET}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.6}
          />
          <text
            x={INNER_W + 4}
            y={yScale(n_total)}
            dy="0.35em"
            fontSize={8}
            fill={COLOR_TARGET}
            fontFamily="var(--font-mono, ui-monospace, monospace)"
          >
            {n_total}
          </text>

          {/* ── Climbing polyline ─────────────────────────────────────── */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={COLOR_LINE}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          )}

          {/* ── Attempt dots ──────────────────────────────────────────── */}
          {series.map((p) => {
            const isHovered = tooltip?.point.attemptIndex === p.attemptIndex;
            return (
              <circle
                key={p.attemptIndex}
                cx={xScale(p.attemptIndex)}
                cy={yScale(p.n_passed)}
                r={isHovered ? DOT_HOVER_R : DOT_R}
                fill={isHovered ? COLOR_DOT_HOVER : COLOR_DOT}
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                style={{ cursor: "pointer", transition: "r 0.1s" }}
                onMouseEnter={(e) => handleDotEnter(e, p)}
                onMouseLeave={handleDotLeave}
                aria-label={`${p.isBaseline ? "Baseline" : `Rerun ${p.attemptIndex}`}: ${p.n_passed}/${p.n_total}`}
              />
            );
          })}
        </g>

        {/* ── Tooltip (rendered in SVG foreignObject for HTML richness) ── */}
        {tooltip && (
          <foreignObject
            x={tx}
            y={ty}
            width={tooltipWidth}
            height={tooltipHeight}
            style={{ pointerEvents: "none", overflow: "visible" }}
          >
            <div
              style={{
                background: COLOR_TOOLTIP_BG,
                color: COLOR_TOOLTIP_FG,
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 11,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {tooltip.point.n_passed}/{tooltip.point.n_total}
              </div>
              <div style={{ opacity: 0.7, fontSize: 10 }}>
                {tooltip.point.isBaseline ? "Baseline" : `Rerun ${tooltip.point.attemptIndex}`}
              </div>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
