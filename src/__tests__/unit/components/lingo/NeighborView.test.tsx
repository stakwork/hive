// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("lucide-react", () => ({
  Trash2: () => <svg data-testid="trash-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { NeighborView } from "@/app/w/[slug]/lingo/components/NeighborView";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";
import type { NeighborEdge, NeighborNode } from "@/app/api/mock/lingo/neighbors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseNode: LingoNode = {
  ref_id: "node-1",
  name: "Test Node",
  node_type: "Lingo",
  definition: "A test definition",
  date_added_to_graph: 1700000000,
};

function makeEdge(overrides: Partial<NeighborEdge> = {}): NeighborEdge {
  return {
    edge_ref_id: "edge-1",
    edge_type: "RELATED_TO",
    neighbor_node: {
      ref_id: "neighbor-1",
      name: "Neighbor Node",
      node_type: "Lingo",
    } as NeighborNode,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("NeighborView", () => {
  describe("visibleEdges filter — ref_id guard", () => {
    it("renders valid edges normally", () => {
      const edges = [makeEdge()];
      render(
        <NeighborView
          node={baseNode}
          edges={edges}
          deletedEdgeIds={new Set()}
          onDeleteEdge={vi.fn()}
          onNavigate={vi.fn()}
          onAddEdge={vi.fn()}
        />,
      );
      expect(screen.getByTestId("neighbor-edge-list")).toBeInTheDocument();
      expect(screen.getByTestId("neighbor-edge-edge-1")).toBeInTheDocument();
    });

    it("renders zero connections and no crash when neighbor_node is undefined", () => {
      const edgeWithUndefinedNeighbor = makeEdge({
        neighbor_node: undefined as unknown as NeighborNode,
      });
      expect(() =>
        render(
          <NeighborView
            node={baseNode}
            edges={[edgeWithUndefinedNeighbor]}
            deletedEdgeIds={new Set()}
            onDeleteEdge={vi.fn()}
            onNavigate={vi.fn()}
            onAddEdge={vi.fn()}
          />,
        ),
      ).not.toThrow();

      expect(screen.queryByTestId("neighbor-edge-list")).not.toBeInTheDocument();
      expect(
        screen.getByText("No connections yet. Add one to enrich the graph."),
      ).toBeInTheDocument();
    });

    it("renders zero connections when neighbor_node exists but ref_id is missing", () => {
      const edgeWithNoRefId = makeEdge({
        neighbor_node: { name: "Ghost", node_type: "Lingo" } as unknown as NeighborNode,
      });
      render(
        <NeighborView
          node={baseNode}
          edges={[edgeWithNoRefId]}
          deletedEdgeIds={new Set()}
          onDeleteEdge={vi.fn()}
          onNavigate={vi.fn()}
          onAddEdge={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("neighbor-edge-list")).not.toBeInTheDocument();
      expect(
        screen.getByText("No connections yet. Add one to enrich the graph."),
      ).toBeInTheDocument();
    });

    it("filters out malformed edges and still renders valid ones", () => {
      const edges = [
        makeEdge({ edge_ref_id: "edge-valid", neighbor_node: { ref_id: "nb-1", name: "Good Node", node_type: "Lingo" } as NeighborNode }),
        makeEdge({ edge_ref_id: "edge-bad", neighbor_node: undefined as unknown as NeighborNode }),
      ];
      render(
        <NeighborView
          node={baseNode}
          edges={edges}
          deletedEdgeIds={new Set()}
          onDeleteEdge={vi.fn()}
          onNavigate={vi.fn()}
          onAddEdge={vi.fn()}
        />,
      );
      expect(screen.getByTestId("neighbor-edge-list")).toBeInTheDocument();
      expect(screen.getByTestId("neighbor-edge-edge-valid")).toBeInTheDocument();
      expect(screen.queryByTestId("neighbor-edge-edge-bad")).not.toBeInTheDocument();
    });

    it("still respects deletedEdgeIds alongside the ref_id guard", () => {
      const edges = [
        makeEdge({ edge_ref_id: "edge-deleted" }),
        makeEdge({ edge_ref_id: "edge-visible", neighbor_node: { ref_id: "nb-2", name: "Visible", node_type: "Lingo" } as NeighborNode }),
      ];
      render(
        <NeighborView
          node={baseNode}
          edges={edges}
          deletedEdgeIds={new Set(["edge-deleted"])}
          onDeleteEdge={vi.fn()}
          onNavigate={vi.fn()}
          onAddEdge={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("neighbor-edge-edge-deleted")).not.toBeInTheDocument();
      expect(screen.getByTestId("neighbor-edge-edge-visible")).toBeInTheDocument();
    });
  });
});
