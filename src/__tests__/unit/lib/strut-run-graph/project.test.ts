/**
 * Unit tests for `lib/strut-run-graph/project.ts`: strut run events → the
 * run's graph calls.
 *
 * Coverage:
 *   - a call is a `step.end` that carries `nodes`, whoever ran the step;
 *   - the call keeps the allowlisted scalar query fields of its
 *     `step.start` input and nothing else — no node payload, no output;
 *   - reads and writes are told apart by the step's name;
 *   - a search keeps its place among the calls and the count of what it
 *     matched, and none of its hits as nodes;
 *   - node refs are deduplicated and malformed ones dropped.
 */

import { describe, it, expect } from "vitest";
import { accessOf, distinctNodeRefs, isSearch, projectRunGraphCalls } from "@/lib/strut-run-graph/project";

const start = (path: string, stepType: string, input: unknown, ts = "2026-09-28T16:56:45.000Z") => ({
  ts,
  type: "step.start",
  path,
  stepType,
  input,
});

const end = (path: string, stepType: string, extra: Record<string, unknown> = {}, ts = "2026-09-28T16:56:46.000Z") => ({
  ts,
  type: "step.end",
  path,
  stepType,
  durationMs: 1000.4,
  ...extra,
});

describe("projectRunGraphCalls", () => {
  it("projects an agent's tool call and a workflow step alike", () => {
    const calls = projectRunGraphCalls([
      { type: "run.start", path: "wf", input: { gtId: 1 } },
      start("wf/produce/012-graph_graph_get", "tool:graph_graph_get", { ref_id: "a" }),
      end("wf/produce/012-graph_graph_get", "tool:graph_graph_get", {
        output: '{"ref_id":"a"}',
        nodes: [{ ref_id: "a", node_type: "Concept" }],
      }),
      start("wf/ingest#0/state", "graph/graph-get", { ref_id: "b", namespace: "ns" }),
      end("wf/ingest#0/state", "graph/graph-get", {
        output: { ref_id: "b", properties: { secret: "x" } },
        nodes: [{ ref_id: "b", node_type: "Document" }],
      }),
    ]);

    expect(calls).toEqual([
      {
        path: "wf/produce/012-graph_graph_get",
        tool: "graph_graph_get",
        by: "agent",
        access: "read",
        startedAt: "2026-09-28T16:56:45.000Z",
        endedAt: "2026-09-28T16:56:46.000Z",
        durationMs: 1000,
        query: { ref_id: "a" },
        nodes: [{ ref_id: "a", node_type: "Concept" }],
      },
      {
        path: "wf/ingest#0/state",
        tool: "graph/graph-get",
        by: "workflow",
        access: "read",
        startedAt: "2026-09-28T16:56:45.000Z",
        endedAt: "2026-09-28T16:56:46.000Z",
        durationMs: 1000,
        query: { ref_id: "b", namespace: "ns" },
        nodes: [{ ref_id: "b", node_type: "Document" }],
      },
    ]);
  });

  it("skips a step that touched no node", () => {
    const calls = projectRunGraphCalls([
      start("wf/task", "openhealth/load-task", { gtId: 1 }),
      end("wf/task", "openhealth/load-task", { output: { groundTruth: ["I10"] } }),
      end("wf/reqcheck", "graph/graph-neighbors", { output: [], nodes: [] }),
    ]);
    expect(calls).toEqual([]);
  });

  it("never carries a step's output or a node payload", () => {
    const calls = projectRunGraphCalls([
      start("wf/evalset", "graph/create-node", {
        node_type: "EvalSet",
        namespace: "ns",
        node_data: { groundTruth: ["I10"], name: "set" },
        triplets: [{ source: "x" }],
      }),
      end("wf/evalset", "graph/create-node", {
        output: { ref_id: "c", groundTruth: ["I10"] },
        nodes: [{ ref_id: "c" }],
      }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toEqual({ node_type: "EvalSet", namespace: "ns" });
    expect(JSON.stringify(calls)).not.toContain("groundTruth");
  });

  it("reads a tool input that reached the log as JSON text", () => {
    const calls = projectRunGraphCalls([
      start("wf/a/001-graph_graph_search", "tool:graph_graph_search", '{"q":"sepsis","limit":20}'),
      end("wf/a/001-graph_graph_search", "tool:graph_graph_search", { nodes: [{ ref_id: "a" }] }),
    ]);
    expect(calls[0].query).toEqual({ q: "sepsis", limit: 20 });
  });

  it("keeps a call whose input cannot be read, with an empty query", () => {
    const calls = projectRunGraphCalls([
      start("wf/a/001-graph_graph_search", "tool:graph_graph_search", '{"q":"sep [… truncated'),
      end("wf/a/001-graph_graph_search", "tool:graph_graph_search", { nodes: [{ ref_id: "a" }] }),
    ]);
    expect(calls[0].query).toEqual({});
  });

  it("clips long query strings and lists", () => {
    const calls = projectRunGraphCalls([
      start("wf/a/001-graph_graph_get_batched", "tool:graph_graph_get_batched", {
        ref_ids: Array.from({ length: 80 }, (_, i) => `r${i}`),
        query: "x".repeat(400),
      }),
      end("wf/a/001-graph_graph_get_batched", "tool:graph_graph_get_batched", { nodes: [{ ref_id: "a" }] }),
    ]);
    expect(calls[0].query.ref_ids).toHaveLength(50);
    expect(String(calls[0].query.query)).toHaveLength(301);
  });

  it("counts what a search matched and keeps none of it as nodes", () => {
    const calls = projectRunGraphCalls([
      start("wf/seed/003-graph_graph_search", "tool:graph_graph_search", { q: "Chart Neutral", type: "Concept" }),
      end("wf/seed/003-graph_graph_search", "tool:graph_graph_search", {
        nodes: [
          { ref_id: "chart-neutral", node_type: "Concept" },
          { ref_id: "code-graph-visualization", node_type: "Concept" },
          { ref_id: "chart-neutral", node_type: "Concept" },
        ],
      }),
      start("wf/seed/find", "graph/graph-search", { q: "sepsis" }),
      end("wf/seed/find", "graph/graph-search", { nodes: [{ ref_id: "sepsis" }] }),
      start("wf/seed/004-graph_graph_get", "tool:graph_graph_get", { ref_id: "chart-neutral" }),
      end("wf/seed/004-graph_graph_get", "tool:graph_graph_get", {
        nodes: [{ ref_id: "chart-neutral", node_type: "Concept" }],
      }),
    ]);

    expect(calls.map((c) => [c.tool, c.access, c.nodes.length, c.hits])).toEqual([
      ["graph_graph_search", "read", 0, 2],
      ["graph/graph-search", "read", 0, 1],
      ["graph_graph_get", "read", 1, undefined],
    ]);
    expect(calls[0].query).toEqual({ q: "Chart Neutral" });
    expect(calls[2]).not.toHaveProperty("hits");
    // A hit is a node of the run only because a later call read it.
    expect(distinctNodeRefs(calls)).toEqual([{ ref_id: "chart-neutral", node_type: "Concept" }]);
    expect(JSON.stringify(calls)).not.toContain("code-graph-visualization");
  });

  it("deduplicates node refs and drops malformed ones", () => {
    const calls = projectRunGraphCalls([
      end("wf/a/001-graph_graph_neighbors", "tool:graph_graph_neighbors", {
        nodes: [{ ref_id: "a", node_type: "Concept" }, { ref_id: "a" }, { ref_id: "" }, { node_type: "X" }, null, "b"],
      }),
    ]);
    expect(calls[0].nodes).toEqual([{ ref_id: "a", node_type: "Concept" }]);
    expect(calls[0].startedAt).toBeNull();
  });

  it("answers an empty list for anything that is not an event log", () => {
    expect(projectRunGraphCalls(null)).toEqual([]);
    expect(projectRunGraphCalls({ events: [] })).toEqual([]);
    expect(projectRunGraphCalls([null, "x", { type: "step.end" }])).toEqual([]);
  });
});

describe("accessOf", () => {
  it.each([
    ["graph/graph-get", "read"],
    ["graph_graph_search", "read"],
    ["graph_graph_neighbors", "read"],
    ["graph/walk", "read"],
    ["graph/create-node", "write"],
    ["graph_create_batch_triplet", "write"],
    ["graph/edit-node", "write"],
    ["jarvis/create-triplet", "write"],
    ["graph/register-namespace", "write"],
  ])("%s is a %s", (tool, access) => {
    expect(accessOf(tool)).toBe(access);
  });
});

describe("isSearch", () => {
  it.each([
    ["graph/graph-search", true],
    ["graph_graph_search", true],
    ["jarvis/search", true],
    ["graph/graph-get", false],
    ["graph_graph_get_batched", false],
    ["graph_graph_neighbors", false],
    ["graph/walk", false],
    ["graph/research", false],
    ["graph/create-search-index", false],
  ])("%s: %s", (tool, search) => {
    expect(isSearch(tool)).toBe(search);
  });
});

describe("distinctNodeRefs", () => {
  it("lists each node once, first touch first, and fills in a type learned later", () => {
    const calls = projectRunGraphCalls([
      end("wf/a/001-graph_create_batch_triplet", "tool:graph_create_batch_triplet", {
        nodes: [{ ref_id: "a" }, { ref_id: "b" }],
      }),
      end("wf/a/002-graph_graph_get", "tool:graph_graph_get", {
        nodes: [{ ref_id: "b", node_type: "ClinicalFinding" }, { ref_id: "c", node_type: "Concept" }],
      }),
    ]);
    expect(distinctNodeRefs(calls)).toEqual([
      { ref_id: "a" },
      { ref_id: "b", node_type: "ClinicalFinding" },
      { ref_id: "c", node_type: "Concept" },
    ]);
  });
});
