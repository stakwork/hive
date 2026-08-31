import { describe, it, expect, vi } from "vitest";
import { computeNodeFocusZoom } from "@/lib/canvas/nodeZoom";
import type { SystemCanvasHandle, CanvasData } from "system-canvas-react";
import {
  runDeeplinkNavigation,
  type RunDeeplinkNavigationArgs,
} from "@/app/org/[githubLogin]/connections/deeplinkNavigation";

/**
 * Unit tests for the org canvas's deep-link navigation.
 *
 * These tests exercise the REAL exported `runDeeplinkNavigation` — the
 * helper extracted from `OrgCanvasBackground`'s `pendingDeeplink`
 * effect and shared by chat deeplink chips and the Live Now panel.
 * (The suite previously replicated the effect body inline, so a
 * regression in the live function would not fail CI; it now imports
 * the production symbol via the leaf `deeplinkNavigation` module, which
 * has no heavyweight imports.)
 *
 * The navigation runs in a node environment here: `waitForCanvasSwap`
 * falls back to a macrotask when `requestAnimationFrame` is absent,
 * mirroring how the browser path settles after `navigateToRoot()`.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface FakeNode {
  id: string;
  width?: number;
}

/** Minimal canvas-data stand-in — only `nodes` matter to the helper. */
interface FakeCanvas {
  nodes: FakeNode[];
}

interface FakeHandle {
  zoomIntoNode: ReturnType<typeof vi.fn>;
  navigateToRoot: ReturnType<typeof vi.fn>;
  navigateBack: ReturnType<typeof vi.fn>;
}

function makeHandle(): FakeHandle {
  return {
    zoomIntoNode: vi.fn().mockResolvedValue(undefined),
    navigateToRoot: vi.fn(),
    navigateBack: vi.fn(),
  };
}

function asHandle(fake: FakeHandle): SystemCanvasHandle {
  return fake as unknown as SystemCanvasHandle;
}

interface ArgsOverrides {
  currentRef?: string;
  target?: { nodeId: string; canvasRef: string; label?: string };
  /** Canvas data returned by `getCanvasData`, keyed by ref ("" = root). */
  canvases?: Record<string, FakeCanvas>;
  containerWidth?: number;
  handle?: FakeHandle;
}

/**
 * Builds helper args around a FakeHandle. Returns the raw fake (for
 * call-order assertions) plus ready-to-run args; `getCanvasData` casts
 * the stand-ins to `CanvasData` at the boundary — the helper only reads
 * `nodes[].id` / `nodes[].width`.
 */
function makeArgs({
  currentRef = "",
  target = { nodeId: "feature:1", canvasRef: "initiative:B" },
  canvases = {},
  containerWidth = 800,
  handle = makeHandle(),
}: ArgsOverrides = {}): { fake: FakeHandle; args: RunDeeplinkNavigationArgs } {
  return {
    fake: handle,
    args: {
      handle: asHandle(handle),
      currentRef,
      target,
      getCanvasData: (ref: string) =>
        (canvases[ref] as unknown as CanvasData | undefined) ?? null,
      containerWidth,
    },
  };
}

// ---------------------------------------------------------------------------
// runDeeplinkNavigation — real symbol
// ---------------------------------------------------------------------------

