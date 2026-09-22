"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProtectEndpoint } from "@/types/protect";

const WIDTH = 960;
const GUTTER = 210; // label space either side of the bars
const BAR_WIDTH = 12;
const LEFT_X = GUTTER;
const RIGHT_X = WIDTH - GUTTER - BAR_WIDTH;
const PAD_Y = 24;
const GAP = 14;
const MIN_BAR = 8;
const MIN_SLOT = 36; // bar + gap must fit a two-line label
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 600;
const LABEL_MIN_THICKNESS = 13;

// One hue per system, assigned in sorted order so colours are stable across reloads.
const PALETTE = [
  "#60a5fa", // blue
  "#c084fc", // purple
  "#34d399", // emerald
  "#fbbf24", // amber
  "#fb7185", // rose
  "#2dd4bf", // teal
  "#818cf8", // indigo
  "#fb923c", // orange
  "#a3e635", // lime
  "#f472b6", // pink
];

export interface SystemGraphSelection {
  /** Owning system of the endpoints shown, or null for all. */
  system: string | null;
  /** Calling system, or null for any. */
  caller: string | null;
}

interface SystemGraphProps {
  endpoints: ProtectEndpoint[];
  selection: SystemGraphSelection;
  onSelect: (selection: SystemGraphSelection) => void;
  className?: string;
}

interface Pair {
  caller: string;
  callee: string;
  endpoints: number;
  callSites: number;
}

interface Bar {
  system: string;
  y: number;
  height: number;
  total: number;
}

interface Ribbon extends Pair {
  y0: number;
  y1: number;
  /** Thickness at the caller bar; each column is scaled on its own. */
  t0: number;
  /** Thickness at the callee bar. */
  t1: number;
  color: string;
}

/** `stakwork/hive` -> `hive`; the full id stays available as a tooltip. */
function shortSystem(system: string): string {
  const slash = system.lastIndexOf("/");
  return slash === -1 ? system : system.slice(slash + 1);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ribbonPath(x0: number, y0: number, t0: number, x1: number, y1: number, t1: number): string {
  const xm = (x0 + x1) / 2;
  return [
    `M ${x0} ${y0}`,
    `C ${xm} ${y0}, ${xm} ${y1}, ${x1} ${y1}`,
    `L ${x1} ${y1 + t1}`,
    `C ${xm} ${y1 + t1}, ${xm} ${y0 + t0}, ${x0} ${y0 + t0}`,
    "Z",
  ].join(" ");
}

function buildFlow(endpoints: ProtectEndpoint[]) {
  const owned = new Map<string, number>();
  const pairs = new Map<string, Pair>();

  for (const endpoint of endpoints) {
    owned.set(endpoint.system, (owned.get(endpoint.system) ?? 0) + 1);
    for (const caller of endpoint.callers) {
      const key = `${caller.system}→${endpoint.system}`;
      const pair = pairs.get(key) ?? {
        caller: caller.system,
        callee: endpoint.system,
        endpoints: 0,
        callSites: 0,
      };
      pair.endpoints += 1;
      pair.callSites += caller.callSites;
      pairs.set(key, pair);
    }
  }

  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const pair of pairs.values()) {
    outgoing.set(pair.caller, (outgoing.get(pair.caller) ?? 0) + pair.endpoints);
    incoming.set(pair.callee, (incoming.get(pair.callee) ?? 0) + pair.endpoints);
  }

  const systems = Array.from(new Set([...owned.keys(), ...outgoing.keys()])).sort();
  const colorOf = new Map(systems.map((system, i) => [system, PALETTE[i % PALETTE.length]]));

  // Callers on the left, biggest first; every system that owns endpoints on the right.
  const leftOrder = Array.from(outgoing.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([system]) => system);
  const rightOrder = Array.from(owned.keys()).sort(
    (a, b) =>
      (incoming.get(b) ?? 0) - (incoming.get(a) ?? 0) ||
      (owned.get(b) ?? 0) - (owned.get(a) ?? 0) ||
      a.localeCompare(b),
  );

  const rows = Math.max(leftOrder.length, rightOrder.length, 1);
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, PAD_Y * 2 + rows * 76));
  const usable = height - PAD_Y * 2;

  function stack(order: string[], totals: Map<string, number>): Bar[] {
    // Bars are proportional to their totals, except that every row keeps at
    // least MIN_SLOT so its label fits. Fixed rows are removed from the
    // proportional pool until the scale settles.
    const fixed = new Set<string>();
    let unit = 0;
    for (let pass = 0; pass < order.length + 1; pass++) {
      const flexible = order.filter((system) => !fixed.has(system));
      const flexUnits = flexible.reduce((sum, system) => sum + (totals.get(system) ?? 0), 0);
      const reserved = fixed.size * MIN_SLOT + flexible.length * GAP - (order.length ? GAP : 0);
      unit = flexUnits > 0 ? Math.max(0, (usable - reserved) / flexUnits) : 0;
      const newlyFixed = flexible.filter(
        (system) => (totals.get(system) ?? 0) * unit + GAP < MIN_SLOT,
      );
      if (newlyFixed.length === 0) break;
      newlyFixed.forEach((system) => fixed.add(system));
    }

    const bars: Bar[] = [];
    let y = PAD_Y;
    for (const system of order) {
      const total = totals.get(system) ?? 0;
      const barHeight = fixed.has(system)
        ? Math.max(MIN_BAR, Math.min(MIN_SLOT - GAP, total * unit))
        : total * unit;
      bars.push({ system, y, height: barHeight, total });
      y += fixed.has(system) ? MIN_SLOT : barHeight + GAP;
    }
    // Centre the shorter stack vertically.
    const used = y - (order.length && !fixed.has(order[order.length - 1]) ? GAP : 0) - PAD_Y;
    const offset = Math.max(0, (usable - used) / 2);
    return bars.map((bar) => ({ ...bar, y: bar.y + offset }));
  }

  const left = stack(leftOrder, outgoing);
  const right = stack(rightOrder, incoming);
  const leftIndex = new Map(left.map((bar, i) => [bar.system, i]));
  const rightIndex = new Map(right.map((bar, i) => [bar.system, i]));

  // Ribbons stack inside each bar in the other column's order, which keeps crossings low.
  const leftCursor = new Map(left.map((bar) => [bar.system, bar.y]));
  const rightCursor = new Map(right.map((bar) => [bar.system, bar.y]));
  const sortedPairs = Array.from(pairs.values()).sort(
    (a, b) =>
      (leftIndex.get(a.caller) ?? 0) - (leftIndex.get(b.caller) ?? 0) ||
      (rightIndex.get(a.callee) ?? 0) - (rightIndex.get(b.callee) ?? 0),
  );
  const ribbons: Ribbon[] = [];
  for (const pair of sortedPairs) {
    const leftBar = left[leftIndex.get(pair.caller) ?? 0];
    const rightBar = right[rightIndex.get(pair.callee) ?? 0];
    if (!leftBar || !rightBar) continue;
    const t0 = (leftBar.height * pair.endpoints) / Math.max(1, leftBar.total);
    const t1 = (rightBar.height * pair.endpoints) / Math.max(1, rightBar.total);
    const y0 = leftCursor.get(pair.caller) ?? leftBar.y;
    leftCursor.set(pair.caller, y0 + t0);
    ribbons.push({ ...pair, y0, y1: 0, t0, t1, color: colorOf.get(pair.caller) ?? PALETTE[0] });
  }
  for (const ribbon of ribbons.slice().sort(
    (a, b) =>
      (rightIndex.get(a.callee) ?? 0) - (rightIndex.get(b.callee) ?? 0) ||
      (leftIndex.get(a.caller) ?? 0) - (leftIndex.get(b.caller) ?? 0),
  )) {
    const rightBar = right[rightIndex.get(ribbon.callee) ?? 0];
    const y1 = rightCursor.get(ribbon.callee) ?? rightBar.y;
    ribbon.y1 = y1;
    rightCursor.set(ribbon.callee, y1 + ribbon.t1);
  }

  return { left, right, ribbons, owned, colorOf, height };
}

