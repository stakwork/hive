import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeNodeFocusZoom } from "@/lib/canvas/nodeZoom";

/**
 * Unit tests for the `?node=<id>` deep-link behaviour in OrgCanvasBackground.
 *
 * Rather than mounting the full component (which has heavyweight deps on
 * system-canvas-react, Pusher, NextAuth, etc.), we extract the pure logic
 * helpers and test them in isolation — the same pattern used by
 * `whiteboard-auto-fit.test.ts`.
 */

// ---------------------------------------------------------------------------
// Helpers that replicate the pure logic from OrgCanvasBackground
// ---------------------------------------------------------------------------

interface CanvasHandle {
  zoomIntoNode: (
    id: string,
    opts?: { targetZoom?: number; durationMs?: number },
  ) => Promise<void>;
}

interface CanvasData {
  nodes: Array<{ id: string; width?: number }>;
}

/**
 * Replicates the `scrollToNode` callback body from OrgCanvasBackground.
 */
function runScrollToNode(
  nodeId: string,
  handle: CanvasHandle | null,
  canvasData: CanvasData | null,
  containerWidth: number,
): void {
  if (!nodeId || !handle) return;
  const node = canvasData?.nodes.find((n) => n.id === nodeId);
  const targetZoom = computeNodeFocusZoom(node?.width ?? 260, containerWidth);
  void handle
    .zoomIntoNode(nodeId, { targetZoom, durationMs: 600 })
    .catch(() => {
      // stale link — silent no-op
    });
}

/**
 * Replicates the root-canvas branch of the deep-link useEffect:
 * no `?canvas=` present — call scrollToNode directly after settling.
 */
function runDeepLinkEffect_rootCanvas(
  root: CanvasData | null,
  pendingCanvasRef: string,
  pendingNodeRef: string,
  handle: CanvasHandle | null,
  setDeepLinkInFlight: (v: boolean) => void,
  containerWidth: number,
): void {
  if (!root) return;
  // Root canvas branch: targetRef is empty
  if (pendingCanvasRef === "") {
    setDeepLinkInFlight(false);
    if (pendingNodeRef) {
      runScrollToNode(pendingNodeRef, handle, root, containerWidth);
    }
  }
}

/**
 * Replicates the sub-canvas branch of the deep-link useEffect:
 * `?canvas=<ref>` is present — navigate first, then scrollToNode.
 */
