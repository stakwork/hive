/**
 * Unit tests for findFreeSlotInViewport in placement.ts.
 *
 * We test the exported function directly — no mocks needed since it's
 * a pure function (no DB / network calls).
 */
import { describe, it, expect } from "vitest";
import { findFreeSlotInViewport } from "@/lib/canvas/placement";
import type { CanvasNode } from "@/lib/canvas/types";

const VP = { canvasX: 0, canvasY: 0, canvasW: 1000, canvasH: 800 };
const CARD_W = 260;
const CARD_H = 100;
const PADDING = 20;

function makeNode(x: number, y: number, w = CARD_W, h = CARD_H): CanvasNode {
  return { id: `node-${x}-${y}`, x, y, category: "feature" } as CanvasNode;
}

describe("findFreeSlotInViewport", () => {
  it("returns the top-left slot (canvasX + padding, canvasY + padding) on an empty canvas", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({ x: PADDING, y: PADDING });
  });

  it("returns null when the viewport is fully packed", () => {
    // Fill every grid position inside the viewport
    const STEP_X = CARD_W + PADDING;
    const STEP_Y = CARD_H + PADDING;
    const maxX = VP.canvasX + VP.canvasW - CARD_W;
    const maxY = VP.canvasY + VP.canvasH - CARD_H;
    const nodes: CanvasNode[] = [];
    for (let y = VP.canvasY + PADDING; y <= maxY; y += STEP_Y) {
      for (let x = VP.canvasX + PADDING; x <= maxX; x += STEP_X) {
        nodes.push(makeNode(x, y));
      }
    }
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).toBeNull();
  });

  it("skips the first occupied slot and returns the second", () => {
    // Block the very first grid slot
    const firstSlotNode = makeNode(PADDING, PADDING);
    const result = findFreeSlotInViewport(VP, [firstSlotNode], CARD_W, CARD_H, PADDING);
    // The next slot to the right
    expect(result).toEqual({ x: PADDING + CARD_W + PADDING, y: PADDING });
  });

  it("returned x + cardW is always <= canvasX + canvasW (card fits horizontally)", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.x + CARD_W).toBeLessThanOrEqual(VP.canvasX + VP.canvasW);
    }
  });

  it("returned y + cardH is always <= canvasY + canvasH (card fits vertically)", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.y + CARD_H).toBeLessThanOrEqual(VP.canvasY + VP.canvasH);
    }
  });

  it("returned position has no collision with existing nodes", () => {
    // Place a few nodes in the viewport
    const nodes = [
      makeNode(PADDING, PADDING),
      makeNode(PADDING + CARD_W + PADDING, PADDING),
    ];
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      // Verify no AABB overlap with any existing node
      for (const n of nodes) {
        const overlaps =
          result.x < n.x + CARD_W &&
          result.x + CARD_W > n.x &&
          result.y < n.y + CARD_H &&
          result.y + CARD_H > n.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("works with a non-zero viewport origin", () => {
    const offsetVP = { canvasX: 500, canvasY: 300, canvasW: 800, canvasH: 600 };
    const result = findFreeSlotInViewport(offsetVP, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({ x: 500 + PADDING, y: 300 + PADDING });
    if (result) {
      expect(result.x).toBeGreaterThanOrEqual(offsetVP.canvasX);
      expect(result.y).toBeGreaterThanOrEqual(offsetVP.canvasY);
      expect(result.x + CARD_W).toBeLessThanOrEqual(offsetVP.canvasX + offsetVP.canvasW);
      expect(result.y + CARD_H).toBeLessThanOrEqual(offsetVP.canvasY + offsetVP.canvasH);
    }
  });

  it("returns null when the viewport is too small to fit even one card", () => {
    const tinyVP = { canvasX: 0, canvasY: 0, canvasW: 100, canvasH: 50 };
    const result = findFreeSlotInViewport(tinyVP, [], CARD_W, CARD_H, PADDING);
    // CARD_W (260) > canvasW (100) - padding (20) = 80, so no slot fits
    expect(result).toBeNull();
  });
});
