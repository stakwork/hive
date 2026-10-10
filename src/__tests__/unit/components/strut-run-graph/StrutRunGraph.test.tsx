// @vitest-environment jsdom
/**
 * Unit tests for the run graph:
 * - the node panel reading a node: the body is asked for when a node is
 *   picked, once per node, previewed in the panel and opened whole in the
 *   reader;
 * - one branch of the run shown on its own: from the crosshair on its row
 *   or the `scope` it is given, its own steps as the lanes, and back out
 *   along the breadcrumb;
 * - the lineage above the touched nodes: drawn and counted with them, an
 *   ancestor the run never touched said to be one, and a lineage the graph
 *   did not answer for said so;
 * - no workspace context needed (the org chat's artifact panel has none):
 *   the Graph Explorer link comes from the slug it is given;
 * - a node of a peer workspace's graph: badged with the workspace, read by
 *   its qualified id, linked to THAT workspace's Graph Explorer, and said
 *   to be unread when the viewer may not read that graph;
 * - a call that launched a run of its own: nothing of that run is read until
 *   it is opened (its row's button, or a branch shown inside it); then its
 *   calls take the launching call's place, as a branch, opened in the tree.
 */

import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Radix measures the slider with ResizeObserver, which jsdom does not have.
vi.mock("@/components/ui/slider", () => ({ Slider: () => <div data-testid="slider" /> }));

import { StrutRunGraph } from "@/components/strut-run-graph";

const ENDPOINT = "/api/workspaces/hive/strut/runs/run-1/graph";
const TRACE = {
  calls: [
    {
      path: "wf/produce/001-graph_graph_get",
      tool: "graph_graph_get",
      by: "agent",
      access: "read",
      startedAt: null,
      endedAt: null,
      durationMs: null,
      query: { ref_id: "concept" },
      nodes: [{ ref_id: "concept" }, { ref_id: "gone" }],
    },
  ],
  nodes: [
    { ref_id: "concept", node_type: "Concept", name: "Problem List", namespace: "default", found: true },
    { ref_id: "gone", node_type: "Document", name: "enc-0-hpi.md", namespace: null, found: false },
  ],
  edges: [],
  nodesRead: true,
  edgesRead: true,
  truncated: false,
};
const BODY = {
  ref_id: "concept",
  node_type: "Concept",
  labels: ["Data_Bank", "Concept"],
  properties: {
    ref_id: "concept",
    name: "Problem List",
    namespace: "default",
    docs: "# Problem List\n\nOne line per **active** problem.",
    source: "gitree",
  },
};

type Answer = { status: number; body: unknown };
const answer = (status: number, body: unknown): Answer => ({ status, body });

/** `fetch` for the trace and the node, as `{ ok, status, json }` — jsdom has no Response. */
function stubFetch(node: () => Answer, trace: unknown = TRACE) {
  const fetchMock = vi.fn(async (url: string) => {
    const got = url === ENDPOINT ? answer(200, trace) : url.startsWith(`${ENDPOINT}/nodes/`) ? node() : answer(404, {});
    return { ok: got.status < 400, status: got.status, json: async () => got.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const nodeCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith(`${ENDPOINT}/nodes/`)).map(([url]) => url);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StrutRunGraph node reading", () => {
  it("reads a picked node's text, previews it, and opens it whole to read", async () => {
    const fetchMock = stubFetch(() => answer(200, BODY));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByText("Problem List"));

    await waitFor(() => expect(screen.getByTestId("run-graph-node-text").textContent).toContain("One line per"));
    expect(nodeCalls(fetchMock)).toEqual([`${ENDPOINT}/nodes/concept`]);
    expect(screen.getByTestId("run-graph-node-text").textContent).toContain("docs");

    fireEvent.click(screen.getByTestId("run-graph-node-read"));
    const reader = await screen.findByTestId("run-graph-node-reader");
    expect(reader.textContent).toContain("Problem List");
    expect(reader.textContent).toContain("Concept");
    // The text is markdown, rendered escaped: a heading and an emphasis, not raw marks.
    const prose = screen.getByTestId("run-graph-node-prose");
    expect(prose.querySelector(".font-semibold")?.textContent).toBe("Problem List");
    expect(prose.querySelector("b")?.textContent).toBe("active");
    expect(prose.textContent).not.toContain("**");
    // Attributes are what the panel does not already show.
    const attributes = screen.getByTestId("run-graph-node-attributes").textContent ?? "";
    expect(attributes).toContain("source");
    expect(attributes).toContain("gitree");
    expect(attributes).not.toContain("namespace");
  });

  it("asks for a node once", async () => {
    const fetchMock = stubFetch(() => answer(200, BODY));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByText("Problem List"));
    await waitFor(() => expect(screen.getByTestId("run-graph-node-read")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByText("Problem List"));
    expect(screen.getByTestId("run-graph-node-read")).toBeTruthy();
    expect(nodeCalls(fetchMock)).toHaveLength(1);
  });

  it("says when the graph did not answer, and asks again on request", async () => {
    const fetchMock = stubFetch(() => answer(502, { error: "The graph did not answer (no answer in 20 s)" }));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByText("Problem List"));

    await waitFor(() =>
      expect(screen.getByTestId("run-graph-node-text").textContent).toContain(
        "The graph did not answer (no answer in 20 s)",
      ),
    );
    expect(screen.queryByTestId("run-graph-node-read")).toBeNull();

    fireEvent.click(screen.getByText("Ask again"));
    await waitFor(() => expect(nodeCalls(fetchMock)).toHaveLength(2));
  });

  it("asks nothing for a node the graph no longer holds", async () => {
    const fetchMock = stubFetch(() => answer(200, BODY));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByText("enc-0-hpi.md"));

    expect(await screen.findByTestId("run-graph-node-unresolved")).toBeTruthy();
    expect(screen.queryByTestId("run-graph-node-text")).toBeNull();
    expect(nodeCalls(fetchMock)).toEqual([]);
  });
});

