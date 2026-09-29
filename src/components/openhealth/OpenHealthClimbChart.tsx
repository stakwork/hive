"use client";

import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { OpenHealthClimbPoint } from "@/lib/openhealth-benchmarks/runs";
import { formatScore, formatWhen } from "./format";

const MARGIN = { top: 14, right: 44, bottom: 24, left: 36 };
const FALLBACK_WIDTH = 640;
const MAX_X_LABELS = 8;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * One task's F1 over time: one dot per scored run, the line through them the
 * best so far. A dot below the line is drawn hollow. Clicking a dot opens
 * that run.
 */
export function OpenHealthClimbChart({
  points,
  onSelect,
  height = 180,
}: {
  points: OpenHealthClimbPoint[];
  onSelect?: (runId: string) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
        data-testid="openhealth-climb-empty"
      >
        No scored runs yet.
      </div>
    );
  }

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  // Runs are evenly spaced, not by wall-clock: bursts of runs would otherwise pile up.
  const x = d3
    .scaleLinear()
    .domain([0, Math.max(points.length - 1, 1)])
    .range(points.length === 1 ? [innerW / 2, innerW / 2] : [0, innerW]);
  const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
  const line = d3
    .line<OpenHealthClimbPoint>()
    .x((_, i) => x(i))
    .y((p) => y(p.best))
    .curve(d3.curveStepAfter);
  const path = points.length >= 2 ? (line(points) ?? "") : "";

  const last = points[points.length - 1];
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const lastIdx = points.length - 1;
  const showXLabel = (i: number) => i === lastIdx || (i % labelStep === 0 && lastIdx - i >= labelStep);

  const indexAt = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * width - MARGIN.left;
    return Math.min(lastIdx, Math.max(0, Math.round(x.invert(px))));
  };

  const hovered = hover !== null ? points[hover] : null;
  const tipLeft = hovered ? Math.min(Math.max(MARGIN.left + x(hover!) - 60, 0), Math.max(width - 140, 0)) : 0;

  return (
    <div ref={containerRef} className="relative select-none" data-testid="openhealth-climb-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        style={{ height }}
        role="img"
        aria-label={`F1 over ${points.length} scored runs, latest ${formatScore(last.f1)}`}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {[0, 0.5, 1].map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x1={0} x2={innerW} className="stroke-border" strokeWidth={1} />
              <text x={-8} dy="0.35em" textAnchor="end" fontSize={10} className="fill-muted-foreground tabular-nums">
                {v.toFixed(1)}
              </text>
            </g>
          ))}

          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={0}
              y2={innerH}
              className="stroke-muted-foreground"
              strokeOpacity={0.35}
            />
          )}

          <g className="text-indigo-500 dark:text-indigo-400">
            {path && (
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid="openhealth-climb-line"
              />
            )}
            {points.map((p, i) => {
              const hollow = p.f1 < p.best;
              return (
                <circle
                  key={p.runId}
                  cx={x(i)}
                  cy={y(p.f1)}
                  r={hover === i ? 5.5 : 4}
                  fill={hollow ? "none" : "currentColor"}
                  stroke="currentColor"
                  strokeOpacity={hollow ? 0.6 : 1}
                  strokeWidth={1.5}
                  data-testid="openhealth-climb-dot"
                />
              );
            })}
          </g>

          <text
            x={x(lastIdx) + 8}
            y={y(last.best)}
            dy="0.35em"
            fontSize={11}
            fontWeight={600}
            className="fill-foreground tabular-nums"
          >
            {formatScore(last.best)}
          </text>

          {points.map((p, i) =>
            showXLabel(i) ? (
              <text
                key={p.runId}
                x={x(i)}
                y={innerH + 16}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
              >
                {shortDate(p.createdAt)}
              </text>
            ) : null,
          )}

          <rect
            x={-8}
            y={-8}
            width={innerW + 16}
            height={innerH + 16}
            fill="transparent"
            style={onSelect ? { cursor: "pointer" } : undefined}
            onPointerMove={(e) => setHover(indexAt(e))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => onSelect?.(points[indexAt(e)].runId)}
          />
        </g>
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tipLeft, minWidth: 120 }}
          data-testid="openhealth-climb-tooltip"
        >
          <div className="font-semibold tabular-nums text-popover-foreground">F1 {formatScore(hovered.f1)}</div>
          <div className="text-muted-foreground">
            {hovered.gtId !== null ? `task ${hovered.gtId} · ` : ""}
            {formatWhen(hovered.createdAt)}
          </div>
          <div className="text-muted-foreground">
            {hovered.newBest ? "new best" : `best so far ${formatScore(hovered.best)}`}
          </div>
          {onSelect && <div className="mt-0.5 text-primary">click to open run</div>}
        </div>
      )}
    </div>
  );
}