async function runDeepLinkEffect_subCanvas(
  root: CanvasData | null,
  pendingCanvasRef: string,
  pendingNodeRef: string,
  handle: CanvasHandle | null,
  subCanvasData: CanvasData | null,
  setDeepLinkInFlight: (v: boolean) => void,
  containerWidth: number,
): Promise<void> {
  if (!root || !handle) return;
  try {
    await handle.zoomIntoNode(pendingCanvasRef, { durationMs: 0 });
    if (pendingNodeRef) {
      runScrollToNode(pendingNodeRef, handle, subCanvasData, containerWidth);
    }
  } catch (err) {
    // stale canvas ref — silent
  } finally {
    setDeepLinkInFlight(false);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scrollToNode — root canvas (no ?canvas= present)", () => {
  let zoomIntoNode: ReturnType<typeof vi.fn>;
  let setDeepLinkInFlight: ReturnType<typeof vi.fn>;
  let handle: CanvasHandle;
  const root: CanvasData = { nodes: [{ id: "initiative:abc", width: 320 }] };

  beforeEach(() => {
    zoomIntoNode = vi.fn().mockResolvedValue(undefined);
    setDeepLinkInFlight = vi.fn();
    handle = { zoomIntoNode };
  });

  it("calls zoomIntoNode with the node ID when ?node= is present and no ?canvas=", () => {
    runDeepLinkEffect_rootCanvas(root, "", "initiative:abc", handle, setDeepLinkInFlight, 816);

    expect(zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(zoomIntoNode).toHaveBeenCalledWith(
      "initiative:abc",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("sets deepLinkInFlight to false before calling scrollToNode", () => {
    const callOrder: string[] = [];
    setDeepLinkInFlight = vi.fn(() => callOrder.push("setFlight"));
    zoomIntoNode = vi.fn(() => { callOrder.push("zoom"); return Promise.resolve(); });
    handle = { zoomIntoNode };

    runDeepLinkEffect_rootCanvas(root, "", "initiative:abc", handle, setDeepLinkInFlight, 816);

    // setDeepLinkInFlight(false) should be called before zoomIntoNode
    expect(callOrder[0]).toBe("setFlight");
    expect(callOrder[1]).toBe("zoom");
  });

  it("is a no-op when ?node= is empty string", () => {
    runDeepLinkEffect_rootCanvas(root, "", "", handle, setDeepLinkInFlight, 816);

    expect(zoomIntoNode).not.toHaveBeenCalled();
  });

  it("is a no-op when handle is null", () => {
    runScrollToNode("initiative:abc", null, root, 816);
    expect(zoomIntoNode).not.toHaveBeenCalled();
  });

  it("is a no-op when root is null (effect guard)", () => {
    runDeepLinkEffect_rootCanvas(null, "", "initiative:abc", handle, setDeepLinkInFlight, 816);
    expect(zoomIntoNode).not.toHaveBeenCalled();
  });
});

describe("scrollToNode — sub-canvas (?canvas= and ?node= both present)", () => {
  let zoomIntoNode: ReturnType<typeof vi.fn>;
  let setDeepLinkInFlight: ReturnType<typeof vi.fn>;
  let handle: CanvasHandle;
  const root: CanvasData = { nodes: [{ id: "initiative:xyz", width: 280 }] };
  const subCanvas: CanvasData = { nodes: [{ id: "feature:123", width: 240 }] };

  beforeEach(() => {
    zoomIntoNode = vi.fn().mockResolvedValue(undefined);
    setDeepLinkInFlight = vi.fn();
    handle = { zoomIntoNode };
  });

  it("navigates to sub-canvas first, then calls zoomIntoNode for the target node", async () => {
    await runDeepLinkEffect_subCanvas(
      root,
      "initiative:xyz",
      "feature:123",
      handle,
      subCanvas,
      setDeepLinkInFlight,
      816,
    );

    expect(zoomIntoNode).toHaveBeenCalledTimes(2);
    // First call: drill into sub-canvas (durationMs: 0)
    expect(zoomIntoNode).toHaveBeenNthCalledWith(1, "initiative:xyz", { durationMs: 0 });
    // Second call: scroll to node (durationMs: 600)
    expect(zoomIntoNode).toHaveBeenNthCalledWith(
      2,
      "feature:123",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("does not call node zoom when ?node= is empty", async () => {
    await runDeepLinkEffect_subCanvas(
      root,
      "initiative:xyz",
      "",
      handle,
      subCanvas,
      setDeepLinkInFlight,
      816,
    );

    // Only the canvas nav call
    expect(zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(zoomIntoNode).toHaveBeenCalledWith("initiative:xyz", { durationMs: 0 });
  });

  it("swallows zoomIntoNode rejection silently (stale node link)", async () => {
    zoomIntoNode = vi
      .fn()
      .mockResolvedValueOnce(undefined) // first call (canvas nav) resolves
      .mockRejectedValueOnce(new Error("node not found")); // second call (node) rejects
    handle = { zoomIntoNode };

    await expect(
      runDeepLinkEffect_subCanvas(
        root,
        "initiative:xyz",
        "feature:999",
        handle,
        subCanvas,
        setDeepLinkInFlight,
        816,
      ),
    ).resolves.toBeUndefined();
  });

  it("still calls setDeepLinkInFlight(false) even when canvas nav rejects", async () => {
    zoomIntoNode = vi.fn().mockRejectedValue(new Error("deleted initiative"));
    handle = { zoomIntoNode };

    await runDeepLinkEffect_subCanvas(
      root,
      "initiative:deleted",
      "feature:123",
      handle,
      subCanvas,
      setDeepLinkInFlight,
      816,
    );

    expect(setDeepLinkInFlight).toHaveBeenCalledWith(false);
  });
});

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

// ---------------------------------------------------------------------------
// Chip-triggered cross-scope deeplink navigation
// ---------------------------------------------------------------------------

/**
 * Replicates the `pendingDeeplink` useEffect body from OrgCanvasBackground.
 * Cross-scope path: canvasRef !== currentRef → zoomIntoNode(canvasRef) first,
 * then scrollToNode(nodeId).
 */
async function runDeeplinkChipEffect(
  pendingDeeplink: { nodeId: string; canvasRef: string } | null,
  currentRef: string,
  handle: CanvasHandle | null,
  canvasData: CanvasData | null,
  containerWidth: number,
  clearDeeplink: () => void,
): Promise<void> {
  if (!pendingDeeplink || !handle) return;
  const { nodeId, canvasRef } = pendingDeeplink;

  const doNavigate =
    canvasRef && canvasRef !== currentRef
      ? handle
          .zoomIntoNode(canvasRef, { durationMs: 300 })
          .then(() => runScrollToNode(nodeId, handle, canvasData, containerWidth))
      : Promise.resolve().then(() =>
          runScrollToNode(nodeId, handle, canvasData, containerWidth),
        );

  await doNavigate.finally(() => clearDeeplink());
}

describe("CanvasDeeplinkChip — cross-scope navigation (canvasRef !== currentRef)", () => {
  let zoomIntoNode: ReturnType<typeof vi.fn>;
  let clearDeeplink: ReturnType<typeof vi.fn>;
  let handle: CanvasHandle;
  const subCanvas: CanvasData = { nodes: [{ id: "feature:456", width: 280 }] };

  beforeEach(() => {
    zoomIntoNode = vi.fn().mockResolvedValue(undefined);
    clearDeeplink = vi.fn();
    handle = { zoomIntoNode };
  });

  it("calls zoomIntoNode(canvasRef) first, then zoomIntoNode(nodeId) after promise resolves", async () => {
    await runDeeplinkChipEffect(
      { nodeId: "feature:456", canvasRef: "initiative:xyz" },
      /* currentRef = */ "",
      handle,
      subCanvas,
      816,
      clearDeeplink,
    );

    expect(zoomIntoNode).toHaveBeenCalledTimes(2);
    expect(zoomIntoNode).toHaveBeenNthCalledWith(1, "initiative:xyz", {
      durationMs: 300,
    });
    expect(zoomIntoNode).toHaveBeenNthCalledWith(
      2,
      "feature:456",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("calls clearDeeplink in finally after successful navigation", async () => {
    await runDeeplinkChipEffect(
      { nodeId: "feature:456", canvasRef: "initiative:xyz" },
      "",
      handle,
      subCanvas,
      816,
      clearDeeplink,
    );

    expect(clearDeeplink).toHaveBeenCalledTimes(1);
  });

  it("calls clearDeeplink even when canvas nav rejects", async () => {
    zoomIntoNode = vi.fn().mockRejectedValue(new Error("canvas gone"));
    handle = { zoomIntoNode };

    await runDeeplinkChipEffect(
      { nodeId: "feature:456", canvasRef: "initiative:deleted" },
      "",
      handle,
      subCanvas,
      816,
      clearDeeplink,
    ).catch(() => {});

    expect(clearDeeplink).toHaveBeenCalledTimes(1);
  });

  it("skips canvas nav when canvasRef matches currentRef (same-scope)", async () => {
    await runDeeplinkChipEffect(
      { nodeId: "feature:456", canvasRef: "initiative:xyz" },
      /* currentRef = */ "initiative:xyz",
      handle,
      subCanvas,
      816,
      clearDeeplink,
    );

    // Only scrollToNode fires — no canvas nav
    expect(zoomIntoNode).toHaveBeenCalledTimes(1);
    expect(zoomIntoNode).toHaveBeenCalledWith(
      "feature:456",
      expect.objectContaining({ durationMs: 600 }),
    );
  });

  it("is a no-op when pendingDeeplink is null", async () => {
    await runDeeplinkChipEffect(null, "", handle, subCanvas, 816, clearDeeplink);

    expect(zoomIntoNode).not.toHaveBeenCalled();
    expect(clearDeeplink).not.toHaveBeenCalled();
  });
});
