/**
 * Unit tests for `lib/strut-run-graph/layout.ts`: the nodes of a run placed
 * in every stage that touched them, each under the lineage it descends from.
 */

import { describe, it, expect } from "vitest";
import {
  cellOf,
  layoutRunGraph,
  placeKey,
  RUN_GRAPH_NODE_RADIUS,
  stageOf,
  type RunGraphBox,
  type RunGraphLayout,
} from "@/lib/strut-run-graph/layout";
import { lineageParents } from "@/lib/strut-run-graph/lineage";
import type { RunGraphCall } from "@/lib/strut-run-graph/types";

function call(path: string, refs: string[]): RunGraphCall {
  return {
    path,
    tool: "graph_graph_get",
    by: "agent",
    access: "read",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    query: {},
    nodes: refs.map((ref_id) => ({ ref_id })),
  };
}

const CALLS = [
  call("wf/seed/001-graph_graph_search", ["a", "b"]),
  call("wf/ingest#1/ingest/001-graph_create_batch_triplet", ["d1", "f1", "f2"]),
  call("wf/ingest#0/ingest/001-graph_create_batch_triplet", ["d0", "f0", "b"]),
  call("wf/seed/002-graph_graph_get", ["c", "a"]),
  call("wf/003-produce", ["p", "d0"]),
];
const IDS = ["a", "b", "c", "d0", "f0", "d1", "f1", "f2", "p"];
const LINKS = [
  { source: "d0", target: "f0" },
  { source: "d1", target: "f1" },
  { source: "d1", target: "f2" },
  { source: "d0", target: "f1" },
];

const inside = (point: { x: number; y: number }, box: RunGraphBox) =>
  point.x - RUN_GRAPH_NODE_RADIUS >= box.x &&
  point.x + RUN_GRAPH_NODE_RADIUS <= box.x + box.width &&
  point.y - RUN_GRAPH_NODE_RADIUS >= box.y &&
  point.y + RUN_GRAPH_NODE_RADIUS <= box.y + box.height;

const at = (layout: RunGraphLayout, cell: string, id: string) => layout.places.get(placeKey(cell, id));
const idsIn = (layout: RunGraphLayout, cell: string) =>
  [...layout.places.values()].filter((p) => p.cell === cell).map((p) => p.id);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("stageOf", () => {
  it("is the step under the run, without its counter or its iteration", () => {
    expect(stageOf("wf/seed/001-graph_graph_search")).toEqual({ stage: "seed", iteration: null });
    expect(stageOf("wf/002-ingest#3/ingest/005-graph_graph_get")).toEqual({ stage: "ingest", iteration: 3 });
    expect(stageOf("wf/003-produce")).toEqual({ stage: "produce", iteration: null });
  });

  it("names the cell a call is in", () => {
    expect(cellOf("wf/seed/001-graph_graph_search")).toBe("seed#");
    expect(cellOf("wf/002-ingest#3/ingest/005-graph_graph_get")).toBe("ingest#3");
  });
});

