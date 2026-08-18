"use client";

import React, { useEffect, useId, useRef, useState } from "react";
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
  /** Running-best state of the hovered dot; null for unscored slots. */
  meta: { state: "target" | "best" | "below" | "rejected"; bestBefore: number } | null;
}

interface HillClimbChartProps {
  attempts: EvalTriggerOutput[];
  /** Visual height of the SVG (px) — defaults to 160 */
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
    const actualPassed: number | null = o.actualPassed !== undefined ? o.actualPassed : (o.n_passed ?? null);

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

const MARGIN = { top: 14, right: 52, bottom: 26, left: 40 };

/** Padding on the dot clip so edge dots (and the target halo) aren't sliced. */
const DOT_CLIP_PAD = 11;

/** SVG width used before the ResizeObserver delivers a measurement. */
const FALLBACK_WIDTH = 640;

/** Max x-axis labels before thinning kicks in (long concept-rerun series). */
const MAX_X_LABELS = 12;

/**
 * Fit the y-domain floor to the data instead of always starting at 0.
 *
 * Scores on a mature eval set cluster near the target (e.g. 43–49 of 49); a
 * [0, n_total] domain compresses every run-to-run movement into the top sliver
 * of the plot and the chart reads as a flat line regardless of what happened.
 * Lines (unlike bars) may zoom their domain — the bottom tick renders its real
 * value so a raised floor is never mistaken for zero. The floor snaps back to 0
 * when the data already spans most of the range, and the target stays the
 * ceiling so the reference line is always in view.
 */
function fitYDomain(values: number[], target: number): [number, number] {
  const yMax = Math.max(target, 1);
  if (values.length === 0) return [0, yMax];
  const dataMin = Math.min(...values);
  const pad = Math.max(2, Math.round((yMax - dataMin) * 0.25));
  let yMin = Math.max(0, dataMin - pad);
  // Data already reaches into the lower third → a raised floor buys nothing.
  if (yMin < yMax * 0.35) yMin = 0;
  if (yMin >= yMax) yMin = Math.max(0, yMax - pad);
  return [yMin, yMax];
}

export function HillClimbChart({ attempts, height = 160 }: HillClimbChartProps) {
  const clipId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  // Measure the container so the viewBox matches real pixels (1 unit = 1px).
  // The previous fixed 400px viewBox letterboxed inside wide cards.
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

  const points = toAttemptPoints(attempts);

  if (points.length === 0) return null;

  const n_total = points[0].n_total;
  const W = width;
  const H = height;
  const innerW = Math.max(W - MARGIN.left - MARGIN.right, 1);
  const innerH = H - MARGIN.top - MARGIN.bottom;

  // x: attempt index
  const xScale = d3
    .scaleLinear()
    .domain([0, Math.max(points.length - 1, 1)])
    .range([0, innerW]);

  // y: fitted to the data, target as the ceiling
  const plottedValues = [
    ...points.map((p) => p.actualPassed).filter((v): v is number => v != null),
    ...points.map((p) => p.bestPassed).filter((v) => Number.isFinite(v)),
  ];
  const [yMin, yMax] = fitYDomain(plottedValues, n_total);
  const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

  // Connected line driven by bestPassed (monotonic on the fix-chain series;
  // equal to actualPassed on the flat eval-output series)
  const lineGen = d3
    .line<AttemptPoint>()
    .x((_, i) => xScale(i))
    .y((d) => yScale(d.bestPassed))
    .curve(d3.curveMonotoneX);

  const linePath = points.length >= 2 ? (lineGen(points) ?? "") : "";

  // Target y position
  const targetY = yScale(n_total);

  // Index of the last point that has a dot — carries the direct end label.
  const lastScoredIdx = (() => {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].actualPassed != null) return i;
    }
    return -1;
  })();

  // The end label reads the LINE's final level — the standing best — because
  // regressions are ignored by the line; a series that ended on a hollow dot
  // still headlines the best, right where the line ends. It occupies the same
  // corner as the target-edge value: when they'd collide the end label (the
  // reader's headline) wins and the target value yields; the left tick still
  // shows the target number.
  const endLineValue =
    lastScoredIdx >= 0
      ? (points[lastScoredIdx].bestPassed ?? points[lastScoredIdx].actualPassed ?? 0)
      : 0;
  const showTargetEdgeValue =
    lastScoredIdx < 0 || points.length < 2 || Math.abs(yScale(endLineValue) - targetY) >= 14;

  // Ticks: floor, midpoint, target — the floor tick shows its real value so a
  // fitted (non-zero) domain is never read as starting at zero.
  const yTicks = [yMin, Math.round((yMin + yMax) / 2), yMax].filter((v, i, a) => a.indexOf(v) === i);

  // Thin x labels on long series; always keep the first and last slots. A
  // stepped label that would land within one step of the end is skipped so it
  // never collides with the always-shown last label.
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const lastIdx = points.length - 1;
  const showXLabel = (i: number) =>
    i === lastIdx || (i % labelStep === 0 && lastIdx - i >= labelStep);

  // Per-dot state against the running best:
  //   "target"   — reached n_total (larger, haloed, named in tooltip/aria)
  //   "best"     — sets or ties the best so far (filled, on the line)
  //   "below"    — under the running best: drawn hollow, exactly like a
  //                rejected fix — the run happened, the line ignores it
  //   "rejected" — a rejected fix; hollow, never advances the best
  // Computed from actualPassed on both series kinds. Only accepted runs
  // advance the running best, mirroring the series builders.
  type DotState = "target" | "best" | "below" | "rejected";
  const dotMeta: Array<{ state: DotState; bestBefore: number } | null> = (() => {
    let runningBest = -Infinity;
    return points.map((pt) => {
      if (pt.actualPassed == null) return null;
      const bestBefore = runningBest;
      if (!pt.accepted) return { state: "rejected" as const, bestBefore };
      const state: DotState =
        pt.actualPassed >= n_total && n_total > 0
          ? "target"
          : pt.actualPassed >= runningBest
            ? "best"
            : "below";
      runningBest = Math.max(runningBest, pt.actualPassed);
      return { state, bestBefore };
    });
  })();

  // Series-level achievement: once the running best reaches the target, the
  // ENTIRE series — line, dots, hollow strokes — wears status green instead of
  // the series hue. Green is validated >=3:1 on both card surfaces; the state
  // is also carried by the target dot's halo, its tooltip/aria text, and the
  // line resting on the target rule, so color never announces it alone.
  const targetReached = dotMeta.some((m) => m?.state === "target");

  function tooltipFor(idx: number) {
    const point = points[idx];
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const scaleX = rect.width / W;
    const scaleY = rect.height / H;

    const dotY = point.actualPassed != null ? yScale(point.actualPassed) : yScale(point.bestPassed);
    const cx = (MARGIN.left + xScale(idx)) * scaleX;
    const cy = (MARGIN.top + dotY) * scaleY;

    const tipY = cy < 56 ? cy + 18 : cy - 58;
    const tipX = Math.min(Math.max(cx - 52, 4), Math.max(rect.width - 116, 4));

    setTooltip({ x: tipX, y: tipY, point, meta: dotMeta[idx] });
    setHoverIdx(idx);
  }

  function handleMouseEnter(_point: AttemptPoint, idx: number, e: React.MouseEvent<SVGCircleElement>) {
    tooltipFor(idx);
    void e;
  }

  // Crosshair hover: the whole plot is the hit target — the pointer snaps to
  // the nearest attempt column, so nobody has to land on an 9px dot.
  function handleOverlayMove(e: React.PointerEvent<SVGRectElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W - MARGIN.left;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(xScale.invert(px))));
    tooltipFor(idx);
  }

  function clearHover() {
    setTooltip(null);
    setHoverIdx(null);
  }

  return (
    <div className="relative select-none" data-testid="hill-climb-chart" ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={clearHover}
        aria-label={`Hill-climb chart: ${points.length} attempts, target ${n_total}`}
        role="img"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
          {/*
            Dot clip: the plot rect padded by the dot radius + ring. Dots sit
            exactly on the plot edges (cx=0 at index 0, cy=0 when a point equals
            the y-domain max), so the polyline's own clip would slice them in
            half. The padding keeps edge dots whole while still cutting off any
            point that falls outside the y-domain — a safety net behind the
            series builders' clamp, not a rendering change for in-range data.
          */}
          <clipPath id={`${clipId}-dots`}>
            <rect
              x={-DOT_CLIP_PAD}
              y={-DOT_CLIP_PAD}
              width={innerW + DOT_CLIP_PAD * 2}
              height={innerH + DOT_CLIP_PAD * 2}
            />
          </clipPath>
        </defs>

        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Gridlines: solid hairlines in the border token, recessive. The
              target tick keeps its text but not its gridline — the dashed
              target line already sits at that y, and doubling the ink there
              muddies the one reference that matters. */}
          {yTicks.map((v) => (
            <g key={v} transform={`translate(0,${yScale(v)})`}>
              {v !== n_total && (
                <line x1={0} x2={innerW} className="stroke-border" strokeWidth={1} />
              )}
              <text
                x={-8}
                dy="0.35em"
                textAnchor="end"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {v}
              </text>
            </g>
          ))}

          {/* Target reference line — chrome, not data, so it wears muted ink */}
          <line
            x1={0}
            y1={targetY}
            x2={innerW}
            y2={targetY}
            className="stroke-muted-foreground"
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="4 3"
            data-testid="target-line"
          />
          {showTargetEdgeValue && (
            <text
              x={innerW + 6}
              y={targetY}
              dy="0.35em"
              fontSize={10}
              className="fill-muted-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
              data-testid="target-edge-value"
            >
              {n_total}
            </text>
          )}

          {/* Crosshair: snaps to the hovered attempt column */}
          {hoverIdx != null && (
            <line
              x1={xScale(hoverIdx)}
              x2={xScale(hoverIdx)}
              y1={0}
              y2={innerH}
              className="stroke-muted-foreground"
              strokeOpacity={0.35}
              strokeWidth={1}
              data-testid="crosshair"
            />
          )}

          {/* Series layer — --chart-1 carries identity (status green once the
              target is reached); marks only, never text */}
          <g className={targetReached ? "text-green-600" : "text-chart-1"}>
            {/* Climbing polyline — bestPassed (monotonic best-so-far on the
                fix-chain series; the real score line on the flat series) */}
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

            {/* Data points — skip circle when actualPassed is null, keep x-slot.
                Accepted dots wear a 2px surface ring so they stay legible where
                the line passes through; rejected dots are hollow with the series
                stroke — fill absence, plus the tooltip/aria "rejected", carries
                the state (never color alone). Dot fill follows the running-best
                state: series color while setting/holding the best, muted gray
                below it, status green (larger, haloed) on the target. */}
            <g clipPath={`url(#${clipId}-dots)`} data-testid="dot-group">
              {points.map((pt, i) => {
                if (pt.actualPassed == null) {
                  // No dot — keep x-slot so labels never shift; render nothing visible
                  return <g key={i} data-testid={`slot-${i}`} />;
                }
                const meta = dotMeta[i]!;
                const isTarget = meta.state === "target";
                // Hollow = "the line ignores this run": both rejected fixes and
                // below-best re-runs. Identical look on purpose — aria and the
                // tooltip say which one it is.
                const isHollow = meta.state === "rejected" || meta.state === "below";
                const stateSuffix =
                  meta.state === "rejected"
                    ? " (rejected)"
                    : isTarget
                      ? " (target reached)"
                      : meta.state === "below"
                        ? " (below best)"
                        : "";
                return (
                  <g key={i}>
                    {/* Soft halo marks the achievement — decorative, aria-hidden */}
                    {isTarget && (
                      <circle
                        cx={xScale(i)}
                        cy={yScale(pt.actualPassed)}
                        r={9}
                        fill="currentColor"
                        fillOpacity={0.2}
                        aria-hidden="true"
                        data-testid={`halo-${i}`}
                      />
                    )}
                    <circle
                      cx={xScale(i)}
                      cy={yScale(pt.actualPassed)}
                      r={isTarget ? 5.5 : 4.5}
                      fill={isHollow ? "none" : "currentColor"}
                      fillOpacity={pt.isBaseline && !isTarget ? 0.55 : 1}
                      className={isHollow ? "" : "stroke-card"}
                      stroke={isHollow ? "currentColor" : undefined}
                      strokeWidth={isHollow ? 1.5 : 2}
                      strokeOpacity={isHollow ? 0.55 : 1}
                      onMouseEnter={(e) => handleMouseEnter(pt, i, e)}
                      onFocus={(e) => handleMouseEnter(pt, i, e as unknown as React.MouseEvent<SVGCircleElement>)}
                      tabIndex={0}
                      aria-label={`${pt.label}: ${pt.actualPassed}/${pt.n_total}${stateSuffix}`}
                      data-state={meta.state}
                      data-testid={`dot-${i}`}
                    />
                  </g>
                );
              })}
            </g>
          </g>

          {/* Direct end label: the current score, in ink — text never wears
              the series color */}
          {lastScoredIdx >= 0 && points.length >= 2 && (
            <text
              x={xScale(lastScoredIdx) + 9}
              y={yScale(endLineValue)}
              dy="0.35em"
              fontSize={11}
              fontWeight={600}
              className="fill-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
              data-testid="end-label"
            >
              {endLineValue}
            </text>
          )}

          {/* X-axis attempt labels — thinned on long series, ends always kept */}
          {points.map((pt, i) =>
            showXLabel(i) ? (
              <text
                key={i}
                x={xScale(i)}
                y={innerH + 17}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
              >
                {pt.label}
              </text>
            ) : null,
          )}

          {/* Hover overlay: the whole plot is the hit target for the crosshair */}
          <rect
            x={-DOT_CLIP_PAD}
            y={-DOT_CLIP_PAD}
            width={innerW + DOT_CLIP_PAD * 2}
            height={innerH + DOT_CLIP_PAD * 2}
            fill="transparent"
            onPointerMove={handleOverlayMove}
            onPointerLeave={clearHover}
            data-testid="hit-overlay"
          />
        </g>
      </svg>

      {/* Floating tooltip — the value leads, the label follows */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tooltip.x, top: tooltip.y, minWidth: 100 }}
          data-testid="chart-tooltip"
        >
          <div
            className="font-semibold tabular-nums text-popover-foreground"
          >
            {tooltip.point.actualPassed != null
              ? `${tooltip.point.actualPassed}/${tooltip.point.n_total} passed`
              : "no score"}
          </div>
          <div className="text-muted-foreground">{tooltip.point.label}</div>
          {!tooltip.point.accepted && (
            <div className="text-muted-foreground/60 italic">rejected</div>
          )}
          {tooltip.point.accepted && tooltip.meta?.state === "target" && (
            <div className="text-green-600 dark:text-green-400">target reached</div>
          )}
          {tooltip.point.accepted && tooltip.meta?.state === "below" && (
            <div className="text-muted-foreground/60 italic">
              below best · {tooltip.meta.bestBefore}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
