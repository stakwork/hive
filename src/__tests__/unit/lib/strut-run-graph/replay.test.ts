/**
 * Unit tests for `lib/strut-run-graph/replay.ts`: the call tree and the
 * graph at each step of a replay.
 */

import { describe, it, expect } from "vitest";
import { buildRunGraphTree, callLabel, replayFrame } from "@/lib/strut-run-graph/replay";
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
  call("wf/ingest#0/ingest/001-graph_graph_get", ["b"]),
  call("wf/ingest#0/state", ["c"]),
  call("wf/seed/002-graph_graph_get", ["d"]),
];

describe("buildRunGraphTree", () => {
  it("is null for a run with no calls", () => {
    expect(buildRunGraphTree([])).toBeNull();
  });

  it("nests the calls under their event paths, siblings in first-call order", () => {
    const tree = buildRunGraphTree(CALLS)!;
    expect(tree.label).toBe("wf");
    expect(tree.callCount).toBe(4);
    expect(tree.children.map((c) => [c.label, c.callCount])).toEqual([
      ["seed", 2],
      ["ingest#0", 2],
    ]);

    const [seed, ingest] = tree.children;
    expect(seed.children.map((c) => [c.label, c.callIndex])).toEqual([
      ["001-graph_graph_search", 0],
      ["002-graph_graph_get", 3],
    ]);
    // An agent under the iteration, and a workflow step beside it.
    expect(ingest.children.map((c) => [c.label, c.callIndex, c.callCount])).toEqual([
      ["ingest", null, 1],
      ["state", 2, 1],
    ]);
    expect(ingest.children[0].children[0]).toMatchObject({
      path: "wf/ingest#0/ingest/001-graph_graph_get",
      callIndex: 1,
    });
  });
});

describe("callLabel", () => {
  it("drops the agent's call counter", () => {
    expect(callLabel("012-graph_graph_get")).toBe("graph_graph_get");
    expect(callLabel("state")).toBe("state");
  });
});

describe("replayFrame", () => {
  const ids = (set: Set<string>) => [...set].sort();

  it("shows what was touched up to the step and marks the step's own nodes", () => {
    const frame = replayFrame(CALLS, 1);
    expect(ids(frame.hidden)).toEqual(["c", "d"]);
    expect(ids(frame.active)).toEqual(["b"]);
  });

  it("keeps a node shown once an earlier call touched it, even if a later one does too", () => {
    expect(ids(replayFrame(CALLS, 0).hidden)).toEqual(["c", "d"]);
  });

  it("shows the whole run with nothing active past the last call", () => {
    const frame = replayFrame(CALLS, CALLS.length);
    expect(frame.hidden.size).toBe(0);
    expect(frame.active.size).toBe(0);
  });

  it("marks the last call's nodes at the last step", () => {
    const frame = replayFrame(CALLS, CALLS.length - 1);
    expect(frame.hidden.size).toBe(0);
    expect(ids(frame.active)).toEqual(["d"]);
  });
});
