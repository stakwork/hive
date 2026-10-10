/**
 * Unit tests for `lib/strut-run-graph/replay.ts`: the call tree, one branch
 * of it on its own, and the graph at each step of a replay.
 */

import { describe, it, expect } from "vitest";
import {
  buildRunGraphTree,
  callLabel,
  childToLoad,
  keepGraphRead,
  replayFrame,
  scopeCalls,
  scopeOfBranch,
  withChildCalls,
} from "@/lib/strut-run-graph/replay";
import type { RunGraphCall, RunGraphNode, RunGraphTrace } from "@/lib/strut-run-graph/types";

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

describe("keepGraphRead", () => {
  const read = (ref_id: string): RunGraphNode => ({
    ref_id,
    node_type: "Document",
    name: `${ref_id}.md`,
    namespace: "oh-7532",
    found: true,
  });
  const unread = (ref_id: string): RunGraphNode => ({
    ref_id,
    node_type: "Node",
    name: ref_id,
    namespace: null,
    found: false,
  });
  const EARLIER: RunGraphTrace = {
    calls: [],
    nodes: [read("a"), read("b")],
    edges: [{ source: "a", target: "b", edge_type: "CONTAINS" }],
    nodesRead: true,
    edgesRead: true,
    lineageRead: true,
    truncated: false,
  };

  it("is the refresh when the graph answered it", () => {
    const next: RunGraphTrace = { ...EARLIER, nodes: [read("a")], edges: [] };
    expect(keepGraphRead(EARLIER, next)).toBe(next);
    expect(keepGraphRead(null, next)).toBe(next);
  });

  it("keeps the nodes and edges an earlier refresh read when the graph does not answer", () => {
    const next: RunGraphTrace = {
      calls: [],
      nodes: [unread("a"), unread("b"), unread("c")],
      edges: [],
      nodesRead: false,
      edgesRead: false,
      lineageRead: false,
      truncated: false,
    };

    expect(keepGraphRead(EARLIER, next)).toEqual({
      ...next,
      nodes: [read("a"), read("b"), unread("c")],
      edges: EARLIER.edges,
    });
  });

  it("keeps the lineage an earlier refresh read when the graph does not answer for it", () => {
    const root: RunGraphNode = { ...read("root"), node_type: "Concept", ancestor: true };
    const lineage = { source: "root", target: "a", edge_type: "PARENT_OF" };
    const earlier: RunGraphTrace = { ...EARLIER, nodes: [read("a"), root], edges: [...EARLIER.edges, lineage] };
    const next: RunGraphTrace = {
      ...EARLIER,
      nodes: [read("a"), read("c")],
      edges: [{ source: "a", target: "c", edge_type: "CONTAINS" }],
      lineageRead: false,
    };

    expect(keepGraphRead(earlier, next)).toEqual({
      ...next,
      nodes: [read("a"), read("c"), root],
      edges: [...next.edges, lineage],
    });
    // The lineage the refresh did read is its own.
    const answered: RunGraphTrace = { ...next, lineageRead: true };
    expect(keepGraphRead(earlier, answered)).toBe(answered);
  });

  it("has nothing to keep from a refresh the graph did not answer either", () => {
    const never: RunGraphTrace = { ...EARLIER, nodes: [unread("a")], edges: [], nodesRead: false, edgesRead: false };
    const next: RunGraphTrace = { ...never, nodes: [unread("a"), unread("b")] };
    expect(keepGraphRead(never, next)).toBe(next);
  });
});

describe("scopeCalls", () => {
  const LOOP = [
    call("wf/loop#0/run/ingest#0/ingest/001-graph_graph_get", ["a"]),
    call("wf/loop#0/improve/002-graph_create", ["b"]),
    call("wf/loop#1/run/ingest#0/ingest/001-graph_graph_get", ["c"]),
    call("wf/003-produce", ["d"]),
  ];

  it("is every call for the whole run", () => {
    expect(scopeCalls(LOOP, null)).toBe(LOOP);
  });

  it("keeps the calls under the branch, re-rooted at it", () => {
    expect(scopeCalls(LOOP, "loop#0").map((c) => c.path)).toEqual([
      "loop#0/run/ingest#0/ingest/001-graph_graph_get",
      "loop#0/improve/002-graph_create",
    ]);
    expect(scopeCalls(LOOP, "loop#1/run").map((c) => [c.path, c.nodes[0].ref_id])).toEqual([
      ["run/ingest#0/ingest/001-graph_graph_get", "c"],
    ]);
  });

  it("reads the branch as a run of its own", () => {
    const tree = buildRunGraphTree(scopeCalls(LOOP, "loop#0"))!;
    expect(tree.label).toBe("loop#0");
    expect(tree.children.map((c) => c.label)).toEqual(["run", "improve"]);
  });

  it("is empty for a branch no call is under, matching whole segments only", () => {
    expect(scopeCalls(LOOP, "loop#2")).toEqual([]);
    expect(scopeCalls(LOOP, "loop")).toEqual([]);
  });
});

