/**
 * Where the viewer draws a run's nodes: by the stage of the run that first
 * touched them. Pure, and the same for the same input.
 *
 * A stage is a step directly under the run. Stages are lanes, left to right
 * in the order the run reached them; a stage that loops has one cell per
 * iteration. Inside a cell the nodes settle by the links among them. A stage
 * that only went back to nodes an earlier one touched is an empty lane.
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3";
import { callLabel } from "./replay";
import type { RunGraphCall } from "./types";

export interface RunGraphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunGraphCell extends RunGraphBox {
  /** The loop iteration; null for a stage that does not loop. */
  iteration: number | null;
  nodes: number;
}

export interface RunGraphLane extends RunGraphBox {
  stage: string;
  calls: number;
  nodes: number;
  cells: RunGraphCell[];
}

export interface RunGraphPoint {
  x: number;
  y: number;
}

export interface RunGraphPlace extends RunGraphPoint {
  /** The cell the node sits in: two nodes are drawn together when theirs is the same. */
  cell: string;
}

export interface RunGraphLayout {
  width: number;
  height: number;
  positions: Map<string, RunGraphPlace>;
  lanes: RunGraphLane[];
}

/** Radius a node is drawn with. */
export const RUN_GRAPH_NODE_RADIUS = 12;

const LINK_DISTANCE = 64;
const CHARGE = -160;
const COLLIDE_RADIUS = 28;
const GRAVITY = 0.12;
const TICKS = 200;

const CELL_PAD = 32;
const CELL_HEADER = 28;
const CELL_GAP = 16;
const LANE_PAD = 20;
const LANE_HEADER = 56;
const LANE_GAP = 48;
const LANE_MIN_WIDTH = 240;

const ITERATION_RE = /^(.*)#(\d+)$/;

/** `run/002-ingest#3/ingest/005-graph_get` → stage `ingest`, iteration 3. */
export function stageOf(path: string): { stage: string; iteration: number | null } {
  const segment = callLabel(path.split("/")[1] ?? path);
  const match = ITERATION_RE.exec(segment);
  return match ? { stage: match[1], iteration: Number(match[2]) } : { stage: segment, iteration: null };
}

interface Settling extends SimulationNodeDatum {
  id: string;
}

interface Settled {
  width: number;
  height: number;
  points: Map<string, RunGraphPoint>;
}

/** The nodes of one cell, settled by the links among them; the origin is the cell's top left. */
function settle(ids: string[], links: Array<{ source: string; target: string }>): Settled {
  const nodes: Settling[] = ids.map((id) => ({ id }));
  forceSimulation(nodes)
    .force(
      "link",
      forceLink<Settling, { source: string; target: string }>(links.map((l) => ({ ...l })))
        .id((d) => d.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(CHARGE))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .force("x", forceX(0).strength(GRAVITY))
    .force("y", forceY(0).strength(GRAVITY))
    .stop()
    .tick(TICKS);

  const xs = nodes.map((n) => n.x ?? 0);
  const ys = nodes.map((n) => n.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const points = new Map<string, RunGraphPoint>();
  for (const node of nodes) {
    points.set(node.id, { x: (node.x ?? 0) - minX + CELL_PAD, y: (node.y ?? 0) - minY + CELL_PAD });
  }
  return {
    width: Math.max(...xs) - minX + 2 * CELL_PAD,
    height: Math.max(...ys) - minY + 2 * CELL_PAD,
    points,
  };
}

interface Group {
  iteration: number | null;
  ids: string[];
}

interface Stage {
  stage: string;
  calls: number;
  groups: Map<number | null, Group>;
}

/**
 * Place `nodeIds` for a canvas about `aspect` times as wide as it is tall.
 * A node the calls never touched is left out.
 */
export function layoutRunGraph(
  calls: RunGraphCall[],
  nodeIds: string[],
  links: Array<{ source: string; target: string }>,
  aspect = 1.6,
): RunGraphLayout {
  const wanted = new Set(nodeIds);
  const stages = new Map<string, Stage>();
  const groupOf = new Map<string, Group>();
  for (const call of calls) {
    const { stage, iteration } = stageOf(call.path);
    let entry = stages.get(stage);
    if (!entry) {
      entry = { stage, calls: 0, groups: new Map() };
      stages.set(stage, entry);
    }
    entry.calls++;
    for (const node of call.nodes) {
      if (!wanted.has(node.ref_id) || groupOf.has(node.ref_id)) continue;
      let group = entry.groups.get(iteration);
      if (!group) {
        group = { iteration, ids: [] };
        entry.groups.set(iteration, group);
      }
      group.ids.push(node.ref_id);
      groupOf.set(node.ref_id, group);
    }
  }

  const within = new Map<Group, Array<{ source: string; target: string }>>();
  for (const link of links) {
    const group = groupOf.get(link.source);
    if (!group || group !== groupOf.get(link.target)) continue;
    const list = within.get(group);
    if (list) list.push(link);
    else within.set(group, [link]);
  }

  const settled = [...stages.values()].map((s) => {
    const looped = [...s.groups.keys()].some((iteration) => iteration !== null);
    const cells = [...s.groups.values()]
      .sort((a, b) => (a.iteration ?? -1) - (b.iteration ?? -1))
      .map((group) => {
        const cell = settle(group.ids, within.get(group) ?? []);
        return { group, ...cell, header: looped ? CELL_HEADER : 0 };
      });
    return { ...s, cells };
  });

  const footprint = (c: { width: number; height: number; header: number }) =>
    (c.width + CELL_GAP) * (c.height + c.header + CELL_GAP);
  const area = settled.reduce((sum, s) => sum + s.cells.reduce((a, c) => a + footprint(c), 0), 0);
  const targetHeight = Math.sqrt(area / aspect) || 1;

  const positions = new Map<string, RunGraphPlace>();
  const lanes: RunGraphLane[] = [];
  let laneX = 0;
  for (const s of settled) {
    const widest = Math.max(0, ...s.cells.map((c) => c.width));
    const rowWidth = Math.max(widest, s.cells.reduce((a, c) => a + footprint(c), 0) / targetHeight);
    const cells: RunGraphCell[] = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let right = 0;
    for (const cell of s.cells) {
      const height = cell.height + cell.header;
      if (x > 0 && x + cell.width > rowWidth) {
        x = 0;
        y += rowHeight + CELL_GAP;
        rowHeight = 0;
      }
      const left = laneX + LANE_PAD + x;
      const top = LANE_HEADER + y;
      cells.push({
        iteration: cell.group.iteration,
        nodes: cell.group.ids.length,
        x: left,
        y: top,
        width: cell.width,
        height,
      });
      const key = `${s.stage}#${cell.group.iteration ?? ""}`;
      for (const [id, point] of cell.points) {
        positions.set(id, { x: left + point.x, y: top + cell.header + point.y, cell: key });
      }
      x += cell.width + CELL_GAP;
      right = Math.max(right, x - CELL_GAP);
      rowHeight = Math.max(rowHeight, height);
    }
    const width = Math.max(LANE_MIN_WIDTH, right + 2 * LANE_PAD);
    lanes.push({
      stage: s.stage,
      calls: s.calls,
      nodes: cells.reduce((sum, c) => sum + c.nodes, 0),
      cells,
      x: laneX,
      y: 0,
      width,
      height: LANE_HEADER + y + rowHeight + LANE_PAD,
    });
    laneX += width + LANE_GAP;
  }

  const height = Math.max(0, ...lanes.map((l) => l.height));
  for (const lane of lanes) lane.height = height;
  return { width: Math.max(0, laneX - LANE_GAP), height, positions, lanes };
}
