"use client";

import React, { useRef, useState, useId } from "react";
import * as d3 from "d3";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

export interface AttemptPoint {
  /** Actual n_passed for dot rendering; null = no dot, x-slot is preserved */
  actualPassed: number | null;
  /** Running best n_passed for the connected line (monotonic non-decreasing) */
  bestPassed: number;
  n_total: number;
  isBaseline: boolean;
  accepted: boolean;
  /** Display label sourced from series data: "base", "r1", "r2", … */
  label: string;
}

interface TooltipState {
  x: number;
  y: number;
  point: AttemptPoint;
}

interface HillClimbChartProps {
  attempts: EvalTriggerOutput[];
  /** Visual height of the SVG (px) — defaults to 140 */
  height?: number;
}

/**
 * Map a list of EvalTriggerOutput nodes (sorted baseline-first, with optional
 * hill-climb series fields from buildHillClimbSeries) into AttemptPoints.
 *
 * When the series fields (`bestPassed`, `actualPassed`, `label`, `accepted`,
 * `isBaseline`) are present (T1 model), they are used directly.
 * When absent (legacy path), sensible defaults are derived from `n_passed`.
 */
export function toAttemptPoints(attempts: EvalTriggerOutput[]): AttemptPoint[] {
  // Compute running best for legacy path (series fields absent)
  let legacyBest = 0;

  return attempts.map((o, i) => {
    const isBaseline = o.isBaseline ?? i === 0;
    const accepted = o.accepted ?? true; // legacy: treat all as accepted

    // Prefer series-provided actualPassed; fall back to n_passed (possibly null for slot-only)
    const actualPassed: number | null =
      o.actualPassed !== undefined ? o.actualPassed : (o.n_passed ?? null);

    // Prefer series-provided bestPassed; compute for legacy path
    let bestPassed: number;
    if (o.bestPassed !== undefined) {
      bestPassed = o.bestPassed;
    } else {
      // Legacy: monotonic best derived from n_passed
      if (actualPassed != null) {
        legacyBest = Math.max(legacyBest, actualPassed);
      }
      bestPassed = legacyBest;
    }

    // Prefer series-provided label; fall back to "base"/"r{i}" from index
    const label = o.label ?? (isBaseline ? "base" : `r${i}`);

    return {
      actualPassed,
      bestPassed,
      n_total: o.n_total ?? 0,
      isBaseline,
      accepted,
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

  // y: 0..n_total
  const yScale = d3.scaleLinear()
    .domain([0, n_total])
    .range([innerH, 0])
    .nice();

  // Connected line driven by bestPassed (monotonic non-decreasing)
  const lineGen = d3.line<AttemptPoint>()
    .x((_, i) => xScale(i))
    .y((d) => yScale(d.bestPassed))
    .curve(d3.curveMonotoneX);

  const linePath = points.length >= 2 ? lineGen(points) ?? "" : "";

  // Target y position
  const targetY = yScale(n_total);

  // Tick labels for y axis
  const yTicks = [0, Math.round(n_total / 2), n_total].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  function handleMouseEnter(point: AttemptPoint, idx: number, e: React.MouseEvent<SVGCircleElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const svgW = rect.width;
    const svgH = rect.height;
    const scaleX = svgW / W;
    const scaleY = svgH / H;

    // Position tooltip relative to the dot (bestPassed drives the line; dot is at actualPassed)
    const dotY = point.actualPassed != null ? yScale(point.actualPassed) : yScale(point.bestPassed);
    const cx = (MARGIN.left + xScale(idx)) * scaleX;
    const cy = (MARGIN.top + dotY) * scaleY;

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

          {/* Climbing polyline — driven by bestPassed for monotonic best-so-far line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId})`}
              data-testid="climb-polyline"
            />
          )}

          {/* Data points — skip circle when actualPassed is null, keep x-slot */}
          {points.map((pt, i) =>
            pt.actualPassed != null ? (
              <circle
                key={i}
                cx={xScale(i)}
                cy={yScale(pt.actualPassed)}
                r={4}
                fill={pt.accepted ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeOpacity={pt.accepted ? 1 : 0.4}
                fillOpacity={pt.isBaseline ? 0.55 : pt.accepted ? 1 : 0}
                className="cursor-pointer"
                onMouseEnter={(e) => handleMouseEnter(pt, i, e)}
                onFocus={(e) => handleMouseEnter(pt, i, e as unknown as React.MouseEvent<SVGCircleElement>)}
                tabIndex={0}
                aria-label={`${pt.label}: ${pt.actualPassed}/${pt.n_total}${pt.accepted ? "" : " (rejected)"}`}
                data-testid={`dot-${i}`}
              />
            ) : (
              // No dot — keep x-slot so labels never shift; render nothing visible
              <g key={i} data-testid={`slot-${i}`} />
            ),
          )}

          {/* X-axis attempt labels — sourced from series label, never recomputed from index */}
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
              {pt.label}
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
            {tooltip.point.actualPassed != null
              ? `${tooltip.point.actualPassed}/${tooltip.point.n_total} passed`
              : "no score"}
          </div>
          {!tooltip.point.accepted && (
            <div className="text-muted-foreground/60 italic">rejected</div>
          )}
        </div>
      )}
    </div>
  );
}