/** A call of the loop `loop`, at `path` under it. */
function call(path: string, access: "read" | "write", refs: string[]) {
  return {
    path: `loop/${path}`,
    tool: path.split("-").pop() ?? "",
    by: "agent",
    access,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    query: {},
    nodes: refs.map((ref_id) => ({ ref_id })),
  };
}
const node = (ref_id: string, node_type: string, name: string) => ({
  ref_id,
  node_type,
  name,
  namespace: null,
  found: true,
});

/** Two iterations of a loop: a benchmark run under `run` each, the first improved on under `improve`. */
const LOOP_TRACE = {
  calls: [
    call("loop#0/run/ingest#0/ingest/001-graph_create_batch_triplet", "write", ["doc0", "finding0"]),
    call("loop#0/improve/write/001-graph_create", "write", ["concept0"]),
    call("loop#1/run/ingest#0/ingest/001-graph_create_batch_triplet", "write", ["doc1"]),
  ],
  nodes: [
    node("doc0", "Document", "enc-0-hpi.md"),
    node("finding0", "ClinicalFinding", "Lethargic on arrival"),
    node("concept0", "Concept", "Diabetes Follow-up"),
    node("doc1", "Document", "enc-1-hpi.md"),
  ],
  edges: [{ source: "doc0", target: "finding0", edge_type: "CONTAINS" }],
  nodesRead: true,
  edgesRead: true,
  truncated: false,
};

const lanes = () => screen.getAllByTestId("run-graph-lane").map((el) => el.getAttribute("data-stage"));
const drawn = () => screen.queryAllByTestId("run-graph-node").map((el) => el.textContent);
const crumbs = () => screen.queryByTestId("run-graph-scope")?.textContent ?? null;
const summary = () => screen.getByTestId("run-graph-summary").textContent ?? "";

