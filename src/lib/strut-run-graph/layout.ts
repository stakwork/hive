/**
 * Where the viewer draws a run's nodes: by the stages of the run that
 * touched them. Pure, and the same for the same input.
 *
 * A stage is a step directly under the run. Stages are lanes, left to right
 * in the order the run reached them; a stage that loops has one cell per
 * iteration. A cell draws every node its own calls touched — a node two
 * stages read is drawn in both — and, above each of them, its lineage: the
 * nodes it descends from along `PARENT_OF`, up to the root of its tree,
 * whether or not the run touched those. A tree is drawn as rings around its
 * root, one ring per level; anything else in the cell settles by the links
 * among it. A cell depends on nothing outside itself, so a finished cell
 * stays as it was while the run goes on.
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3";
import { ancestorsOf } from "./lineage";
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
  /** Nodes drawn in the cell. */
  nodes: number;
}

export interface RunGraphLane extends RunGraphBox {
  stage: string;
  calls: number;
  /** Nodes drawn in the lane, over its cells. */
  nodes: number;
  cells: RunGraphCell[];
}

export interface RunGraphPoint {
  x: number;
  y: number;
}

/** One drawing of a node: a node is drawn once in each cell whose calls touched it. */
export interface RunGraphPlace extends RunGraphPoint {
  id: string;
  cell: string;
  /** Index of the first call that puts it in the picture: one of the cell's touching it, or a node under it. */
  since: number;
}

export interface RunGraphLayout {
  width: number;
  height: number;
  /** Every drawing of a node, keyed by `placeKey`. */
  places: Map<string, RunGraphPlace>;
  lanes: RunGraphLane[];
  /** The cell each call is in, by its index. */
  callCells: string[];
}

/** Radius a node is drawn with. */
export const RUN_GRAPH_NODE_RADIUS = 12;

const LINK_DISTANCE = 64;
const CHARGE = -160;
const COLLIDE_RADIUS = 28;
const GRAVITY = 0.12;
const TICKS = 200;

/** The least arc two neighbours on a ring are apart: room for a node and most of its name. */
const MIN_ARC = 80;
/** The widest fan a node's children spread over — the root's spread all the way round. */
const MAX_FAN = (2 * Math.PI) / 3;

const CELL_PAD = 32;
const CELL_HEADER = 28;
const CELL_GAP = 16;
/** Between the separate parts of one cell: a tree, a cluster, the loose nodes. */
const PART_GAP = 48;
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

/** The key of a stage's cell: `ingest#3`, `seed#`. */
export function cellKey(stage: string, iteration: number | null): string {
  return `${stage}#${iteration ?? ""}`;
}

/** The cell a call is in. */
export function cellOf(path: string): string {
  const { stage, iteration } = stageOf(path);
  return cellKey(stage, iteration);
}

export function placeKey(cell: string, id: string): string {
  return `${cell}|${id}`;
}

type Link = { source: string; target: string };

/** Nodes placed together, the origin at their top left. */
interface Part {
  width: number;
  height: number;
  points: Map<string, RunGraphPoint>;
}

/** The points moved so the least of them is at the origin, and the box they fill. */
function boxed(points: Map<string, RunGraphPoint>): Part {
  const xs = [...points.values()].map((p) => p.x);
  const ys = [...points.values()].map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const moved = new Map<string, RunGraphPoint>();
  for (const [id, p] of points) moved.set(id, { x: p.x - minX, y: p.y - minY });
  return { width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, points: moved };
}

interface Settling extends SimulationNodeDatum {
  id: string;
}

