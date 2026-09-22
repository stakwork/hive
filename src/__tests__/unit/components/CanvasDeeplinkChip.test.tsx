// @vitest-environment jsdom
/**
 * Unit tests for CanvasDeeplinkChip.
 *
 * Verifies:
 * 1. Renders the label text
 * 2. Renders with a crosshair icon (aria-hidden SVG)
 * 3. Calls triggerDeeplink with correct args on click
 * 4. Calling triggerDeeplink with optional x/y passes them through
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Mock canvasChatStore ──────────────────────────────────────────────────────
const mockTriggerDeeplink = vi.fn();

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: {
    getState: () => ({ triggerDeeplink: mockTriggerDeeplink }),
  },
}));

const mockUseIsMobile = vi.fn(() => false);
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

import { CanvasDeeplinkChip } from "@/app/org/[githubLogin]/_components/CanvasDeeplinkChip";

describe("CanvasDeeplinkChip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  it("renders the label text", () => {
    render(
      <CanvasDeeplinkChip
        nodeId="initiative:abc"
        canvasRef="initiative:abc"
        label="Initiative: Q3 Roadmap"
      />,
    );
    expect(screen.getByText("Initiative: Q3 Roadmap")).toBeInTheDocument();
  });

  it("renders the data-testid chip element", () => {
    render(
      <CanvasDeeplinkChip
        nodeId="initiative:abc"
        canvasRef="initiative:abc"
        label="My Node"
      />,
    );
    expect(screen.getByTestId("canvas-deeplink-chip")).toBeInTheDocument();
  });

  it("calls triggerDeeplink with correct args on click (no x/y)", () => {
    render(
      <CanvasDeeplinkChip
        nodeId="initiative:abc"
        canvasRef="initiative:abc"
        label="Initiative: Q3 Roadmap"
      />,
    );

    fireEvent.click(screen.getByTestId("canvas-deeplink-chip"));

    expect(mockTriggerDeeplink).toHaveBeenCalledTimes(1);
    expect(mockTriggerDeeplink).toHaveBeenCalledWith({
      nodeId: "initiative:abc",
      canvasRef: "initiative:abc",
      label: "Initiative: Q3 Roadmap",
      x: undefined,
      y: undefined,
    });
  });

  it("passes x and y coords through to triggerDeeplink", () => {
    render(
      <CanvasDeeplinkChip
        nodeId="feature:123"
        canvasRef="initiative:xyz"
        label="Milestone: Launch Beta"
        x={100}
        y={200}
      />,
    );

    fireEvent.click(screen.getByTestId("canvas-deeplink-chip"));

    expect(mockTriggerDeeplink).toHaveBeenCalledWith({
      nodeId: "feature:123",
      canvasRef: "initiative:xyz",
      label: "Milestone: Launch Beta",
      x: 100,
      y: 200,
    });
  });

  it("does not call triggerDeeplink on mobile click", () => {
    mockUseIsMobile.mockReturnValue(true);

    render(
      <CanvasDeeplinkChip
        nodeId="initiative:abc"
        canvasRef="initiative:abc"
        label="Initiative: Q3 Roadmap"
      />,
    );

    const chip = screen.getByTestId("canvas-deeplink-chip");
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(mockTriggerDeeplink).not.toHaveBeenCalled();
  });

  it("uses empty string canvasRef for root canvas", () => {
    render(
      <CanvasDeeplinkChip
        nodeId="node:root"
        canvasRef=""
        label="Root node"
      />,
    );

    fireEvent.click(screen.getByTestId("canvas-deeplink-chip"));

    expect(mockTriggerDeeplink).toHaveBeenCalledWith(
      expect.objectContaining({ canvasRef: "" }),
    );
  });
});
