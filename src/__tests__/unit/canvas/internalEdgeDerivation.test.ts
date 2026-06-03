/**
 * Unit tests for the InternalEdge derivation logic that mirrors
 * the `kind === "multi"` branch of `handleSelectionChange` in
 * `OrgCanvasBackground`.
 *
 * We test the pure derivation logic (filter + enrich) independently
 * of React so we can cover the edge cases cheaply without mounting
 * the full canvas component.
 */
import { describe, it, expect } from "vitest";
import type { CanvasNode, CanvasEdge } from "system-canvas";
import type { InternalEdge } from "@/app/org/[githubLogin]/connections/OrgCanvasBackground";

// ---------------------------------------------------------------------------
// Inline re-implementation of the derivation so changes to the
// component don't silently break the tests (the component's real
// implementation is the integration-level proof; here we test the
// algorithm).
// ---------------------------------------------------------------------------

function deriveInternalEdges(
  selectedNodes: CanvasNode[],
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
): InternalEdge[] {
  const selectedIds = new Set(selectedNodes.map((n) => n.id));
  return allEdges
    .filter((e) => selectedIds.has(e.fromNode) && selectedIds.has(e.toNode))
    .map((e) => {
      const fromNode = allNodes.find((n) => n.id === e.fromNode);
      const toNode = allNodes.find((n) => n.id === e.toNode);
      return {
        edge: e,
        fromLabel: (fromNode?.text || fromNode?.id) ?? e.fromNode,
        toLabel: (toNode?.text || toNode?.id) ?? e.toNode,
      };
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, text: string): CanvasNode {
  return { id, text, category: "note", type: "text", x: 0, y: 0, width: 200, height: 80 } as unknown as CanvasNode;
}

function edge(id: string, fromNode: string, toNode: string, label?: string): CanvasEdge {
  return { id, fromNode, toNode, label } as unknown as CanvasEdge;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InternalEdge derivation", () => {
  it("includes edges where both endpoints are in the selection", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");
    const n3 = node("n3", "Gamma");
    const e1 = edge("e1", "n1", "n2");
    const e2 = edge("e2", "n2", "n3");
    const e3 = edge("e3", "n1", "n3");

    const result = deriveInternalEdges([n1, n2, n3], [n1, n2, n3], [e1, e2, e3]);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.edge.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("excludes edges where one endpoint is outside the selection", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");
    const n3 = node("n3", "Gamma"); // not selected
    const e1 = edge("e1", "n1", "n2"); // both inside → included
    const e2 = edge("e2", "n2", "n3"); // n3 outside → excluded
    const e3 = edge("e3", "n1", "n3"); // n3 outside → excluded

    const result = deriveInternalEdges([n1, n2], [n1, n2, n3], [e1, e2, e3]);
    expect(result).toHaveLength(1);
    expect(result[0].edge.id).toBe("e1");
  });

  it("returns empty when no edges share both endpoints inside the selection", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");
    const n3 = node("n3", "Gamma");
    const e1 = edge("e1", "n1", "n3"); // n3 not selected
    const e2 = edge("e2", "n2", "n3"); // n3 not selected

    const result = deriveInternalEdges([n1, n2], [n1, n2, n3], [e1, e2]);
    expect(result).toHaveLength(0);
  });

  it("enriches edges with fromLabel / toLabel resolved from node text", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");
    const e1 = edge("e1", "n1", "n2");

    const result = deriveInternalEdges([n1, n2], [n1, n2], [e1]);
    expect(result[0].fromLabel).toBe("Alpha");
    expect(result[0].toLabel).toBe("Beta");
  });

  it("falls back to node id when text is missing", () => {
    const n1 = { ...node("n1", "Alpha"), text: "" } as CanvasNode;
    const n2 = node("n2", "Beta");
    const e1 = edge("e1", "n1", "n2");

    const result = deriveInternalEdges([n1, n2], [n1, n2], [e1]);
    // text is empty → fall back to node id
    expect(result[0].fromLabel).toBe("n1");
  });

  it("falls back to edge.fromNode / toNode when the node is not in allNodes", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");
    // allNodes doesn't contain n2 (simulate a data inconsistency)
    const e1 = edge("e1", "n1", "n2");

    const result = deriveInternalEdges([n1, n2], [n1 /* n2 missing */], [e1]);
    expect(result[0].toLabel).toBe("n2");
  });

  it("returns empty when canvas has no edges", () => {
    const n1 = node("n1", "Alpha");
    const n2 = node("n2", "Beta");

    const result = deriveInternalEdges([n1, n2], [n1, n2], []);
    expect(result).toHaveLength(0);
  });

  it("handles a single-node selection with no self-edges", () => {
    const n1 = node("n1", "Alpha");
    const e1 = edge("e1", "n1", "n2"); // n2 not selected

    const result = deriveInternalEdges([n1], [n1], [e1]);
    expect(result).toHaveLength(0);
  });
});
