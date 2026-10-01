// @vitest-environment jsdom
/**
 * Unit tests for the run graph's node panel reading a node: the body is
 * asked for when a node is picked, once per node, previewed in the panel
 * and opened whole in the reader.
 */

import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
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
function stubFetch(node: () => Answer) {
  const fetchMock = vi.fn(async (url: string) => {
    const got = url === ENDPOINT ? answer(200, TRACE) : url.startsWith(`${ENDPOINT}/nodes/`) ? node() : answer(404, {});
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