describe("StrutRunGraph scope", () => {
  it("shows one branch of the run on its own, its own steps as the lanes, and climbs back out", async () => {
    stubFetch(() => answer(404, {}), LOOP_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    await screen.findByTestId("run-graph-summary");

    // The whole loop: one lane, a cell per iteration, every node.
    expect(lanes()).toEqual(["loop"]);
    expect(screen.getAllByTestId("run-graph-cell").map((el) => el.textContent)).toEqual(["#0", "#1"]);
    expect(drawn()).toHaveLength(4);
    expect(crumbs()).toBeNull();
    // The rows under the root follow on an effect. The `loop#1` row compresses the one branch
    // under it; its crosshair shows the row's first branch. The root has none: it is already all of it.
    const loop1 = await screen.findByLabelText("Show only loop#1 / run / ingest#0 / ingest");
    expect(screen.getAllByTestId("run-graph-focus")).toHaveLength(2);

    fireEvent.click(loop1);

    expect(crumbs()).toBe("looploop#1");
    expect(lanes()).toEqual(["run"]);
    expect(drawn()).toEqual(["enc-1-hpi.md"]);
    expect(summary()).toContain("1 calls under loop#1 read or wrote 1 nodes");
    // The branch's tree opens down to its one call.
    expect(screen.getAllByTestId("run-graph-call")).toHaveLength(1);

    fireEvent.click(screen.getAllByTestId("run-graph-crumb")[0]);

    expect(crumbs()).toBeNull();
    expect(lanes()).toEqual(["loop"]);
    expect(drawn()).toHaveLength(4);
  });

  it("opens on the branch it is given, follows a change to it, and says when nothing under it touched the graph", async () => {
    stubFetch(() => answer(404, {}), LOOP_TRACE);
    const view = render(<StrutRunGraph endpoint={ENDPOINT} scope="loop#0/improve" />);
    await screen.findByTestId("run-graph-summary");

    expect(crumbs()).toBe("looploop#0improve");
    expect(lanes()).toEqual(["write"]);
    expect(drawn()).toEqual(["Diabetes Follow-up"]);

    view.rerender(<StrutRunGraph endpoint={ENDPOINT} scope="loop#1/run" />);
    expect(crumbs()).toBe("looploop#1run");
    expect(drawn()).toEqual(["enc-1-hpi.md"]);

    view.rerender(<StrutRunGraph endpoint={ENDPOINT} scope="loop#2/run" />);
    expect(drawn()).toEqual([]);
    expect(summary()).toBe("Nothing under loop#2 / run touched the graph.");
    fireEvent.click(screen.getAllByTestId("run-graph-crumb")[0]);
    expect(drawn()).toHaveLength(4);
  });

  it("opens a branch from the canvas: a lane's name, or a cell's number when the lane loops", async () => {
    stubFetch(() => answer(404, {}), LOOP_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    await screen.findByTestId("run-graph-summary");

    // The loop lane loops, so its name opens nothing; its cells do (the tree offers the same branch).
    const canvas = () => within(screen.getByTestId("run-graph-canvas"));
    expect(canvas().queryByLabelText("Show only loop")).toBeNull();
    fireEvent.click(canvas().getByLabelText("Show only loop#0"));

    expect(crumbs()).toBe("looploop#0");
    expect(lanes()).toEqual(["run", "improve"]);

    fireEvent.click(canvas().getByLabelText("Show only improve"));

    expect(crumbs()).toBe("looploop#0improve");
    expect(lanes()).toEqual(["write"]);
    expect(drawn()).toEqual(["Diabetes Follow-up"]);
  });

  it("goes deeper from inside a branch", async () => {
    stubFetch(() => answer(404, {}), LOOP_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} scope="loop#0" />);
    await screen.findByTestId("run-graph-summary");
    expect(lanes()).toEqual(["run", "improve"]);

    fireEvent.click(await screen.findByLabelText("Show only improve / write"));

    expect(crumbs()).toBe("looploop#0improve");
    expect(lanes()).toEqual(["write"]);
    expect(drawn()).toEqual(["Diabetes Follow-up"]);
  });
});

/** One call reading a rule, under Medicine → Problem List, which the run never read itself. */
const LINEAGE_TRACE = {
  calls: [call("plan/001-graph_graph_get", "read", ["rule"])],
  nodes: [
    node("rule", "Concept", "Unifying Diagnosis"),
    { ...node("list", "Concept", "Problem List"), ancestor: true },
    { ...node("medicine", "Concept", "Medicine"), ancestor: true },
  ],
  edges: [
    { source: "medicine", target: "list", edge_type: "PARENT_OF" },
    { source: "list", target: "rule", edge_type: "PARENT_OF" },
  ],
  nodesRead: true,
  edgesRead: true,
  lineageRead: true,
  truncated: false,
};

describe("StrutRunGraph lineage", () => {
  it("draws the touched nodes under their lineage, counts both, and says which the run never touched", async () => {
    stubFetch(() => answer(404, {}), LINEAGE_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    await screen.findByTestId("run-graph-summary");

    expect(drawn().sort()).toEqual(["Medicine", "Problem List", "Unifying Diagnosis"]);
    expect(summary()).toContain("1 calls read or wrote 1 nodes, under the 2 nodes they descend from");
    expect(screen.getByTestId("run-graph-legend").textContent).toContain("Concept3");
    expect(screen.getAllByTestId("run-graph-link").map((el) => el.getAttribute("data-state"))).toEqual([
      "edge",
      "edge",
    ]);
    expect(screen.queryByTestId("run-graph-unread")).toBeNull();

    fireEvent.click(screen.getByText("Medicine"));
    expect(screen.getByTestId("run-graph-node-ancestor").textContent).toContain("No call touched this node");

    fireEvent.click(screen.getByText("Unifying Diagnosis"));
    expect(screen.queryByTestId("run-graph-node-ancestor")).toBeNull();
    expect(screen.getByTestId("run-graph-node-detail").textContent).toContain("Touched by 1 call");
  });

  it("says when the graph did not answer for the lineage", async () => {
    stubFetch(() => answer(404, {}), {
      ...LINEAGE_TRACE,
      nodes: [LINEAGE_TRACE.nodes[0]],
      edges: [],
      lineageRead: false,
      unreadReason: "no answer in 20 s",
    });
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    await screen.findByTestId("run-graph-summary");

    expect(drawn()).toEqual(["Unifying Diagnosis"]);
    expect(summary()).not.toContain("descend from");
    expect(screen.getByTestId("run-graph-unread").textContent).toContain(
      "The graph did not answer for the lineage of these nodes (no answer in 20 s)",
    );
  });
});

describe("StrutRunGraph without a workspace context", () => {
  it("links a node the graph holds to the Graph Explorer of the workspace it is given, and none without one", async () => {
    stubFetch(() => answer(200, BODY));
    const view = render(<StrutRunGraph endpoint={ENDPOINT} workspaceSlug="acme" fill />);
    fireEvent.click(await screen.findByText("Problem List"));
    await screen.findByTestId("run-graph-node-read");
    const link = screen.getByText("Open in Graph Explorer").closest("a");
    expect(link?.getAttribute("href")).toBe("/w/acme/context/graph?ref_id=concept");
    expect(screen.getByTestId("run-graph").className).toContain("h-full");
    view.unmount();

    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByText("Problem List"));
    await screen.findByTestId("run-graph-node-read");
    expect(screen.queryByText("Open in Graph Explorer")).toBeNull();
  });
});

describe("nodes of a peer workspace's graph", () => {
  const PEER_TRACE = {
    calls: [
      {
        path: "job/work/004-strut_run_workflow",
        tool: "strut_run_workflow",
        by: "agent",
        access: "read",
        startedAt: null,
        endedAt: null,
        durationMs: null,
        query: {},
        nodes: [
          { ref_id: "@apps:fn-1", node_type: "Function", peer: "apps" },
          { ref_id: "@secret:fn-2", node_type: "Function", peer: "secret" },
        ],
      },
    ],
    nodes: [
      {
        ref_id: "@apps:fn-1",
        node_type: "Function",
        name: "verifySphinxToken",
        namespace: null,
        found: true,
        peer: "apps",
      },
      { ref_id: "@secret:fn-2", node_type: "Function", name: "fn-2", namespace: null, found: false, peer: "secret" },
    ],
    edges: [],
    nodesRead: true,
    edgesRead: true,
    truncated: false,
    peers: [
      { slug: "apps", read: true },
      { slug: "secret", read: false, reason: "you are not a member of @secret" },
    ],
  };

  it("badges one with its workspace, reads it by its qualified id, and links that workspace's Graph Explorer", async () => {
    const fetchMock = stubFetch(() => answer(200, { ...BODY, ref_id: "fn-1", node_type: "Function" }), PEER_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} workspaceSlug="org" />);
    fireEvent.click(await screen.findByText("verifySphinxToken"));
    expect(screen.getAllByTestId("run-graph-canvas-peer").map((t) => t.textContent)).toEqual(["@apps", "@secret"]);

    await screen.findByTestId("run-graph-node-read");
    expect(nodeCalls(fetchMock)).toEqual([`${ENDPOINT}/nodes/${encodeURIComponent("@apps:fn-1")}`]);
    const detail = screen.getByTestId("run-graph-node-detail");
    expect(within(detail).getByTestId("run-graph-node-peer").textContent).toBe("@apps");
    expect(detail.textContent).toContain("fn-1");
    expect(detail.textContent).not.toContain("@apps:fn-1");
    expect(screen.getByText("Open in Graph Explorer").closest("a")?.getAttribute("href")).toBe(
      "/w/apps/context/graph?ref_id=fn-1",
    );
  });

  it("says a node of a graph the viewer may not read was not read here, and why, and asks nothing", async () => {
    const fetchMock = stubFetch(() => answer(200, BODY), PEER_TRACE);
    render(<StrutRunGraph endpoint={ENDPOINT} workspaceSlug="org" />);
    fireEvent.click(await screen.findByText("fn-2"));

    const unresolved = await screen.findByTestId("run-graph-node-unresolved");
    expect(unresolved.textContent).toContain("In @secret's graph, not read here (you are not a member of @secret)");
    expect(screen.queryByText("Open in Graph Explorer")).toBeNull();
    expect(nodeCalls(fetchMock)).toEqual([]);
  });
});

