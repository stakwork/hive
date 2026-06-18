import { describe, it, expect } from "vitest";
import { computeNodeFocusZoom } from "@/lib/canvas/nodeZoom";

describe("computeNodeFocusZoom", () => {
  it("returns correct zoom for typical node and container sizes", () => {
    // 0.4 * 816 / 260 ≈ 1.255
    const zoom = computeNodeFocusZoom(260, 816);
    expect(zoom).toBeCloseTo(1.255, 2);
    expect(zoom).toBeGreaterThanOrEqual(0.5);
    expect(zoom).toBeLessThanOrEqual(3.0);
  });

  it("clamps to 0.5 when node is very wide relative to container", () => {
    // Very wide node: 0.4 * 800 / 8000 = 0.04 → clamped to 0.5
    const zoom = computeNodeFocusZoom(8000, 800);
    expect(zoom).toBe(0.5);
  });

  it("clamps to 3.0 when node is very narrow relative to container", () => {
    // Very narrow node: 0.4 * 1200 / 1 = 480 → clamped to 3.0
    const zoom = computeNodeFocusZoom(1, 1200);
    expect(zoom).toBe(3.0);
  });

  it("returns 1.5 fallback when nodeWidth is 0", () => {
    expect(computeNodeFocusZoom(0, 800)).toBe(1.5);
  });

  it("returns 1.5 fallback when containerWidth is 0", () => {
    expect(computeNodeFocusZoom(260, 0)).toBe(1.5);
  });

  it("respects a custom fraction", () => {
    // 0.6 * 600 / 300 = 1.2
    const zoom = computeNodeFocusZoom(300, 600, 0.6);
    expect(zoom).toBeCloseTo(1.2, 5);
  });
});
