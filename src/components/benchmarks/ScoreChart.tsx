"use client";

import * as d3 from "d3";
import type { BenchmarkRun } from "@/types/benchmarks";

const W = 640;
const H = 160;
const M = { top: 10, right: 16, bottom: 22, left: 40 };

/** Score over time: one dot per scored run, oldest → newest. */
export function ScoreChart({ runs }: { runs: BenchmarkRun[] }) {
  const pts = runs
    .filter((r) => r.score !== null)
    .map((r) => ({ id: r.id, t: new Date(r.createdAt), score: r.score as number }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (pts.length < 2) {
    return <p className="text-sm text-muted-foreground">Score over time appears once two runs have scored.</p>;
  }
  const [t0, t1] = d3.extent(pts, (p) => p.t) as [Date, Date];
  const [lo, hi] = d3.extent(pts, (p) => p.score) as [number, number];
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  const x = d3.scaleTime().domain([t0, t1]).range([M.left, W - M.right]);
  const y = d3.scaleLinear().domain([lo - pad, hi + pad]).range([H - M.bottom, M.top]);
  const line = d3.line<(typeof pts)[number]>().x((p) => x(p.t)).y((p) => y(p.score))(pts) ?? "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score over time">
      {y.ticks(4).map((tick) => (
        <g key={tick}>
          <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} className="stroke-border" />
          <text x={M.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
            {d3.format(".3~g")(tick)}
          </text>
        </g>
      ))}
      {x.ticks(5).map((tick) => (
        <text key={tick.getTime()} x={x(tick)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {d3.timeFormat("%b %d")(tick)}
        </text>
      ))}
      <path d={line} fill="none" className="stroke-primary" strokeWidth={1.5} />
      {pts.map((p) => (
        <circle key={p.id} cx={x(p.t)} cy={y(p.score)} r={3.5} className="fill-primary">
          <title>{`${p.score} — ${p.t.toLocaleString()}`}</title>
        </circle>
      ))}
    </svg>
  );
}
