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

  it("preserves the assignedFeatures list from the previous blob (autosave can't reset pins)", () => {
    // Same contract as `hidden`: an autosave PUT MUST NOT clobber the
    // user's pinned-feature list. Toggling goes through dedicated
    // `assignFeatureOnCanvas` / `unassignFeatureOnCanvas` mutations.
    const prev: CanvasBlob = {
      nodes: [],
      edges: [],
      assignedFeatures: ["feat_1", "feat_2"],
    };
    const incoming: CanvasData = { nodes: [], edges: [] };
    const blob = splitCanvas(incoming, prev);
    expect(blob.assignedFeatures).toEqual(["feat_1", "feat_2"]);
  });

  it("omits assignedFeatures when previous list is empty", () => {
    const incoming: CanvasData = { nodes: [], edges: [] };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.assignedFeatures).toBeUndefined();
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

  it("does not stamp any ref on authored nodes (drillable behavior was removed in the initiatives cutover)", () => {
    // The pre-cutover splitter auto-stamped `ref: node:<id>` on authored
    // `objective` nodes so they could drill into a child canvas. That
    // behavior is gone — drillable structure now lives entirely on
    // projected entities (`ws:`, `initiative:`). Authored nodes stay
    // ref-less unless the caller sets one explicitly.
    const incoming: CanvasData = {
      nodes: [
        node("legacy-objective", 0, 0, { category: "objective" }),
        node("note-1", 0, 0, { category: "note" }),
        node("custom-ref-node", 0, 0, { category: "note", ref: "explicit" }),
      ],
      edges: [],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.nodes.find((n) => n.id === "legacy-objective")?.ref).toBeUndefined();
    expect(blob.nodes.find((n) => n.id === "note-1")?.ref).toBeUndefined();
    // Explicit caller-set refs are preserved verbatim.
    expect(blob.nodes.find((n) => n.id === "custom-ref-node")?.ref).toBe("explicit");
  });

  it("treats new live-id prefixes (`initiative:`, `milestone:`) as live, not authored", () => {
    // Adding a prefix in scope.ts ripples to the splitter automatically
    // via `isLiveId`. This test is a guard against a future drift where
    // someone adds a prefix to scope.ts but forgets the splitter.
    const incoming: CanvasData = {
      nodes: [
        node("initiative:abc", 100, 200),
        node("milestone:xyz", 300, 400),
      ],
      edges: [],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    expect(blob.nodes).toEqual([]);
    expect(blob.positions).toEqual({
      "initiative:abc": { x: 100, y: 200 },
      "milestone:xyz": { x: 300, y: 400 },
    });
  });

  it("filters out projector-emitted synthetic edges (`synthetic:` prefix) on save", () => {
    // Synthetic edges represent DB-derived membership (e.g.
    // `feature:<X> → milestone:<Y>` from `Feature.milestoneId`) and
    // re-derive on every read. Letting them round-trip into the
    // authored blob would create a parallel representation of the
    // same relationship that could disagree with the DB after a
    // membership change.
    const incoming: CanvasData = {
      nodes: [node("auth-1")],
      edges: [
        {
          id: "synthetic:feature-milestone:f1",
          fromNode: "feature:f1",
          toNode: "milestone:m1",
        },
        {
          id: "user-drawn-edge",
          fromNode: "auth-1",
          toNode: "ws:abc",
        },
      ],
    };
    const blob = splitCanvas(incoming, emptyPrev);
    // Authored edges survive verbatim; synthetic ones are dropped.
    expect(blob.edges.map((e) => e.id)).toEqual(["user-drawn-edge"]);
  });
});
