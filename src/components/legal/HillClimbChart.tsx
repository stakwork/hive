"use client";

import React, { useRef, useState, useId } from "react";
import * as d3 from "d3";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

export interface AttemptPoint {
  n_passed: number;
  n_total: number;
  isBaseline: boolean;
  /** Display label: "Baseline" or "Rerun 1", "Rerun 2", … */
  label: string;
}

interface TooltipState {
  x: number;
  y: number;
  point: AttemptPoint;
}

interface HillClimbChartProps {
  attempts: EvalTriggerOutput[];
  /** Visual width of the SVG (px) — defaults to 100% via viewBox */
  height?: number;
}

/**
 * Map a list of EvalTriggerOutput nodes (sorted baseline-first) into AttemptPoints.
 * Nodes without n_passed/n_total are excluded upstream, so every node here is valid.
 */
export function toAttemptPoints(attempts: EvalTriggerOutput[]): AttemptPoint[] {
  let rerunIndex = 0;
  return attempts.map((o, i) => {
    const isBaseline = i === 0;
    const label = isBaseline ? "Baseline" : `Rerun ${++rerunIndex}`;
    return {
      n_passed: o.n_passed!,
      n_total: o.n_total!,
      isBaseline,
      label,
    };
  });
}

const MARGIN = { top: 16, right: 20, bottom: 28, left: 32 };

export function HillClimbChart({ attempts, height = 140 }: HillClimbChartProps) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const points = toAttemptPoints(attempts);

  if (points.length === 0) return null;

  const n_total = points[0].n_total;
  const W = 400; // viewBox logical width
  const H = height;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = H - MARGIN.top - MARGIN.bottom;

  // x: attempt index
  const xScale = d3.scaleLinear()
    .domain([0, Math.max(points.length - 1, 1)])
    .range([0, innerW]);

  // y: n_passed, padded a little below 0 and above n_total
  const yScale = d3.scaleLinear()
    .domain([0, n_total])
    .range([innerH, 0])
    .nice();

  // Polyline path
  const lineGen = d3.line<AttemptPoint>()
    .x((_, i) => xScale(i))
    .y((d) => yScale(d.n_passed))
    .curve(d3.curveMonotoneX);

  const linePath = points.length >= 2 ? lineGen(points) ?? "" : "";

  // Target y position
  const targetY = yScale(n_total);

  // Tick labels for y axis (just 0 and n_total for cleanliness)
  const yTicks = [0, Math.round(n_total / 2), n_total].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  function handleMouseEnter(point: AttemptPoint, idx: number, e: React.MouseEvent<SVGCircleElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const svgW = rect.width;
    const svgH = rect.height;
    // Map logical coords → rendered coords
    const scaleX = svgW / W;
    const scaleY = svgH / H;
    const cx = (MARGIN.left + xScale(idx)) * scaleX;
    const cy = (MARGIN.top + yScale(point.n_passed)) * scaleY;

    // Prefer showing tooltip above the point; flip if near top
    const tipY = cy < 50 ? cy + 16 : cy - 52;
    const tipX = Math.min(Math.max(cx - 52, 4), svgW - 112);

    setTooltip({ x: tipX, y: tipY, point });
    void e;
  }

  return (
    <div className="relative select-none" data-testid="hill-climb-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={() => setTooltip(null)}
        aria-label={`Hill-climb chart: ${points.length} attempts, target ${n_total}`}
        role="img"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y-axis ticks */}
          {yTicks.map((v) => (
            <g key={v} transform={`translate(0,${yScale(v)})`}>
              <line
                x1={-4}
                x2={innerW}
                stroke="currentColor"
                strokeOpacity={v === 0 ? 0.15 : 0.07}
                strokeWidth={1}
              />
              <text
                x={-8}
                dy="0.35em"
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.45}
                fontFamily="ui-monospace, monospace"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Target reference line */}
          <line
            x1={0}
            y1={targetY}
            x2={innerW}
            y2={targetY}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            data-testid="target-line"
          />
          <text
            x={innerW + 3}
            y={targetY}
            dy="0.35em"
            fontSize={8}
            fill="currentColor"
            fillOpacity={0.4}
            fontFamily="ui-monospace, monospace"
          >
            {n_total}
          </text>

          {/* Climbing polyline */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId})`}
              data-testid="climb-polyline"
            />
          )}

          {/* Data points */}
          {points.map((pt, i) => (
            <circle
              key={i}
              cx={xScale(i)}
              cy={yScale(pt.n_passed)}
              r={4}
              fill={pt.isBaseline ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"}
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
              className="cursor-pointer transition-all hover:r-6"
              onMouseEnter={(e) => handleMouseEnter(pt, i, e)}
              onFocus={(e) => handleMouseEnter(pt, i, e as unknown as React.MouseEvent<SVGCircleElement>)}
              tabIndex={0}
              aria-label={`${pt.label}: ${pt.n_passed}/${pt.n_total}`}
              data-testid={`dot-${i}`}
            />
          ))}

          {/* X-axis attempt labels */}
          {points.map((pt, i) => (
            <text
              key={i}
              x={xScale(i)}
              y={innerH + 16}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.4}
              fontFamily="ui-monospace, monospace"
            >
              {pt.isBaseline ? "base" : `r${i}`}
            </text>
          ))}
        </g>
      </svg>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tooltip.x, top: tooltip.y, minWidth: 100 }}
          data-testid="chart-tooltip"
        >
          <div className="font-medium text-popover-foreground">{tooltip.point.label}</div>
          <div className="tabular-nums text-muted-foreground">
            {tooltip.point.n_passed}/{tooltip.point.n_total} passed
          </div>
        </div>
      )}
    </div>
  );
}
