/**
 * @vitest-environment jsdom
 *
 * The graph kinds small, for the chat's thumbnail strip: a run's trace as
 * the nodes it read and wrote (lineage and bookkeeping left out), a proposal as its change
 * drawn dashed off the focus — from the artifact, no read — and a plain
 * graph as its focus with a sample of neighbours through the workbench's
 * own query.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunGraphThumb } from "@/app/org/[githubLogin]/_components/artifacts/viewers/runGraph";
import { GraphThumb } from "@/app/org/[githubLogin]/_components/artifacts/viewers/graph";
import { artifactKind } from "@/app/org/[githubLogin]/_components/artifacts/registry";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const circles = (c: HTMLElement) => Array.from(c.querySelectorAll("circle"));

function renderIn(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const graphRef: ArtifactRef = { id: "g", kind: "graph", title: "Concept", source: { type: "inline", content: {} } };
const traceRef: ArtifactRef = { id: "t", kind: "run_graph", title: "Trace", source: { type: "inline", content: {} } };

describe("graph thumbnails", () => {
  test("both graph kinds sit in the strip", () => {
    expect(artifactKind("graph").chat?.place).toBe("media");
    expect(artifactKind("run_graph").chat?.place).toBe("media");
  });

  test("a run's trace: the nodes it touched, its edges, lineage and strut's bookkeeping left out", async () => {
    mockFetch.mockResolvedValue(
      json({
        calls: [],
        nodes: [
          { ref_id: "a", node_type: "Function", name: "a", namespace: null, found: true },
          { ref_id: "b", node_type: "File", name: "b", namespace: null, found: true },
          { ref_id: "p", node_type: "Repository", name: "p", namespace: null, found: true, ancestor: true },
          { ref_id: "s", node_type: "StrutRun", name: "s", namespace: null, found: true },
        ],
        edges: [{ source: "a", target: "b", edge_type: "CONTAINS" }],
      }),
    );
    const { container } = renderIn(<RunGraphThumb artifact={traceRef} content={{ workspace: "acme", run: "run-1" }} />);
    await waitFor(() => expect(circles(container)).toHaveLength(2));
    expect(container.querySelectorAll("line")).toHaveLength(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/workspaces/acme/strut/runs/run-1/graph");
  });

  test("a proposal: its new nodes dashed off the focus, read from the artifact alone", () => {
    const { container } = renderIn(
      <GraphThumb
        artifact={graphRef}
        content={{
          workspace: "acme",
          focus: "ref-1",
          changes: [
            { kind: "node", name: "Billing", type: "Concept" },
            { kind: "node", name: "Invoices", type: "Concept", parent: "Billing" },
          ],
        }}
      />,
    );
    const dots = circles(container);
    expect(dots).toHaveLength(3);
    expect(dots.filter((c) => c.getAttribute("fill") === "none")).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a plain graph: the focus and a sample of its neighbours", async () => {
    mockFetch.mockResolvedValue(
      json({
        node: { id: "ref-1", type: "Concept", name: "Billing", properties: {} },
        groups: [
          {
            edge: "RELATES_TO",
            outgoing: true,
            other: "Concept",
            count: 9,
            items: [
              { id: "n1", name: "x", type: "Concept" },
              { id: "n2", name: "y", type: "Concept" },
            ],
          },
        ],
      }),
    );
    const { container } = renderIn(<GraphThumb artifact={graphRef} content={{ workspace: "acme", focus: "ref-1" }} />);
    await waitFor(() => expect(circles(container)).toHaveLength(3));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/workspaces/acme/graph/connections?ref_id=ref-1");
  });

  test("no focus and no change: nothing to draw, nothing read", () => {
    const { container } = renderIn(<GraphThumb artifact={graphRef} content={{ workspace: "acme" }} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a brainstorm tree or a run that touched one node: no thumbnail, no read", () => {
    const tree = renderIn(
      <GraphThumb artifact={graphRef} content={{ workspace: "acme", focus: "q-1", layout: "tree" }} />,
    );
    const trace = renderIn(
      <RunGraphThumb artifact={traceRef} content={{ workspace: "acme", run: "run-1", nodes: 1 }} />,
    );
    expect(tree.container.querySelector("svg")).toBeNull();
    expect(trace.container.querySelector("svg")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a decided proposal: the graph as it is, nothing dashed", async () => {
    useCanvasChatStore.setState({
      activeConversationId: "c",
      conversations: {
        c: { messages: [{ id: "m", role: "user", content: "", rejection: { proposalId: "p-1" } }] },
      } as never,
    });
    mockFetch.mockResolvedValue(
      json({
        node: { id: "ref-1", type: "Concept", name: "Billing", properties: {} },
        groups: [
          {
            edge: "RELATES",
            outgoing: true,
            other: "Concept",
            count: 1,
            items: [{ id: "n1", name: "Tax", type: "Concept" }],
          },
        ],
      }),
    );
    const { container } = renderIn(
      <GraphThumb
        artifact={graphRef}
        content={{ workspace: "acme", focus: "ref-1", proposal: "p-1", changes: [{ kind: "node", name: "Invoices" }] }}
      />,
    );
    await waitFor(() => expect(circles(container)).toHaveLength(2));
    expect(circles(container).filter((c) => c.getAttribute("fill") === "none")).toHaveLength(0);
    useCanvasChatStore.setState({ activeConversationId: null, conversations: {} });
  });

  test("a neighbour along two edges is drawn once", async () => {
    const tax = { id: "n1", name: "Tax", type: "Concept" };
    mockFetch.mockResolvedValue(
      json({
        node: { id: "ref-1", type: "Concept", name: "Billing", properties: {} },
        groups: [
          { edge: "RELATES", outgoing: true, other: "Concept", count: 1, items: [tax] },
          { edge: "RELATES", outgoing: false, other: "Concept", count: 1, items: [tax] },
        ],
      }),
    );
    const { container } = renderIn(<GraphThumb artifact={graphRef} content={{ workspace: "acme", focus: "ref-1" }} />);
    await waitFor(() => expect(circles(container)).toHaveLength(2));
  });
});