describe("child runs, loaded when opened", () => {
  const LAUNCH = "job/work/002-meta_run_workflow";
  const jobCall = (path: string, refs: string[], extra: Record<string, unknown> = {}) => ({
    path,
    tool: path.split("-").slice(1).join("-"),
    by: "agent",
    access: "read",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    query: {},
    nodes: refs.map((ref_id) => ({ ref_id })),
    ...extra,
  });
  const JOB_TRACE = {
    calls: [
      jobCall("job/work/001-graph_graph_get", ["j"]),
      jobCall(LAUNCH, ["a", "b"], { child: { workflow: "explore" } }),
    ],
    nodes: [node("j", "Concept", "Job"), node("a", "Function", "verifySphinxToken"), node("b", "File", "auth.ts")],
    edges: [],
    nodesRead: true,
    edgesRead: true,
    truncated: false,
  };
  const CHILD_CALLS = [
    jobCall(`${LAUNCH}/explore/explore/001-graph_graph_search`, ["a"]),
    jobCall(`${LAUNCH}/explore/explore/002-graph_graph_get`, ["b"]),
  ];

  function stubJob(child: () => Answer) {
    const fetchMock = vi.fn(async (url: string) => {
      const got =
        url === ENDPOINT ? answer(200, JOB_TRACE) : url.startsWith(`${ENDPOINT}/calls?`) ? child() : answer(404, {});
      return { ok: got.status < 400, status: got.status, json: async () => got.body };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const childCalls = (fetchMock: ReturnType<typeof stubJob>) =>
    fetchMock.mock.calls.filter(([url]) => url.startsWith(`${ENDPOINT}/calls?`)).map(([url]) => url);

  it("reads nothing of a child until its row opens it; then its calls take the launch's place, opened", async () => {
    const fetchMock = stubJob(() => answer(200, { calls: CHILD_CALLS }));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    await screen.findByTestId("run-graph-summary");
    expect(summary()).toContain("2 calls read or wrote 3 nodes");
    expect(childCalls(fetchMock)).toEqual([]);

    fireEvent.click(await screen.findByLabelText("Open the explore run"));

    await waitFor(() => expect(summary()).toContain("3 calls read or wrote 3 nodes"));
    expect(childCalls(fetchMock)).toEqual([`${ENDPOINT}/calls?under=${encodeURIComponent(LAUNCH)}`]);
    expect(screen.queryByTestId("run-graph-open-child")).toBeNull();
    // The launch is a branch now, open down to the child's calls.
    expect(screen.getAllByTestId("run-graph-call").map((el) => el.textContent)).toEqual([
      expect.stringContaining("graph_graph_get"),
      expect.stringContaining("graph_graph_search"),
      expect.stringContaining("graph_graph_get"),
    ]);
  });

  it("loads the child a branch shown lies in, once", async () => {
    const fetchMock = stubJob(() => answer(200, { calls: CHILD_CALLS }));
    render(<StrutRunGraph endpoint={ENDPOINT} scope="work/002-meta_run_workflow/explore" />);
    await waitFor(() => expect(drawn().sort()).toEqual(["auth.ts", "verifySphinxToken"]));
    expect(summary()).toContain("2 calls under work / 002-meta_run_workflow / explore");
    expect(childCalls(fetchMock)).toHaveLength(1);
  });

  it("says why a child could not be read, and asks again on another click", async () => {
    const fetchMock = stubJob(() => answer(403, { error: "Not readable here: you are not a member of @apps" }));
    render(<StrutRunGraph endpoint={ENDPOINT} />);
    fireEvent.click(await screen.findByLabelText("Open the explore run"));

    await waitFor(() =>
      expect(screen.getByTestId("run-graph-open-child").getAttribute("title")).toBe(
        "Not readable here: you are not a member of @apps",
      ),
    );
    expect(summary()).toContain("2 calls read or wrote 3 nodes");
    fireEvent.click(screen.getByTestId("run-graph-open-child"));
    await waitFor(() => expect(childCalls(fetchMock)).toHaveLength(2));
  });
});
