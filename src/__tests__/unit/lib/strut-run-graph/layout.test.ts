/**
 * Unit tests for `lib/strut-run-graph/layout.ts`: the nodes of a run placed
 * by the stage that first touched them.
 */

import { describe, it, expect } from "vitest";
import { layoutRunGraph, RUN_GRAPH_NODE_RADIUS, stageOf, type RunGraphBox } from "@/lib/strut-run-graph/layout";
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
  call("wf/seed/002-graph_graph_get", ["c"]),
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

describe("stageOf", () => {
  it("is the step under the run, without its counter or its iteration", () => {
    expect(stageOf("wf/seed/001-graph_graph_search")).toEqual({ stage: "seed", iteration: null });
    expect(stageOf("wf/002-ingest#3/ingest/005-graph_graph_get")).toEqual({ stage: "ingest", iteration: 3 });
    expect(stageOf("wf/003-produce")).toEqual({ stage: "produce", iteration: null });
  });
});

describe("layoutRunGraph", () => {
  const layout = layoutRunGraph(CALLS, IDS, LINKS);

  it("makes a lane of each stage, in the order the run reached them", () => {
    expect(layout.lanes.map((l) => [l.stage, l.calls, l.nodes])).toEqual([
      ["seed", 2, 3],
      ["ingest", 2, 5],
      ["produce", 1, 1],
    ]);
    const [seed, ingest, produce] = layout.lanes;
    expect(seed.x + seed.width).toBeLessThan(ingest.x);
    expect(ingest.x + ingest.width).toBeLessThan(produce.x);
  });

  it("makes a cell of each iteration of a stage that loops, in their order", () => {
    const [seed, ingest] = layout.lanes;
    expect(seed.cells.map((c) => c.iteration)).toEqual([null]);
    expect(ingest.cells.map((c) => [c.iteration, c.nodes])).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it("puts a node where the run first touched it", () => {
    const [seed, ingest, produce] = layout.lanes;
    // `b` was found by the seed before an ingest read it; `d0` written by an ingest before produce read it.
    expect(layout.positions.get("b")?.cell).toBe("seed#");
    expect(layout.positions.get("d0")?.cell).toBe("ingest#0");
    for (const id of ["a", "b", "c"]) expect(inside(layout.positions.get(id)!, seed.cells[0])).toBe(true);
    for (const id of ["d0", "f0"]) expect(inside(layout.positions.get(id)!, ingest.cells[0])).toBe(true);
    for (const id of ["d1", "f1", "f2"]) expect(inside(layout.positions.get(id)!, ingest.cells[1])).toBe(true);
    expect(inside(layout.positions.get("p")!, produce.cells[0])).toBe(true);
  });

  it("keeps every lane and node within its bounds, and the nodes apart", () => {
    for (const lane of layout.lanes) {
      expect(lane.x + lane.width).toBeLessThanOrEqual(layout.width);
      expect(lane.height).toBe(layout.height);
      for (const cell of lane.cells)
        expect(inside({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }, lane)).toBe(true);
    }
    const points = [...layout.positions.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(distance).toBeGreaterThan(2 * RUN_GRAPH_NODE_RADIUS);
      }
    }
  });

  it("places the same run the same way", () => {
    expect([...layoutRunGraph(CALLS, IDS, LINKS).positions]).toEqual([...layout.positions]);
  });

  it("leaves a finished cell where it was when the run goes on", () => {
    const longer = layoutRunGraph(
      [...CALLS, call("wf/ingest#2/ingest/001-graph_create_batch_triplet", ["d2", "f3"])],
      [...IDS, "d2", "f3"],
      [...LINKS, { source: "d2", target: "f3" }],
    );
    const offset = (id: string, from: typeof layout) => {
      const cell = from.lanes[1].cells[0];
      const point = from.positions.get(id)!;
      return { x: point.x - cell.x, y: point.y - cell.y };
    };
    expect(offset("d0", longer)).toEqual(offset("d0", layout));
    expect(offset("f0", longer)).toEqual(offset("f0", layout));
  });

  it("places only the nodes it was asked for, and leaves a stage with none of them an empty lane", () => {
    const some = layoutRunGraph(CALLS, ["a", "d1"], []);
    expect([...some.positions.keys()]).toEqual(["a", "d1"]);
    expect(some.lanes.map((l) => [l.stage, l.nodes, l.cells.length])).toEqual([
      ["seed", 1, 1],
      ["ingest", 1, 1],
      ["produce", 0, 0],
    ]);
    expect(some.lanes[2].width).toBeGreaterThan(0);
    expect(some.lanes[2].height).toBe(some.height);
  });

  it("is empty for a run that touched nothing", () => {
    expect(layoutRunGraph([], [], [])).toEqual({ width: 0, height: 0, positions: new Map(), lanes: [] });
  });
});
