// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MultiNodeDetail } from "@/app/org/[githubLogin]/_components/MultiNodeDetail";
import type { InternalEdge } from "@/app/org/[githubLogin]/connections/OrgCanvasBackground";
import type { CanvasNode, CanvasEdge } from "system-canvas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "node-1",
    text: "My Node",
    category: "note",
    type: "text",
    x: 0,
    y: 0,
    width: 220,
    height: 80,
    ...overrides,
  } as CanvasNode;
}

function makeEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: "edge-1",
    fromNode: "node-1",
    toNode: "node-2",
    label: undefined,
    ...overrides,
  } as unknown as CanvasEdge;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiNodeDetail", () => {
  it("renders the node count in the header", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "workspace" }),
      makeNode({ id: "n3", text: "Gamma", category: "note" }),
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    expect(screen.getByText("3 nodes selected")).toBeInTheDocument();
  });

  it("renders the category breakdown correctly", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "workspace" }),
      makeNode({ id: "n3", text: "Gamma", category: "note" }),
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    // 2 notes + 1 workspace
    const breakdown = screen.getByText(/2 notes/);
    expect(breakdown).toBeInTheDocument();
    expect(breakdown.textContent).toContain("1 workspace");
  });

  it("renders each selected node's name and category", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha Node", category: "note" }),
      makeNode({ id: "n2", text: "My Workspace", category: "workspace" }),
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    expect(screen.getByText("Alpha Node")).toBeInTheDocument();
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    // Categories appear as uppercase labels
    expect(screen.getAllByText(/note/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0);
  });

  it("falls back to node.id when text is empty", () => {
    const nodes = [makeNode({ id: "node-xyz", text: "", category: "note" })];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    expect(screen.getByText("node-xyz")).toBeInTheDocument();
  });

  it("hides the internal connections section when there are no internal edges", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "note" }),
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    expect(screen.queryByText("INTERNAL CONNECTIONS")).not.toBeInTheDocument();
  });

  it("renders the internal connections section when edges exist", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "note" }),
    ];
    const internalEdges: InternalEdge[] = [
      {
        edge: makeEdge({ id: "e1", fromNode: "n1", toNode: "n2" }),
        fromLabel: "Alpha",
        toLabel: "Beta",
      },
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={internalEdges} githubLogin="testorg" />);

    expect(screen.getByText("INTERNAL CONNECTIONS")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders the edge label when present", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "note" }),
    ];
    const internalEdges: InternalEdge[] = [
      {
        edge: makeEdge({ id: "e1", fromNode: "n1", toNode: "n2", label: "depends on" }),
        fromLabel: "Alpha",
        toLabel: "Beta",
      },
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={internalEdges} githubLogin="testorg" />);

    expect(screen.getByText("depends on")).toBeInTheDocument();
  });

  it("does not render the edge label row when the label is absent", () => {
    const nodes = [
      makeNode({ id: "n1", text: "Alpha", category: "note" }),
      makeNode({ id: "n2", text: "Beta", category: "note" }),
    ];
    const internalEdges: InternalEdge[] = [
      {
        edge: makeEdge({ id: "e1", fromNode: "n1", toNode: "n2", label: undefined }),
        fromLabel: "Alpha",
        toLabel: "Beta",
      },
    ];
    const { container } = render(
      <MultiNodeDetail nodes={nodes} internalEdges={internalEdges} githubLogin="testorg" />,
    );
    // There should be no element with the edge-label class that is non-empty
    const labelEls = container.querySelectorAll(
      "li .text-xs.text-muted-foreground",
    );
    expect(labelEls.length).toBe(0);
  });

  it("shows MULTI-SELECT label in the header", () => {
    const nodes = [
      makeNode({ id: "n1", text: "A", category: "note" }),
      makeNode({ id: "n2", text: "B", category: "note" }),
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={[]} githubLogin="testorg" />);

    expect(screen.getByText("MULTI-SELECT")).toBeInTheDocument();
  });

  it("renders multiple internal edges", () => {
    const nodes = [
      makeNode({ id: "n1", text: "A", category: "note" }),
      makeNode({ id: "n2", text: "B", category: "note" }),
      makeNode({ id: "n3", text: "C", category: "workspace" }),
    ];
    const internalEdges: InternalEdge[] = [
      {
        edge: makeEdge({ id: "e1", fromNode: "n1", toNode: "n2" }),
        fromLabel: "A",
        toLabel: "B",
      },
      {
        edge: makeEdge({ id: "e2", fromNode: "n2", toNode: "n3" }),
        fromLabel: "B",
        toLabel: "C",
      },
    ];
    render(<MultiNodeDetail nodes={nodes} internalEdges={internalEdges} githubLogin="testorg" />);

    const arrows = screen.getAllByText("→");
    expect(arrows).toHaveLength(2);
  });
});