/** The nodes settled by the links among them; a pinned node stays where it is put. */
function settle(ids: string[], links: Link[], pinned: ReadonlyMap<string, RunGraphPoint>): Part {
  const nodes: Settling[] = ids.map((id) => {
    const pin = pinned.get(id);
    return pin ? { id, x: pin.x, y: pin.y, fx: pin.x, fy: pin.y } : { id };
  });
  forceSimulation(nodes)
    .force(
      "link",
      forceLink<Settling, Link>(links.map((l) => ({ ...l })))
        .id((d) => d.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(CHARGE))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .force("x", forceX(0).strength(GRAVITY))
    .force("y", forceY(0).strength(GRAVITY))
    .stop()
    .tick(TICKS);
  return boxed(new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
}

/**
 * A tree as rings around its root: each level one ring out, each subtree
 * within the slice of the circle its leaves earn. Below the root a node's
 * children fan out over no more than `MAX_FAN`, centred on it, so a chain
 * of single children stays on one side. The rings are far enough apart
 * that no two neighbours on one come closer than `MIN_ARC`.
 */
function radialTree(root: string, children: ReadonlyMap<string, string[]>): Map<string, RunGraphPoint> {
  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const known = leaves.get(id);
    if (known !== undefined) return known;
    const kids = children.get(id) ?? [];
    const count = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + countLeaves(kid), 0);
    leaves.set(id, count);
    return count;
  };
  countLeaves(root);

  const angle = new Map<string, number>();
  const depth = new Map<string, number>();
  const fan = new Map<string, number>();
  const assign = (id: string, level: number, start: number, span: number) => {
    const mid = start + span / 2;
    angle.set(id, mid);
    depth.set(id, level);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const spread = level === 0 ? span : Math.min(span, MAX_FAN);
    fan.set(id, spread);
    let from = mid - spread / 2;
    for (const kid of kids) {
      const slice = (spread * countLeaves(kid)) / countLeaves(id);
      assign(kid, level + 1, from, slice);
      from += slice;
    }
  };
  assign(root, 0, -Math.PI / 2, 2 * Math.PI);

  let gap = LINK_DISTANCE;
  for (const [id, spread] of fan) {
    gap = Math.max(gap, (countLeaves(id) * MIN_ARC) / (spread * ((depth.get(id) ?? 0) + 1)));
  }

  const points = new Map<string, RunGraphPoint>();
  for (const [id, a] of angle) {
    const r = (depth.get(id) ?? 0) * gap;
    points.set(id, r === 0 ? { x: 0, y: 0 } : { x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return points;
}

/**
 * One connected part of a cell. The biggest tree in it, by its lineage, is
 * drawn as rings around its root; whatever else is in the part settles
 * around that.
 */
function placePart(ids: string[], links: Link[], parents: ReadonlyMap<string, string[]>): Part {
  const within = new Set(ids);
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const id of ids) {
    const parent = (parents.get(id) ?? []).find((p) => within.has(p) && p !== id);
    if (parent === undefined) continue;
    parentOf.set(id, parent);
    const kids = children.get(parent);
    if (kids) kids.push(id);
    else children.set(parent, [id]);
  }
  const roots = ids.filter((id) => !parentOf.has(id) && children.has(id));
  if (roots.length === 0) return settle(ids, links, new Map());

  const sizeOf = (id: string): number => 1 + (children.get(id) ?? []).reduce((sum, kid) => sum + sizeOf(kid), 0);
  const root = roots.reduce((best, id) => (sizeOf(id) > sizeOf(best) ? id : best));
  const tree = radialTree(root, children);
  return tree.size === ids.length ? boxed(tree) : settle(ids, links, tree);
}

/** The nodes of one cell: its connected parts side by side, the loose nodes together at the end. */
function placeCell(ids: string[], links: Link[], parents: ReadonlyMap<string, string[]>): Part {
  const within = new Set(ids);
  const inCell = links.filter((l) => l.source !== l.target && within.has(l.source) && within.has(l.target));

  const leader = new Map<string, string>(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let top = id;
    while (leader.get(top) !== top) top = leader.get(top) as string;
    return top;
  };
  for (const link of inCell) leader.set(find(link.source), find(link.target));

  const members = new Map<string, string[]>();
  for (const id of ids) {
    const top = find(id);
    const list = members.get(top);
    if (list) list.push(id);
    else members.set(top, [id]);
  }
  const parts: Part[] = [];
  const loose: string[] = [];
  for (const group of members.values()) {
    if (group.length === 1) loose.push(group[0]);
    else {
      const inGroup = new Set(group);
      parts.push(
        placePart(
          group,
          inCell.filter((l) => inGroup.has(l.source)),
          parents,
        ),
      );
    }
  }
  if (loose.length > 0) parts.push(settle(loose, [], new Map()));
  parts.sort((a, b) => b.points.size - a.points.size);

  const tallest = Math.max(0, ...parts.map((p) => p.height));
  const points = new Map<string, RunGraphPoint>();
  let x = CELL_PAD;
  for (const part of parts) {
    const top = CELL_PAD + (tallest - part.height) / 2;
    for (const [id, p] of part.points) points.set(id, { x: x + p.x, y: top + p.y });
    x += part.width + PART_GAP;
  }
  return { width: x - PART_GAP + CELL_PAD, height: tallest + 2 * CELL_PAD, points };
}

interface Group {
  iteration: number | null;
  ids: string[];
  since: Map<string, number>;
}

interface Stage {
  stage: string;
  calls: number;
  groups: Map<number | null, Group>;
}

/**
 * Place `nodeIds` for a canvas about `aspect` times as wide as it is tall:
 * in each cell, what its calls touched and the lineage above that, by
 * `parents` (each node's parents along `PARENT_OF`). A node not among
 * `nodeIds` is left out, lineage or not.
 */
export function layoutRunGraph(
  calls: RunGraphCall[],
  nodeIds: string[],
  links: Link[],
  parents: ReadonlyMap<string, string[]> = new Map(),
  aspect = 1.6,
): RunGraphLayout {
  const wanted = new Set(nodeIds);
  const stages = new Map<string, Stage>();
  const callCells: string[] = [];
  calls.forEach((call, index) => {
    const { stage, iteration } = stageOf(call.path);
    callCells.push(cellKey(stage, iteration));
    let entry = stages.get(stage);
    if (!entry) {
      entry = { stage, calls: 0, groups: new Map() };
      stages.set(stage, entry);
    }
    entry.calls++;
    const touched = call.nodes.map((n) => n.ref_id);
    for (const id of [...touched, ...ancestorsOf(touched, parents)]) {
      if (!wanted.has(id)) continue;
      let group = entry.groups.get(iteration);
      if (!group) {
        group = { iteration, ids: [], since: new Map() };
        entry.groups.set(iteration, group);
      }
      if (group.since.has(id)) continue;
      group.ids.push(id);
      group.since.set(id, index);
    }
  });

  const settled = [...stages.values()].map((s) => {
    const looped = [...s.groups.keys()].some((iteration) => iteration !== null);
    const cells = [...s.groups.values()]
      .sort((a, b) => (a.iteration ?? -1) - (b.iteration ?? -1))
      .map((group) => ({ group, ...placeCell(group.ids, links, parents), header: looped ? CELL_HEADER : 0 }));
    return { ...s, cells };
  });

  const footprint = (c: { width: number; height: number; header: number }) =>
    (c.width + CELL_GAP) * (c.height + c.header + CELL_GAP);
  const area = settled.reduce((sum, s) => sum + s.cells.reduce((a, c) => a + footprint(c), 0), 0);
  const targetHeight = Math.sqrt(area / aspect) || 1;

  const places = new Map<string, RunGraphPlace>();
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
      const key = cellKey(s.stage, cell.group.iteration);
      for (const [id, point] of cell.points) {
        places.set(placeKey(key, id), {
          id,
          cell: key,
          since: cell.group.since.get(id) ?? 0,
          x: left + point.x,
          y: top + cell.header + point.y,
        });
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
  return { width: Math.max(0, laneX - LANE_GAP), height, places, lanes, callCells };
}