describe("runDeeplinkNavigation — same-ref no-op", () => {
  it("skips scope navigation entirely when already on the target ref", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "feature:1", canvasRef: "initiative:A" },
      canvases: {
        "initiative:A": { nodes: [{ id: "feature:1", width: 280 }] },
      },
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(true);

    expect(handle.navigateToRoot).not.toHaveBeenCalled();
    // Only the node focus zoom — no drill-in call.
    expect(handle.zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(handle.zoomIntoNode).toHaveBeenCalledWith(
      "feature:1",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("is a no-op when handle is missing or nodeId is empty", async () => {
    const { fake: handle, args } = makeArgs({
      target: { nodeId: "", canvasRef: "" },
    });

    await expect(
      runDeeplinkNavigation({
        ...args,
        handle: undefined as unknown as SystemCanvasHandle,
      }),
    ).resolves.toBe(false);
    await expect(runDeeplinkNavigation(args)).resolves.toBe(false);

    expect(handle.zoomIntoNode).not.toHaveBeenCalled();
    expect(handle.navigateToRoot).not.toHaveBeenCalled();
  });
});

describe("runDeeplinkNavigation — cross-scope jump from a sibling sub-canvas", () => {
  it("calls navigateToRoot() before zoomIntoNode(canvasRef), then focuses the node", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "feature:2", canvasRef: "initiative:B" },
      canvases: {
        "initiative:B": { nodes: [{ id: "feature:2", width: 250 }] },
      },
    });
    const order: string[] = [];
    handle.navigateToRoot.mockImplementation(() => {
      order.push("navigateToRoot");
    });
    handle.zoomIntoNode.mockImplementation((id: string) => {
      order.push(`zoom:${id}`);
      return Promise.resolve();
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(true);

    // Ordering is load-bearing: zoomIntoNode resolves against the
    // currently mounted canvas, so the root climb must happen first.
    expect(order).toEqual([
      "navigateToRoot",
      "zoom:initiative:B",
      "zoom:feature:2",
    ]);
    // Drill-in keeps the chip path's 300ms camera animation.
    expect(handle.zoomIntoNode).toHaveBeenNthCalledWith(
      1,
      "initiative:B",
      { durationMs: 300 },
    );
    expect(handle.zoomIntoNode).toHaveBeenNthCalledWith(
      2,
      "feature:2",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("does NOT call navigateToRoot when starting from root", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "",
      target: { nodeId: "feature:2", canvasRef: "initiative:B" },
      canvases: {
        "initiative:B": { nodes: [{ id: "feature:2", width: 250 }] },
      },
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(true);

    expect(handle.navigateToRoot).not.toHaveBeenCalled();
    expect(handle.zoomIntoNode).toHaveBeenCalledTimes(2);
  });

  it("computes targetZoom from the LANDED canvas, not the pre-navigation one", async () => {
    // `feature:2` exists on BOTH scopes with different widths: the old
    // stale-closure bug would read canvas A's width (1000 → zoom 0.4)
    // instead of the landed canvas B's (250 → zoom 1.6).
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "feature:2", canvasRef: "initiative:B" },
      canvases: {
        "initiative:A": { nodes: [{ id: "feature:2", width: 1000 }] },
        "initiative:B": { nodes: [{ id: "feature:2", width: 250 }] },
      },
      containerWidth: 1000,
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(true);

    expect(handle.zoomIntoNode).toHaveBeenNthCalledWith(
      2,
      "feature:2",
      expect.objectContaining({ targetZoom: 1.6, durationMs: 600 }),
    );
  });

  it("climbs to root when the target IS the root canvas (empty canvasRef)", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "initiative:abc", canvasRef: "" },
      canvases: {
        "": { nodes: [{ id: "initiative:abc", width: 320 }] },
      },
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(true);

    expect(handle.navigateToRoot).toHaveBeenCalledTimes(1);
    // No drill-in (target is root) — only the node focus zoom fires.
    expect(handle.zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(handle.zoomIntoNode).toHaveBeenCalledWith(
      "initiative:abc",
      expect.objectContaining({ durationMs: 600 }),
    );
  });
});

describe("runDeeplinkNavigation — missed focus resolves cleanly", () => {
  it("resolves false (no throw) when the node is not on the landed canvas", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "feature:999", canvasRef: "initiative:B" },
      canvases: {
        // B exists but the node was removed / never pinned there.
        "initiative:B": { nodes: [{ id: "feature:2", width: 250 }] },
      },
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(false);

    // The drill-in happened, but no node zoom was attempted.
    expect(handle.zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(handle.zoomIntoNode).toHaveBeenCalledWith(
      "initiative:B",
      { durationMs: 300 },
    );
  });

  it("resolves false when the drill-in ref does not resolve to a canvas node", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "",
      target: { nodeId: "feature:1", canvasRef: "initiative:deleted" },
      canvases: {
        // Stale scope — nothing on root carries the ref, so the lib's
        // zoomIntoNode resolves without navigating and the lookup misses.
        "": { nodes: [{ id: "note:1" }] },
      },
    });

    await expect(runDeeplinkNavigation(args)).resolves.toBe(false);
    expect(handle.zoomIntoNode).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected node zoom (stale link) and resolves false", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "initiative:A",
      target: { nodeId: "feature:1", canvasRef: "initiative:A" },
      canvases: {
        "initiative:A": { nodes: [{ id: "feature:1", width: 280 }] },
      },
    });
    handle.zoomIntoNode.mockRejectedValue(new Error("node not found"));

    await expect(runDeeplinkNavigation(args)).resolves.toBe(false);
  });

  it("swallows a rejected drill-in and resolves false", async () => {
    const { fake: handle, args } = makeArgs({
      currentRef: "",
      target: { nodeId: "feature:1", canvasRef: "initiative:gone" },
      canvases: {},
    });
    handle.zoomIntoNode.mockRejectedValue(new Error("canvas gone"));

    await expect(runDeeplinkNavigation(args)).resolves.toBe(false);
    expect(handle.navigateToRoot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// targetZoom derivation (unchanged pure helper)
// ---------------------------------------------------------------------------

describe("targetZoom derivation from node width and container width", () => {
  it("derives correct targetZoom from node found in canvas data", () => {
    // node width=320, container=800 → 0.4*800/320 = 1.0
    const zoom = computeNodeFocusZoom(320, 800);
    expect(zoom).toBeCloseTo(1.0, 5);
  });

  it("falls back to default node width 260 when node is not found", () => {
    // width=260 (default), container=800 → 0.4*800/260 ≈ 1.23
    const zoom = computeNodeFocusZoom(260, 800);
    expect(zoom).toBeCloseTo(1.2307, 3);
  });

  it("clamps targetZoom to [0.5, 3.0]", () => {
    expect(computeNodeFocusZoom(1, 1000)).toBe(3.0);
    expect(computeNodeFocusZoom(10000, 800)).toBe(0.5);
  });
});