/**
 * Flow diagram of cross-system calls: calling systems on the left, called
 * systems on the right, one ribbon per pair sized by how many endpoints the
 * caller hits. Internal calls are a ribbon from a system to itself.
 * Clicking a ribbon or a bar narrows `selection`, which the endpoint table
 * uses as its filter.
 */
export function SystemGraph({ endpoints, selection, onSelect, className }: SystemGraphProps) {
  const flow = useMemo(() => buildFlow(endpoints), [endpoints]);
  const [hover, setHover] = useState<string | null>(null);
  const hasSelection = selection.system !== null || selection.caller !== null;

  const isActive = (ribbon: Ribbon) =>
    (selection.caller === null || selection.caller === ribbon.caller) &&
    (selection.system === null || selection.system === ribbon.callee);

  const toggleCaller = (system: string) =>
    onSelect(
      selection.caller === system && selection.system === null
        ? { system: null, caller: null }
        : { system: null, caller: system },
    );
  const toggleCallee = (system: string) =>
    onSelect(
      selection.system === system && selection.caller === null
        ? { system: null, caller: null }
        : { system, caller: null },
    );
  const toggleRibbon = (ribbon: Ribbon) =>
    onSelect(
      selection.caller === ribbon.caller && selection.system === ribbon.callee
        ? { system: null, caller: null }
        : { system: ribbon.callee, caller: ribbon.caller },
    );

  return (
    <div className={cn("w-full", className)} data-testid="protect-system-graph">
      <svg
        viewBox={`0 0 ${WIDTH} ${flow.height}`}
        className="h-auto w-full select-none"
        style={{ maxHeight: MAX_HEIGHT }}
        role="img"
        aria-label="Which systems call which endpoints"
      >
        <text
          x={LEFT_X - 10}
          y={12}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          letterSpacing={1}
          style={{ fill: "var(--muted-foreground)" }}
        >
          CALLS FROM
        </text>
        <text
          x={RIGHT_X + BAR_WIDTH + 10}
          y={12}
          fontSize={11}
          fontWeight={600}
          letterSpacing={1}
          style={{ fill: "var(--muted-foreground)" }}
        >
          ENDPOINTS IN
        </text>

        {flow.ribbons.map((ribbon) => {
          const key = `${ribbon.caller}→${ribbon.callee}`;
          const active = isActive(ribbon);
          const highlighted = hover === key || (hasSelection && active);
          const dimmed = (hasSelection && !active) || (hover !== null && hover !== key);
          const internal = ribbon.caller === ribbon.callee;
          return (
            <g
              key={key}
              className="cursor-pointer"
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggleRibbon(ribbon)}
              data-testid={`system-ribbon-${ribbon.caller}-${ribbon.callee}`}
            >
              <title>
                {`${shortSystem(ribbon.caller)} → ${shortSystem(ribbon.callee)}${internal ? " (internal)" : ""}: ${plural(ribbon.endpoints, "endpoint")}, ${plural(ribbon.callSites, "call site")}`}
              </title>
              <path
                d={ribbonPath(LEFT_X + BAR_WIDTH, ribbon.y0, ribbon.t0, RIGHT_X, ribbon.y1, ribbon.t1)}
                fill={ribbon.color}
                fillOpacity={dimmed ? 0.08 : highlighted ? 0.75 : 0.4}
                stroke={ribbon.color}
                strokeOpacity={dimmed ? 0.1 : highlighted ? 1 : 0.35}
                strokeWidth={0.75}
                style={{ transition: "fill-opacity 120ms, stroke-opacity 120ms" }}
              />
              {(ribbon.t0 >= LABEL_MIN_THICKNESS || highlighted) && !dimmed && (
                <text
                  x={LEFT_X + BAR_WIDTH + 10}
                  y={ribbon.y0 + ribbon.t0 / 2}
                  dominantBaseline="middle"
                  fontSize={11}
                  fontWeight={600}
                  className="pointer-events-none"
                  style={{ fill: "var(--foreground)", paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}
                >
                  {ribbon.endpoints}
                </text>
              )}
            </g>
          );
        })}

        {flow.left.map((bar) => {
          const color = flow.colorOf.get(bar.system) ?? PALETTE[0];
          const active = selection.caller === null || selection.caller === bar.system;
          const selected = selection.caller === bar.system && selection.system === null;
          return (
            <g
              key={`left-${bar.system}`}
              className="cursor-pointer"
              onClick={() => toggleCaller(bar.system)}
              opacity={hasSelection && !active ? 0.35 : 1}
              data-testid={`system-caller-${bar.system}`}
            >
              <title>{`${bar.system} calls ${plural(bar.total, "endpoint")}`}</title>
              <rect
                x={LEFT_X}
                y={bar.y}
                width={BAR_WIDTH}
                height={bar.height}
                rx={3}
                fill={color}
                stroke={selected ? "var(--foreground)" : "none"}
                strokeWidth={2}
              />
              <text
                x={LEFT_X - 12}
                y={bar.y + bar.height / 2}
                textAnchor="end"
                dominantBaseline="middle"
                style={{ fill: "var(--foreground)" }}
              >
                <tspan fontSize={13} fontWeight={600}>
                  {shortSystem(bar.system)}
                </tspan>
                <tspan
                  x={LEFT_X - 12}
                  dy={15}
                  fontSize={11}
                  style={{ fill: "var(--muted-foreground)" }}
                >
                  calls {plural(bar.total, "endpoint")}
                </tspan>
              </text>
            </g>
          );
        })}

        {flow.right.map((bar) => {
          const color = flow.colorOf.get(bar.system) ?? PALETTE[0];
          const active = selection.system === null || selection.system === bar.system;
          const selected = selection.system === bar.system && selection.caller === null;
          const owned = flow.owned.get(bar.system) ?? 0;
          return (
            <g
              key={`right-${bar.system}`}
              className="cursor-pointer"
              onClick={() => toggleCallee(bar.system)}
              opacity={hasSelection && !active ? 0.35 : 1}
              data-testid={`system-callee-${bar.system}`}
            >
              <title>
                {`${bar.system}: ${plural(owned, "endpoint")}, ${bar.total} called from known systems`}
              </title>
              <rect
                x={RIGHT_X}
                y={bar.y}
                width={BAR_WIDTH}
                height={bar.height}
                rx={3}
                fill={color}
                stroke={selected ? "var(--foreground)" : "none"}
                strokeWidth={2}
              />
              <text
                x={RIGHT_X + BAR_WIDTH + 12}
                y={bar.y + bar.height / 2}
                dominantBaseline="middle"
                style={{ fill: "var(--foreground)" }}
              >
                <tspan fontSize={13} fontWeight={600}>
                  {shortSystem(bar.system)}
                </tspan>
                <tspan
                  x={RIGHT_X + BAR_WIDTH + 12}
                  dy={15}
                  fontSize={11}
                  style={{ fill: "var(--muted-foreground)" }}
                >
                  {plural(owned, "endpoint")}
                  {bar.total === 0 && " · no known callers"}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
