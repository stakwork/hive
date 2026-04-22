import { describe, it, expect } from "vitest";
import { splitCanvas } from "@/lib/canvas/io";
import type { CanvasBlob, CanvasData, CanvasNode } from "@/lib/canvas";

/**
 * Shorthand factories so tests stay readable.
 */
function node(id: string, x = 0, y = 0, extras: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: "text", x, y, text: id, ...extras };
}

const emptyPrev: CanvasBlob = { nodes: [], edges: [] };

describe("splitCanvas", () => {
  it("keeps authored nodes verbatim and drops live nodes from `nodes`", () => {
    const incoming: CanvasData = {
      nodes: [node("auth-1"), node("ws:abc"), node("auth-2")],
      edges: [],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.nodes.map((n) => n.id)).toEqual(["auth-1", "auth-2"]);
  });

  it("records x/y of live nodes in `positions`", () => {
    const incoming: CanvasData = {
      nodes: [node("ws:abc", 100, 200), node("feature:xyz", 50, 60)],
      edges: [],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.positions).toEqual({
      "ws:abc": { x: 100, y: 200 },
      "feature:xyz": { x: 50, y: 60 },
    });
  });

  it("preserves previous positions for live nodes not present in the incoming document", () => {
    // The plan's rule: omitting a live node is NOT an implicit hide.
    // A partial write (autosave that didn't include every projected
    // node) must never lose the user's saved drag.
    const prev: CanvasBlob = {
      nodes: [],
      edges: [],
      positions: { "ws:abc": { x: 42, y: 7 }, "ws:xyz": { x: 9, y: 9 } },
    };
    const incoming: CanvasData = { nodes: [node("ws:abc", 1, 1)], edges: [] };
    const blob = splitCanvas(incoming, prev);
    expect(blob.positions).toEqual({
      "ws:abc": { x: 1, y: 1 }, // overwritten with the new position
      "ws:xyz": { x: 9, y: 9 }, // preserved untouched
    });
  });

  it("persists edges verbatim regardless of endpoint kind", () => {
    const incoming: CanvasData = {
      nodes: [node("obj-1"), node("ws:abc")],
      edges: [
        { id: "e1", fromNode: "obj-1", toNode: "ws:abc", label: "contributes to" },
        { id: "e2", fromNode: "ws:abc", toNode: "stale" }, // dangling
      ],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.edges).toEqual(incoming.edges);
  });

  it("preserves the hidden list from the previous blob", () => {
    const prev: CanvasBlob = {
      nodes: [],
      edges: [],
      hidden: ["ws:hidden-1"],
    };
    const incoming: CanvasData = { nodes: [], edges: [] };
    const blob = splitCanvas(incoming, prev);
    expect(blob.hidden).toEqual(["ws:hidden-1"]);
  });

  it("omits `positions` when empty to keep the blob minimal", () => {
    const incoming: CanvasData = { nodes: [node("auth-1")], edges: [] };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.positions).toBeUndefined();
  });

  it("is idempotent under round-trip (re-splitting the same incoming doc yields equivalent positions)", () => {
    const first = splitCanvas(
      { nodes: [node("ws:a", 5, 5), node("auth-1", 10, 10)], edges: [] },
      emptyPrev,
    );
    // Re-ingest what we just produced, plus the live node being echoed back.
    const second = splitCanvas(
      {
        nodes: [...first.nodes, node("ws:a", 5, 5)],
        edges: first.edges,
      },
      first,
    );
    expect(second.nodes).toEqual(first.nodes);
    expect(second.positions).toEqual(first.positions);
  });

  describe("drillable-ref stamping", () => {
    it("auto-stamps `ref: node:<id>` on authored objectives that have no ref", () => {
      const incoming: CanvasData = {
        nodes: [node("obj-1", 0, 0, { category: "objective" })],
        edges: [],
      };
      const blob = splitCanvas(incoming, emptyPrev);
      expect(blob.nodes[0].ref).toBe("node:obj-1");
    });

    it("preserves an explicit ref the caller set on an objective", () => {
      // If the agent or a migration wants to wire an objective at a
      // custom ref (e.g. a named workstream), don't clobber it.
      const incoming: CanvasData = {
        nodes: [node("obj-1", 0, 0, { category: "objective", ref: "custom-ref" })],
        edges: [],
      };
      const blob = splitCanvas(incoming, emptyPrev);
      expect(blob.nodes[0].ref).toBe("custom-ref");
    });

    it("does NOT stamp a ref on non-drillable categories (notes, decisions)", () => {
      // Only `objective` is drillable today. Notes/decisions are leaves.
      const incoming: CanvasData = {
        nodes: [
          node("n-1", 0, 0, { category: "note" }),
          node("d-1", 0, 0, { category: "decision" }),
        ],
        edges: [],
      };
      const blob = splitCanvas(incoming, emptyPrev);
      expect(blob.nodes[0].ref).toBeUndefined();
      expect(blob.nodes[1].ref).toBeUndefined();
    });

    it("does NOT stamp a ref on authored nodes without any category", () => {
      // Pre-category canvases should round-trip unchanged.
      const incoming: CanvasData = {
        nodes: [{ id: "x", type: "text", x: 0, y: 0, text: "x" }],
        edges: [],
      };
      const blob = splitCanvas(incoming, emptyPrev);
      expect(blob.nodes[0].ref).toBeUndefined();
    });
  });
});
