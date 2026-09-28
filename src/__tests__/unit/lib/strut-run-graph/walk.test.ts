/**
 * Unit tests for `lib/strut-run-graph/walk.ts`: the hops a run took, the
 * links the viewer draws, and how a link is drawn at a step of a replay.
 */

import { describe, it, expect } from "vitest";
import type { RunGraphCall, RunGraphQueryValue } from "@/lib/strut-run-graph/types";
import { linkState, runGraphHops, runGraphLinks } from "@/lib/strut-run-graph/walk";

function call(tool: string, query: Record<string, RunGraphQueryValue>, refs: string[]): RunGraphCall {
  return {
    path: `wf/seed/001-${tool}`,
    tool,
    by: "agent",
    access: "read",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    query,
    nodes: refs.map((ref_id) => ({ ref_id })),
  };
}

const CALLS = [
  call("graph_graph_search", { q: "problem list" }, ["a", "b"]),
  call("graph_graph_get", { ref_id: "a" }, ["a"]),
  call("graph_graph_neighbors", { ref_id: "a" }, ["a", "b", "c"]),
  call("graph_graph_neighbors", { ref_id: "c" }, ["c", "a"]),
];

describe("runGraphHops", () => {
  it("reads a hop from the node a call named to each other node it touched", () => {
    expect(runGraphHops(CALLS)).toEqual([
      { source: "a", target: "b", call: 2 },
      { source: "a", target: "c", call: 2 },
      { source: "c", target: "a", call: 3 },
    ]);
  });

  it("reads none from a call that named a node it did not touch", () => {
    expect(runGraphHops([call("graph_graph_neighbors", { ref_id: "gone" }, ["a", "b"])])).toEqual([]);
  });
});

describe("runGraphLinks", () => {
  const hops = runGraphHops(CALLS);

  it("lays a hop over the graph's edge between its nodes, whichever way the edge points", () => {
    const links = runGraphLinks(
      [
        { source: "b", target: "a", edge_type: "CONTAINS" },
        { source: "a", target: "c", edge_type: "PARENT_OF" },
        { source: "b", target: "d", edge_type: "CONTAINS" },
      ],
      hops,
    );

    expect(links.map((l) => [l.source, l.edgeType, l.target, l.hops.map((h) => h.call)])).toEqual([
      ["b", "CONTAINS", "a", [2]],
      ["a", "PARENT_OF", "c", [2, 3]],
      ["b", "CONTAINS", "d", []],
    ]);
  });

  it("draws a hop of its own when the graph gave no edge for it", () => {
    const links = runGraphLinks([], hops);

    expect(links.map((l) => [l.source, l.edgeType, l.target, l.hops.map((h) => h.call)])).toEqual([
      ["a", null, "b", [2]],
      ["a", null, "c", [2, 3]],
    ]);
  });

  it("leaves out an edge from a node to itself", () => {
    expect(runGraphLinks([{ source: "a", target: "a", edge_type: "SAME_AS" }], [])).toEqual([]);
  });
});

describe("linkState", () => {
  const [edge] = runGraphLinks([{ source: "a", target: "c", edge_type: "PARENT_OF" }], runGraphHops(CALLS));
  const [, bare] = runGraphLinks([], runGraphHops(CALLS));

  it("is an edge until a call takes a hop along it", () => {
    expect(linkState(edge, 1)).toEqual({ state: "edge", hop: null });
  });

  it("is current at the step of the call that took the hop, walked after", () => {
    expect(linkState(edge, 2)).toEqual({ state: "current", hop: { source: "a", target: "c", call: 2 } });
    expect(linkState(edge, 3)).toEqual({ state: "current", hop: { source: "c", target: "a", call: 3 } });
  });

  it("is walked for the whole run, by its last hop", () => {
    expect(linkState(edge, null)).toEqual({ state: "walked", hop: { source: "c", target: "a", call: 3 } });
  });

  it("is hidden until its hop when there is no edge under it", () => {
    expect(linkState(bare, 1).state).toBe("hidden");
    expect(linkState(bare, 2).state).toBe("current");
  });
});
