// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  isCopyableNode,
  computePastePosition,
} from "@/app/org/[githubLogin]/connections/useCanvasClipboard";
import useCanvasClipboard from "@/app/org/[githubLogin]/connections/useCanvasClipboard";
import { addNode, removeNode } from "system-canvas-react";
import type { CanvasNode, CanvasData } from "system-canvas-react";
import { useRef } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "abc123",
    type: "text",
    x: 100,
    y: 200,
    text: "Hello",
    width: 220,
    height: 80,
    ...overrides,
  } as CanvasNode;
}

function fireKeydown(
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
  target?: EventTarget,
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    ctrlKey: true,
    ...modifiers,
  });
  if (target) {
    Object.defineProperty(event, "target", { value: target });
  }
  document.dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// isCopyableNode
// ---------------------------------------------------------------------------

describe("isCopyableNode", () => {
  it("returns false for ws: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "ws:abc", type: "text" }))).toBe(false);
  });

  it("returns false for feature: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "feature:xyz", type: "text" }))).toBe(false);
  });

  it("returns false for initiative: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "initiative:1", type: "text" }))).toBe(false);
  });

  it("returns false for milestone: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "milestone:1", type: "text" }))).toBe(false);
  });

  it("returns false for task: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "task:1", type: "text" }))).toBe(false);
  });

  it("returns false for research: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "research:1", type: "text" }))).toBe(false);
  });

  it("returns false for repo: live-id nodes", () => {
    expect(isCopyableNode(makeNode({ id: "repo:1", type: "text" }))).toBe(false);
  });

  it("returns true for note category node", () => {
    expect(isCopyableNode(makeNode({ id: "abc123", type: "text", category: "note" }))).toBe(true);
  });

  it("returns true for decision category node", () => {
    expect(
      isCopyableNode(makeNode({ id: "abc123", type: "text", category: "decision" })),
    ).toBe(true);
  });

  it("returns true for text type node with no category", () => {
    expect(isCopyableNode(makeNode({ id: "abc123", type: "text" }))).toBe(true);
  });

  it("returns true for group type node", () => {
    expect(isCopyableNode(makeNode({ id: "abc123", type: "group" }))).toBe(true);
  });

  it("returns false for service category node (authored but excluded)", () => {
    expect(
      isCopyableNode(makeNode({ id: "abc123", type: "text", category: "service" })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePastePosition
// ---------------------------------------------------------------------------

describe("computePastePosition", () => {
  const SMALL_W = 220;

  it("same viewport: offsets to the right of the node", () => {
    const node = makeNode({ x: 100, y: 200, width: 220, height: 80 });
    const vp = { x: 0, y: 0, zoom: 1 };
    const result = computePastePosition(node, vp, vp, 1000, 800);
    // x = node.x + node.width + 40
    expect(result.x).toBe(100 + 220 + 40);
    expect(result.y).toBe(200);
  });

  it("same viewport: uses SMALL_W when node.width is undefined", () => {
    const node = makeNode({ x: 50, y: 100, width: undefined, height: 80 });
    const vp = { x: 0, y: 0, zoom: 1 };
    const result = computePastePosition(node, vp, vp, 1000, 800);
    expect(result.x).toBe(50 + SMALL_W + 40);
    expect(result.y).toBe(100);
  });

  it("moved viewport (x changed): centers in viewport", () => {
    const node = makeNode({ x: 100, y: 100, width: 220, height: 80 });
    const viewportAtCopy = { x: 0, y: 0, zoom: 1 };
    const viewportNow = { x: -500, y: 0, zoom: 1 }; // panned 500px
    const containerW = 1000;
    const containerH = 800;
    const result = computePastePosition(node, viewportAtCopy, viewportNow, containerW, containerH);
    // centerX = (500 + 500) / 1 = 1000; x = 1000 - 220/2 = 890
    const expectedX = (-viewportNow.x + containerW / 2) / viewportNow.zoom - (node.width ?? SMALL_W) / 2;
    const expectedY = (-viewportNow.y + containerH / 2) / viewportNow.zoom - (node.height ?? 80) / 2;
    expect(result.x).toBeCloseTo(expectedX);
    expect(result.y).toBeCloseTo(expectedY);
  });

  it("moved viewport (zoom changed): centers in viewport", () => {
    const node = makeNode({ x: 100, y: 100, width: 220, height: 80 });
    const viewportAtCopy = { x: 0, y: 0, zoom: 1 };
    const viewportNow = { x: 0, y: 0, zoom: 2 }; // zoomed in
    const containerW = 1000;
    const containerH = 800;
    const result = computePastePosition(node, viewportAtCopy, viewportNow, containerW, containerH);
    const expectedX = (-viewportNow.x + containerW / 2) / viewportNow.zoom - (node.width ?? SMALL_W) / 2;
    const expectedY = (-viewportNow.y + containerH / 2) / viewportNow.zoom - (node.height ?? 80) / 2;
    expect(result.x).toBeCloseTo(expectedX);
    expect(result.y).toBeCloseTo(expectedY);
  });

  it("uses SMALL_W/80 defaults when width/height undefined in moved viewport", () => {
    const node = makeNode({ x: 100, y: 100, width: undefined, height: undefined });
    const viewportAtCopy = { x: 0, y: 0, zoom: 1 };
    const viewportNow = { x: -500, y: 0, zoom: 1 };
    const result = computePastePosition(node, viewportAtCopy, viewportNow, 1000, 800);
    const expectedX = 1000 - SMALL_W / 2;
    const expectedY = 400 - 80 / 2;
    expect(result.x).toBeCloseTo(expectedX);
    expect(result.y).toBeCloseTo(expectedY);
  });
});

// ---------------------------------------------------------------------------
// Hook keyboard integration
// ---------------------------------------------------------------------------

vi.mock("system-canvas-react", async () => {
  const actual = await vi.importActual<typeof import("system-canvas-react")>("system-canvas-react");
  return {
    ...actual,
    addNode: vi.fn((canvas: CanvasData, node: CanvasNode) => ({
      ...canvas,
      nodes: [...(canvas.nodes ?? []), node],
    })),
    removeNode: vi.fn((canvas: CanvasData, id: string) => ({
      ...canvas,
      nodes: (canvas.nodes ?? []).filter((n: CanvasNode) => n.id !== id),
    })),
  };
});

vi.mock("system-canvas", async () => {
  const actual = await vi.importActual<typeof import("system-canvas")>("system-canvas");
  return {
    ...actual,
    generateNodeId: vi.fn(() => "generated-id"),
  };
});

describe("useCanvasClipboard (keyboard integration)", () => {
  let applyMutation: ReturnType<typeof vi.fn>;
  let selectedNode: CanvasNode;

  beforeEach(() => {
    applyMutation = vi.fn();
    selectedNode = makeNode({ id: "note-1", type: "text", category: "note" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderClipboard(node: CanvasNode | null = selectedNode) {
    const currentRefRef = { current: "root" };
    const currentViewportRef = { current: { x: 0, y: 0, zoom: 1 } };
    const canvasContainerRef = { current: null as HTMLDivElement | null };

    const { result } = renderHook(() => {
      const nodeRef = useRef<CanvasNode | null>(node);
      nodeRef.current = node;
      useCanvasClipboard({
        selectedNode: nodeRef.current,
        currentRefRef,
        applyMutation,
        currentViewportRef,
        canvasContainerRef,
      });
    });

    return { result, currentRefRef, currentViewportRef, canvasContainerRef };
  }

  it("Ctrl+C with a copyable node populates the clipboard (via paste working)", () => {
    renderClipboard();

    act(() => {
      fireKeydown("c", { ctrlKey: true });
    });
    // Clipboard is internal; verify by pressing Ctrl+V and checking applyMutation was called
    act(() => {
      fireKeydown("v", { ctrlKey: true });
    });

    expect(applyMutation).toHaveBeenCalledTimes(1);
    // The mutate fn should call addNode
    const mutateFn = applyMutation.mock.calls[0][1];
    const emptyCanvas: CanvasData = { nodes: [], edges: [] };
    mutateFn(emptyCanvas);
    expect(addNode).toHaveBeenCalledWith(
      emptyCanvas,
      expect.objectContaining({ id: "generated-id", category: "note" }),
    );
  });

  it("Ctrl+X removes source node via applyMutation", () => {
    renderClipboard();

    act(() => {
      fireKeydown("x", { ctrlKey: true });
    });

    expect(applyMutation).toHaveBeenCalledTimes(1);
    const mutateFn = applyMutation.mock.calls[0][1];
    const emptyCanvas: CanvasData = { nodes: [], edges: [] };
    mutateFn(emptyCanvas);
    expect(removeNode).toHaveBeenCalledWith(emptyCanvas, "note-1");
  });

  it("Ctrl+V with prior Ctrl+X calls addNode with a new ID", () => {
    renderClipboard();

    act(() => {
      fireKeydown("x", { ctrlKey: true }); // cut
    });
    applyMutation.mockClear();

    act(() => {
      fireKeydown("v", { ctrlKey: true }); // paste
    });

    expect(applyMutation).toHaveBeenCalledTimes(1);
    const mutateFn = applyMutation.mock.calls[0][1];
    const emptyCanvas: CanvasData = { nodes: [], edges: [] };
    mutateFn(emptyCanvas);
    expect(addNode).toHaveBeenCalledWith(
      emptyCanvas,
      expect.objectContaining({ id: "generated-id" }),
    );
  });

  it("Ctrl+C with a live-id node does not change clipboard (Ctrl+V has no effect)", () => {
    const liveNode = makeNode({ id: "ws:workspace-1", type: "text" });
    renderClipboard(liveNode);

    act(() => {
      fireKeydown("c", { ctrlKey: true });
    });
    act(() => {
      fireKeydown("v", { ctrlKey: true });
    });

    // applyMutation never called because clipboard is empty
    expect(applyMutation).not.toHaveBeenCalled();
  });

  it("Ctrl+C when no node selected does not change clipboard", () => {
    renderClipboard(null);

    act(() => {
      fireKeydown("c", { ctrlKey: true });
    });
    act(() => {
      fireKeydown("v", { ctrlKey: true });
    });

    expect(applyMutation).not.toHaveBeenCalled();
  });

  it("Ctrl+C with INPUT as target does not change clipboard", () => {
    // We test this by verifying applyMutation isn't called after a guarded copy
    renderClipboard();

    // Simulate keydown from an INPUT element
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        bubbles: true,
        ctrlKey: true,
      });
      // Dispatch from input so target.tagName is INPUT
      input.dispatchEvent(event);
    });

    // Now try to paste — should not call applyMutation since clipboard is empty
    act(() => {
      fireKeydown("v", { ctrlKey: true });
    });

    expect(applyMutation).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
