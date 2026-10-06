/**
 * Unit tests for `lib/strut-run-graph/lineage.ts`: each node's parents along
 * `PARENT_OF`, and everything above a set of nodes.
 */

import { describe, it, expect } from "vitest";
import { ancestorsOf, isLineageEdge, lineageParents } from "@/lib/strut-run-graph/lineage";

const EDGES = [
  { source: "medicine", target: "list", edge_type: "PARENT_OF" },
  { source: "list", target: "rule", edge_type: "PARENT_OF" },
  { source: "medicine", target: "timeline", edge_type: "PARENT_OF" },
  { source: "doc", target: "rule", edge_type: "MENTIONS" },
  { source: "rule", target: "rule", edge_type: "PARENT_OF" },
  { source: "list", target: "rule", edge_type: "PARENT_OF" },
  { source: "coding", target: "rule", edge_type: "PARENT_OF" },
];

describe("lineageParents", () => {
  it("reads each node's parents from the PARENT_OF edges, once each, in order", () => {
    expect([...lineageParents(EDGES)]).toEqual([
      ["list", ["medicine"]],
      ["rule", ["list", "coding"]],
      ["timeline", ["medicine"]],
    ]);
  });

  it("knows a lineage edge from any other", () => {
    expect(isLineageEdge(EDGES[0])).toBe(true);
    expect(isLineageEdge(EDGES[3])).toBe(false);
  });
});

describe("ancestorsOf", () => {
  const parents = lineageParents(EDGES);

  it("is everything above the nodes, nearest first, through every parent", () => {
    expect(ancestorsOf(["rule"], parents)).toEqual(["list", "coding", "medicine"]);
    expect(ancestorsOf(["rule", "timeline"], parents)).toEqual(["list", "coding", "medicine"]);
  });

  it("is never one of the nodes themselves", () => {
    expect(ancestorsOf(["rule", "list"], parents)).toEqual(["coding", "medicine"]);
    expect(ancestorsOf(["medicine"], parents)).toEqual([]);
  });

  it("ends on a lineage that goes round", () => {
    const round = lineageParents([
      { source: "a", target: "b", edge_type: "PARENT_OF" },
      { source: "b", target: "a", edge_type: "PARENT_OF" },
    ]);
    expect(ancestorsOf(["a"], round)).toEqual(["b"]);
  });
});
