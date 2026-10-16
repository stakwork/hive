"use client";

import React from "react";
import { runGraphColorMap } from "@/components/strut-run-graph/colors";

/** A node in a thumbnail. `focus` sits in the middle; `proposed` is drawn dashed, as the workbench draws a change. */
export interface MiniGraphNode {
  id: string;
  type: string;
  focus?: boolean;
  proposed?: boolean;
}

/** Drawn dashed when it leads to a proposed node. */
export interface MiniGraphEdge {
  source: string;
  target: string;
}

/** The strip's tile, in the SVG's own units. */
const W = 132;
const H = 84;
/** More than this is a blur at thumbnail size; the panel draws the rest. */
const MAX_NODES = 24;

/**
 * A graph small enough for the chat's thumbnail strip: no labels, nodes in
 * their type's colour (the run graph's and the explorer's palette), the
 * focus — when there is one — in the middle with the rest around it on one
 * or two rings, else every node on a ring. A picture of the shape, not a
 * view: the panel has the graph itself.
 */
export function MiniGraph({ nodes, edges }: { nodes: MiniGraphNode[]; edges: MiniGraphEdge[] }) {
  const layout = (() => {
    // A node reached along two edges is still one node.
    const shown = [...new Map(nodes.map((n) => [n.id, n] as const)).values()].slice(0, MAX_NODES);
    const focus = shown.find((n) => n.focus);
    const around = shown.filter((n) => n !== focus);
    const at = new Map<string, { x: number; y: number }>();
    if (focus) at.set(focus.id, { x: W / 2, y: H / 2 });
    // Two rings once one would crowd: the inner holds a third.
    const inner = around.length > 12 ? Math.ceil(around.length / 3) : 0;
    around.forEach((node, i) => {
      const onInner = i < inner;
      const ring = onInner ? inner : around.length - inner;
      const k = onInner ? i : i - inner;
      const angle = (k / ring) * 2 * Math.PI - Math.PI / 2 + (onInner ? 0 : Math.PI / ring);
      const scale = onInner ? 0.5 : focus ? 1 : 0.95;
      at.set(node.id, { x: W / 2 + Math.cos(angle) * 54 * scale, y: H / 2 + Math.sin(angle) * 32 * scale });
    });
    const colors = runGraphColorMap(new Set(shown.map((n) => n.type)));
    return { shown, at, colors, proposed: new Set(shown.filter((n) => n.proposed).map((n) => n.id)) };
  })();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full bg-card" aria-hidden>
      {edges.map((edge, i) => {
        const a = layout.at.get(edge.source);
        const b = layout.at.get(edge.target);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={0.75}
            strokeDasharray={layout.proposed.has(edge.target) ? "2 2" : undefined}
          />
        );
      })}
      {layout.shown.map((node) => {
        const p = layout.at.get(node.id)!;
        const color = layout.colors[node.type];
        return (
          <circle
            key={node.id}
            cx={p.x}
            cy={p.y}
            r={node.focus ? 5 : 3.25}
            fill={node.proposed ? "none" : color}
            stroke={color}
            strokeWidth={node.proposed ? 1 : 0}
            strokeDasharray={node.proposed ? "1.5 1.5" : undefined}
          />
        );
      })}
    </svg>
  );
}
