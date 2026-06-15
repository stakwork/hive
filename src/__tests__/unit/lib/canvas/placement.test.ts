import { describe, it, expect } from "vitest";
import { findFreeSlotInViewport } from "@/lib/canvas/placement";
import type { CanvasNode } from "@/lib/canvas/types";

// Helper to build a minimal CanvasNode at a given position/size.
function makeNode(
  id: string,
  x: number,
  y: number,
  category: string = "feature",
): CanvasNode {
  return { id, x, y, category } as unknown as CanvasNode;
}

const VP = { canvasX: 0, canvasY: 0, canvasW: 1200, canvasH: 800 };
const CARD_W = 260;
const CARD_H = 100;
const PADDING = 20;

describe("findFreeSlotInViewport", () => {
  it("returns top-left slot (canvasX + padding, canvasY + padding) on an empty canvas", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({ x: VP.canvasX + PADDING, y: VP.canvasY + PADDING });
  });

  it("returns null when every grid slot is occupied", () => {
    // Fill every grid position inside the viewport
    const stepX = CARD_W + PADDING;
    const stepY = CARD_H + PADDING;
    const maxX = VP.canvasX + VP.canvasW - CARD_W;
    const maxY = VP.canvasY + VP.canvasH - CARD_H;
    const nodes: CanvasNode[] = [];
    let idx = 0;
    for (let y = VP.canvasY + PADDING; y <= maxY; y += stepY) {
      for (let x = VP.canvasX + PADDING; x <= maxX; x += stepX) {
        nodes.push(makeNode(`n${idx++}`, x, y));
      }
    }
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).toBeNull();
  });

  it("skips the first slot when occupied and returns the second", () => {
    // Place a node exactly at the first grid position
    const firstX = VP.canvasX + PADDING;
    const firstY = VP.canvasY + PADDING;
    const occupant = makeNode("occ", firstX, firstY);
    const result = findFreeSlotInViewport(VP, [occupant], CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    // First slot blocked; second slot is one step to the right
    expect(result).toEqual({ x: firstX + CARD_W + PADDING, y: firstY });
  });

  it("returned position keeps the card fully within the viewport (boundary check)", () => {
    const nodes: CanvasNode[] = [];
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.x).toBeGreaterThanOrEqual(VP.canvasX);
      expect(result.x + CARD_W).toBeLessThanOrEqual(VP.canvasX + VP.canvasW);
      expect(result.y).toBeGreaterThanOrEqual(VP.canvasY);
      expect(result.y + CARD_H).toBeLessThanOrEqual(VP.canvasY + VP.canvasH);
    }
  });

  it("returned position does not collide with any existing node", () => {
    // Scatter a few nodes at arbitrary positions
    const nodes: CanvasNode[] = [
      makeNode("a", 20, 20),
      makeNode("b", 400, 20),
      makeNode("c", 20, 200),
    ];
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      // Verify no AABB overlap between result rect and any node
      for (const n of nodes) {
        const nodeW = 260; // default feature dims used by dimsForCategory
        const nodeH = 100;
        const noOverlap =
          result.x + CARD_W <= n.x ||
          result.x >= n.x + nodeW ||
          result.y + CARD_H <= n.y ||
          result.y >= n.y + nodeH;
        expect(noOverlap).toBe(true);
      }
    }
  });

  it("works correctly with a non-zero origin viewport", () => {
    const offsetVP = { canvasX: 500, canvasY: 300, canvasW: 800, canvasH: 600 };
    const result = findFreeSlotInViewport(offsetVP, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({
      x: offsetVP.canvasX + PADDING,
      y: offsetVP.canvasY + PADDING,
    });
    if (result) {
      expect(result.x + CARD_W).toBeLessThanOrEqual(offsetVP.canvasX + offsetVP.canvasW);
      expect(result.y + CARD_H).toBeLessThanOrEqual(offsetVP.canvasY + offsetVP.canvasH);
    }
  });
});