describe("layoutRunGraph", () => {
  const layout = layoutRunGraph(CALLS, IDS, LINKS);

  it("makes a lane of each stage, in the order the run reached them", () => {
    expect(layout.lanes.map((l) => [l.stage, l.calls, l.nodes])).toEqual([
      ["seed", 2, 3],
      ["ingest", 2, 6],
      ["produce", 1, 2],
    ]);
    const [seed, ingest, produce] = layout.lanes;
    expect(seed.x + seed.width).toBeLessThan(ingest.x);
    expect(ingest.x + ingest.width).toBeLessThan(produce.x);
    expect(layout.callCells).toEqual(["seed#", "ingest#1", "ingest#0", "seed#", "produce#"]);
  });

  it("makes a cell of each iteration of a stage that loops, in their order", () => {
    const [seed, ingest] = layout.lanes;
    expect(seed.cells.map((c) => c.iteration)).toEqual([null]);
    expect(ingest.cells.map((c) => [c.iteration, c.nodes])).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it("names the branch of the run each lane is, or each cell when the lane loops", () => {
    expect(layout.lanes.map((l) => [l.stage, l.path])).toEqual([
      ["seed", "seed"],
      ["ingest", null],
      ["produce", "003-produce"],
    ]);
    expect(layout.lanes[1].cells.map((c) => c.path)).toEqual(["ingest#0", "ingest#1"]);
    expect(layout.lanes[2].cells.map((c) => c.path)).toEqual(["003-produce"]);
  });

  it("draws a node in every cell whose calls touched it, once per cell", () => {
    expect(idsIn(layout, "seed#")).toEqual(["a", "b", "c"]);
    expect(idsIn(layout, "ingest#0")).toEqual(["d0", "f0", "b"]);
    expect(idsIn(layout, "ingest#1")).toEqual(["d1", "f1", "f2"]);
    expect(idsIn(layout, "produce#")).toEqual(["p", "d0"]);
    expect(layout.places.size).toBe(11);
  });

  it("dates each drawing from the first of the cell's calls that touched it", () => {
    expect(at(layout, "seed#", "a")?.since).toBe(0);
    expect(at(layout, "seed#", "c")?.since).toBe(3);
    expect(at(layout, "ingest#0", "b")?.since).toBe(2);
    expect(at(layout, "produce#", "d0")?.since).toBe(4);
  });

  it("keeps every lane and drawing within its bounds, and a cell's nodes apart", () => {
    const [seed, ingest, produce] = layout.lanes;
    for (const id of ["a", "b", "c"]) expect(inside(at(layout, "seed#", id)!, seed.cells[0])).toBe(true);
    for (const id of ["d0", "f0", "b"]) expect(inside(at(layout, "ingest#0", id)!, ingest.cells[0])).toBe(true);
    for (const id of ["d1", "f1", "f2"]) expect(inside(at(layout, "ingest#1", id)!, ingest.cells[1])).toBe(true);
    for (const id of ["p", "d0"]) expect(inside(at(layout, "produce#", id)!, produce.cells[0])).toBe(true);
    for (const lane of layout.lanes) {
      expect(lane.x + lane.width).toBeLessThanOrEqual(layout.width);
      expect(lane.height).toBe(layout.height);
      for (const cell of lane.cells)
        expect(inside({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }, lane)).toBe(true);
    }
    const places = [...layout.places.values()];
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        if (places[i].cell !== places[j].cell) continue;
        expect(distance(places[i], places[j])).toBeGreaterThan(2 * RUN_GRAPH_NODE_RADIUS);
      }
    }
  });

  it("places the same run the same way", () => {
    expect([...layoutRunGraph(CALLS, IDS, LINKS).places]).toEqual([...layout.places]);
  });

  it("leaves a finished cell where it was when the run goes on", () => {
    const longer = layoutRunGraph(
      [...CALLS, call("wf/ingest#2/ingest/001-graph_create_batch_triplet", ["d2", "f3", "d0"])],
      [...IDS, "d2", "f3"],
      [...LINKS, { source: "d2", target: "f3" }],
    );
    const offset = (id: string, from: RunGraphLayout) => {
      const cell = from.lanes[1].cells[0];
      const point = at(from, "ingest#0", id)!;
      return { x: point.x - cell.x, y: point.y - cell.y };
    };
    expect(offset("d0", longer)).toEqual(offset("d0", layout));
    expect(offset("f0", longer)).toEqual(offset("f0", layout));
    expect(idsIn(longer, "ingest#2")).toEqual(["d2", "f3", "d0"]);
  });

  it("places only the nodes it was asked for, and leaves a stage with none of them an empty lane", () => {
    const some = layoutRunGraph(CALLS, ["a", "d1"], []);
    expect([...some.places.keys()]).toEqual(["seed#|a", "ingest#1|d1"]);
    expect(some.lanes.map((l) => [l.stage, l.nodes, l.cells.length])).toEqual([
      ["seed", 1, 1],
      ["ingest", 1, 1],
      ["produce", 0, 0],
    ]);
    expect(some.lanes[2].width).toBeGreaterThan(0);
    expect(some.lanes[2].height).toBe(some.height);
  });

  it("is empty for a run that touched nothing", () => {
    expect(layoutRunGraph([], [], [])).toEqual({
      width: 0,
      height: 0,
      places: new Map(),
      lanes: [],
      callCells: [],
    });
  });
});

