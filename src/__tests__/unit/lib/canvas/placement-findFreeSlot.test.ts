import { describe, it, expect } from "vitest";
import { findFreeSlotInViewport } from "@/lib/canvas/placement";
import type { CanvasNode } from "@/lib/canvas/types";

const CARD_W = 260;
const CARD_H = 100;
const PADDING = 20;

const VP = { canvasX: 0, canvasY: 0, canvasW: 1200, canvasH: 800 };

function makeNode(
  id: string,
  x: number,
  y: number,
  w = CARD_W,
  h = CARD_H,
): CanvasNode {
  return { id, x, y, category: "feature", label: id } as unknown as CanvasNode;
}

describe("findFreeSlotInViewport", () => {
  it("empty canvas: returns top-left slot (canvasX + padding, canvasY + padding)", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({
      x: VP.canvasX + PADDING,
      y: VP.canvasY + PADDING,
    });
  });

  it("partial occupation: first slot occupied → returns second slot", () => {
    const firstX = VP.canvasX + PADDING;
    const firstY = VP.canvasY + PADDING;
    const blocking = makeNode("n1", firstX, firstY);
    const result = findFreeSlotInViewport(VP, [blocking], CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    expect(result).toEqual({ x: firstX + CARD_W + PADDING, y: firstY });
  });

  it("boundary check: returned position fits entirely within viewport", () => {
    const result = findFreeSlotInViewport(VP, [], CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.x).toBeGreaterThanOrEqual(VP.canvasX);
      expect(result.x + CARD_W).toBeLessThanOrEqual(VP.canvasX + VP.canvasW);
      expect(result.y).toBeGreaterThanOrEqual(VP.canvasY);
      expect(result.y + CARD_H).toBeLessThanOrEqual(VP.canvasY + VP.canvasH);
    }
  });

  it("no collision: returned position does not overlap any existing node", () => {
    const nodes = [
      makeNode("n1", VP.canvasX + PADDING, VP.canvasY + PADDING),
      makeNode("n2", VP.canvasX + PADDING + CARD_W + PADDING, VP.canvasY + PADDING),
    ];
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).not.toBeNull();
    if (result) {
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

  it("fully packed viewport: returns null", () => {
    const STEP_X = CARD_W + PADDING;
    const STEP_Y = CARD_H + PADDING;
    const maxX = VP.canvasX + VP.canvasW - CARD_W;
    const maxY = VP.canvasY + VP.canvasH - CARD_H;
    const nodes: CanvasNode[] = [];
    let idx = 0;
    for (let y = VP.canvasY + PADDING; y <= maxY; y += STEP_Y) {
      for (let x = VP.canvasX + PADDING; x <= maxX; x += STEP_X) {
        nodes.push(makeNode(`n${idx++}`, x, y));
      }
    }
    const result = findFreeSlotInViewport(VP, nodes, CARD_W, CARD_H, PADDING);
    expect(result).toBeNull();
  });

  it("works with a non-zero viewport origin", () => {
    const vp = { canvasX: 500, canvasY: 300, canvasW: 800, canvasH: 600 };
    const result = findFreeSlotInViewport(vp, [], CARD_W, CARD_H, PADDING);
    expect(result).toEqual({ x: vp.canvasX + PADDING, y: vp.canvasY + PADDING });
    if (result) {
      expect(result.x + CARD_W).toBeLessThanOrEqual(vp.canvasX + vp.canvasW);
      expect(result.y + CARD_H).toBeLessThanOrEqual(vp.canvasY + vp.canvasH);
    }
  });

  it("returns null when the viewport is too small to fit even one card", () => {
    const tinyVP = { canvasX: 0, canvasY: 0, canvasW: 100, canvasH: 50 };
    const result = findFreeSlotInViewport(tinyVP, [], CARD_W, CARD_H, PADDING);
    expect(result).toBeNull();
  });
});