describe("scopeOfBranch", () => {
  it("is the branch's path under the run", () => {
    expect(scopeOfBranch(null, "wf/loop#1/run")).toBe("loop#1/run");
  });

  it("composes a branch of a scoped tree onto the scope", () => {
    expect(scopeOfBranch("loop#1", "loop#1/run")).toBe("loop#1/run");
    expect(scopeOfBranch("loop#1/run", "run/ingest#0/ingest")).toBe("loop#1/run/ingest#0/ingest");
  });
});

describe("child runs", () => {
  const launch = (path: string, refs: string[]): RunGraphCall => ({
    ...call(path, refs),
    tool: "meta_run_workflow",
    child: { workflow: "explore" },
  });
  const RUN = [
    call("job/work/001-graph_graph_get", ["j"]),
    launch("job/work/002-meta_run_workflow", ["a", "b"]),
    call("job/work/003-graph_graph_get", ["k"]),
  ];
  const CHILD = [
    call("job/work/002-meta_run_workflow/explore/explore/001-graph_graph_get", ["a"]),
    launch("job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow", ["b"]),
  ];
  const GRANDCHILD = [
    call("job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow/deep/deep/001-graph_graph_get", ["b"]),
  ];

  it("puts a loaded child's calls in place of its launching call, recursively, and leaves the others", () => {
    expect(withChildCalls(RUN, {}).map((c) => c.path)).toEqual(RUN.map((c) => c.path));
    expect(withChildCalls(RUN, { "job/work/002-meta_run_workflow": CHILD }).map((c) => c.path)).toEqual([
      "job/work/001-graph_graph_get",
      ...CHILD.map((c) => c.path),
      "job/work/003-graph_graph_get",
    ]);
    const deep = withChildCalls(RUN, {
      "job/work/002-meta_run_workflow": CHILD,
      "job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow": GRANDCHILD,
    });
    expect(deep.map((c) => c.path)).toContain(GRANDCHILD[0].path);
    expect(deep.some((c) => c.child)).toBe(false);
    // A child that came back empty leaves its launch, folded nodes and all.
    expect(withChildCalls(RUN, { "job/work/002-meta_run_workflow": [] })[1].nodes).toEqual([
      { ref_id: "a" },
      { ref_id: "b" },
    ]);
  });

  it("a loaded child reads as a branch of the tree", () => {
    const tree = buildRunGraphTree(withChildCalls(RUN, { "job/work/002-meta_run_workflow": CHILD }))!;
    const launchNode = tree.children[0].children.find((c) => c.label === "002-meta_run_workflow")!;
    expect(launchNode.callIndex).toBeNull();
    expect(launchNode.callCount).toBe(2);
  });

  it("names the unloaded launch a branch lies in, or is, and nothing for the rest", () => {
    expect(childToLoad(RUN, null)).toBeNull();
    expect(childToLoad(RUN, "work")).toBeNull();
    expect(childToLoad(RUN, "work/002-meta_run_workflow")).toBe("job/work/002-meta_run_workflow");
    expect(childToLoad(RUN, "work/002-meta_run_workflow/explore/explore")).toBe("job/work/002-meta_run_workflow");
    expect(childToLoad(RUN, "work/002-meta_run_workflow2")).toBeNull();
    const loaded = withChildCalls(RUN, { "job/work/002-meta_run_workflow": CHILD });
    expect(childToLoad(loaded, "work/002-meta_run_workflow/explore/explore")).toBeNull();
    expect(childToLoad(loaded, "work/002-meta_run_workflow/explore/explore/002-meta_run_workflow/deep")).toBe(
      "job/work/002-meta_run_workflow/explore/explore/002-meta_run_workflow",
    );
  });
});
