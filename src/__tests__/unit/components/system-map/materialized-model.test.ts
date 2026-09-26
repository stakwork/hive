/**
 * Unit tests for `MaterializedGraph/model.ts` — the lenient parser for the
 * `swarm-systemmap-graph-materialize` output.
 *
 * Coverage: flat `{nodes, edges}`; nested under `result.graph`; Neo4j-style
 * items (`ref_id`, `labels`, `properties`, `relationships` with `from`/`to`);
 * dangling edges dropped and counted; stats and note surfaced; type counts
 * and colours in first-seen order; non-graph output → null.
 */

import { describe, it, expect } from "vitest";
import { nodeTypeColorMap, parseMaterializedGraph } from "@/components/system-map/MaterializedGraph/model";

describe("parseMaterializedGraph", () => {
  it("reads a flat nodes/edges output with counts", () => {
    const g = parseMaterializedGraph({
      nodes: [
        { id: "svc-api", name: "API", type: "SysAPIService", repo: "acme/api" },
        { id: "db-1", name: "Postgres", type: "SysDatabaseInstance" },
        { id: "svc-web", name: "Web", type: "SysAPIService" },
      ],
      edges: [
        { source: "svc-api", target: "db-1", edge_type: "READS_FROM" },
        { source: "svc-web", target: "svc-api", edge_type: "CALLS" },
      ],
      created: 3,
      skipped: 1,
      summary: "Wrote 3 nodes.",
    })!;
    expect(g.nodes.map((n) => n.id)).toEqual(["svc-api", "db-1", "svc-web"]);
    expect(g.nodes[0].properties).toEqual({ repo: "acme/api" });
    expect(g.edges.map((e) => e.label)).toEqual(["READS_FROM", "CALLS"]);
    expect(g.nodeTypes).toEqual([
      { type: "SysAPIService", count: 2 },
      { type: "SysDatabaseInstance", count: 1 },
    ]);
    expect(g.edgeTypes).toEqual([
      { type: "READS_FROM", count: 1 },
      { type: "CALLS", count: 1 },
    ]);
    expect(g.stats).toEqual([
      { label: "created", value: 3 },
      { label: "skipped", value: 1 },
    ]);
    expect(g.note).toBe("Wrote 3 nodes.");
    expect(g.danglingEdges).toBe(0);
  });

  it("finds the graph nested in the output and reads Neo4j-style items", () => {
    const g = parseMaterializedGraph({
      note: "materialized",
      result: {
        graph: {
          nodes: [
            { ref_id: "a", labels: ["SysComponent"], properties: { name: "Alpha", owner: "team-a" } },
            { ref_id: "b", labels: ["SysResource"], properties: { name: "Bravo" } },
          ],
          relationships: [{ from: "a", to: "b", type: "RUNS_ON" }],
        },
        counts: { nodes_written: 2, edges_written: 1 },
      },
    })!;
    expect(g.nodes.map((n) => [n.id, n.name, n.type])).toEqual([
      ["a", "Alpha", "SysComponent"],
      ["b", "Bravo", "SysResource"],
    ]);
    expect(g.nodes[0].properties).toEqual({ owner: "team-a" });
    expect(g.edges).toEqual([{ source: "a", target: "b", label: "RUNS_ON", properties: {} }]);
    expect(g.note).toBe("materialized");
    expect(g.stats).toEqual([]);
  });

  it("accepts edge endpoints given as objects and drops dangling edges", () => {
    const g = parseMaterializedGraph({
      nodes: [{ id: "x", name: "X", type: "T" }],
      edges: [
        { source: { id: "x" }, target: { id: "x" }, label: "SELF" },
        { source: "x", target: "ghost", label: "OUT" },
      ],
    })!;
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].label).toBe("SELF");
    expect(g.danglingEdges).toBe(1);
  });

  it("returns null for output without a graph", () => {
    expect(parseMaterializedGraph("done")).toBeNull();
    expect(parseMaterializedGraph({ summary: { counts: { MATCH: 1 } }, nodeTypes: [] })).toBeNull();
    expect(parseMaterializedGraph(null)).toBeNull();
  });
});

describe("nodeTypeColorMap", () => {
  it("assigns fixed colours in first-seen order and grey past eight", () => {
    const types = Array.from({ length: 10 }, (_, i) => ({ type: `T${i}` }));
    const map = nodeTypeColorMap(types);
    expect(map.T0).toBe("#2563eb");
    expect(map.T7).toBe("#ea580c");
    expect(map.T8).toBe("#94a3b8");
    expect(map.T9).toBe("#94a3b8");
  });
});