describe("layoutRunGraph with a lineage", () => {
  // Medicine → Problem List → two rules; Medicine → Clinical Timeline. The run read the rules and the timeline.
  const EDGES = [
    { source: "medicine", target: "list", edge_type: "PARENT_OF" },
    { source: "list", target: "rule1", edge_type: "PARENT_OF" },
    { source: "list", target: "rule2", edge_type: "PARENT_OF" },
    { source: "medicine", target: "timeline", edge_type: "PARENT_OF" },
  ];
  const PARENTS = lineageParents(EDGES);
  const TREE_IDS = ["medicine", "list", "rule1", "rule2", "timeline"];
  const PLAN = [
    call("wf/plan/001-graph_graph_get", ["rule1"]),
    call("wf/plan/002-graph_graph_get", ["rule2", "timeline"]),
    call("wf/walk/001-graph_graph_get", ["medicine"]),
  ];
  const layout = layoutRunGraph(PLAN, TREE_IDS, EDGES, PARENTS);

  it("draws, with each touched node, the lineage above it, dated from the node it came with", () => {
    expect(idsIn(layout, "plan#").sort()).toEqual([...TREE_IDS].sort());
    expect(at(layout, "plan#", "rule1")?.since).toBe(0);
    expect(at(layout, "plan#", "list")?.since).toBe(0);
    expect(at(layout, "plan#", "medicine")?.since).toBe(0);
    expect(at(layout, "plan#", "timeline")?.since).toBe(1);
    // The walk touched the root alone: nothing is above it.
    expect(idsIn(layout, "walk#")).toEqual(["medicine"]);
    expect(layout.lanes.map((l) => [l.stage, l.nodes])).toEqual([
      ["plan", 5],
      ["walk", 1],
    ]);
  });

  it("draws a tree as rings around its root, one ring per level", () => {
    const root = at(layout, "plan#", "medicine")!;
    const ring1 = ["list", "timeline"].map((id) => distance(root, at(layout, "plan#", id)!));
    const ring2 = ["rule1", "rule2"].map((id) => distance(root, at(layout, "plan#", id)!));
    expect(ring1[0]).toBeCloseTo(ring1[1], 6);
    expect(ring2[0]).toBeCloseTo(ring2[1], 6);
    expect(ring2[0]).toBeCloseTo(2 * ring1[0], 6);
    expect(ring1[0]).toBeGreaterThan(2 * RUN_GRAPH_NODE_RADIUS);
    // The rules fan out from their parent, not across the root.
    const list = at(layout, "plan#", "list")!;
    for (const id of ["rule1", "rule2"]) expect(distance(list, at(layout, "plan#", id)!)).toBeLessThan(ring2[0]);
  });

  it("leaves out an ancestor it was not asked for, and roots the tree below it", () => {
    const without = layoutRunGraph(PLAN, ["list", "rule1", "rule2", "timeline"], EDGES, PARENTS);
    expect(idsIn(without, "plan#").sort()).toEqual(["list", "rule1", "rule2", "timeline"]);
    const list = at(without, "plan#", "list")!;
    expect(distance(list, at(without, "plan#", "rule1")!)).toBeCloseTo(
      distance(list, at(without, "plan#", "rule2")!),
      6,
    );
    expect(idsIn(without, "walk#")).toEqual([]);
  });

  it("draws what the lineage does not reach beside the tree, apart from it", () => {
    const EXTRA = [...EDGES, { source: "doc", target: "finding", edge_type: "CONTAINS" }];
    const mixed = layoutRunGraph(
      [call("wf/plan/001-graph_graph_get", ["rule1", "doc", "finding", "loose"])],
      [...TREE_IDS, "doc", "finding", "loose"],
      EXTRA,
      PARENTS,
    );
    const places = [...mixed.places.values()];
    expect(places.map((p) => p.id).sort()).toEqual(["doc", "finding", "list", "loose", "medicine", "rule1"]);
    const cell = mixed.lanes[0].cells[0];
    for (const place of places) expect(inside(place, cell)).toBe(true);
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        expect(distance(places[i], places[j])).toBeGreaterThan(2 * RUN_GRAPH_NODE_RADIUS);
      }
    }
  });
});
