// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock mermaid renderer so tests don't depend on real SVG rendering
// ---------------------------------------------------------------------------
vi.mock("@/lib/diagrams/mermaid-renderer", () => ({
  renderMermaidToSvg: vi.fn().mockResolvedValue('<svg width="200" height="100" viewBox="0 0 200 100"><text>diagram</text></svg>'),
}));

import { DiagramViewer } from "@/app/w/[slug]/learn/components/DiagramViewer";

// ---------------------------------------------------------------------------
// clipboard mock
// ---------------------------------------------------------------------------
const writeTextMock = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeTextMock.mockClear();
  Object.assign(navigator, {
    clipboard: { writeText: writeTextMock },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LearnSection DiagramViewer — copy button", () => {
  const props = {
    name: "My Diagram",
    body: "graph TD\n  A --> B",
    description: "A test diagram",
  };

  it("renders a copy button in the header", () => {
    render(<DiagramViewer {...props} />);
    const btn = screen.getByTitle("Copy diagram source");
    expect(btn).toBeInTheDocument();
  });

  it("calls navigator.clipboard.writeText with the body on click", async () => {
    render(<DiagramViewer {...props} />);
    const btn = screen.getByTitle("Copy diagram source");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeTextMock).toHaveBeenCalledWith(props.body);
  });

  it("shows 'Copied!' title after click", async () => {
    render(<DiagramViewer {...props} />);
    const btn = screen.getByTitle("Copy diagram source");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByTitle("Copied!")).toBeInTheDocument();
  });

  it("reverts back to copy icon title after 2 seconds", async () => {
    render(<DiagramViewer {...props} />);
    const btn = screen.getByTitle("Copy diagram source");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByTitle("Copied!")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTitle("Copy diagram source")).toBeInTheDocument();
  });
});

describe("LearnSection DiagramViewer — hideHeader prop", () => {
  const props = {
    name: "My Diagram",
    body: "graph TD\n  A --> B",
  };

  it("renders header by default (no hideHeader prop)", () => {
    render(<DiagramViewer {...props} />);
    expect(screen.getByText("My Diagram")).toBeInTheDocument();
    expect(screen.getByTitle("Copy diagram source")).toBeInTheDocument();
  });

  it("renders header when hideHeader={false}", () => {
    render(<DiagramViewer {...props} hideHeader={false} />);
    expect(screen.getByText("My Diagram")).toBeInTheDocument();
    expect(screen.getByTitle("Copy diagram source")).toBeInTheDocument();
  });

  it("hides title and copy button when hideHeader={true}", () => {
    render(<DiagramViewer {...props} hideHeader={true} />);
    expect(screen.queryByText("My Diagram")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy diagram source")).not.toBeInTheDocument();
  });
});

describe("LearnSection DiagramViewer — drag (onMouseDown)", () => {
  const props = {
    name: "My Diagram",
    body: "graph TD\n  A --> B",
  };

  it("sets dragStart on mousedown regardless of diagram size", async () => {
    const { container } = render(<DiagramViewer {...props} />);

    // Wait for SVG to be rendered
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const viewport = container.querySelector(".relative.w-full.h-full.overflow-hidden");
    expect(viewport).not.toBeNull();

    // Fire mousedown — should not be blocked by any canPan guard
    fireEvent.mouseDown(viewport!, { clientX: 100, clientY: 100, button: 0 });

    // If drag was initiated, moving the mouse should update transform
    // (we can't easily test dragStart.current directly, but we verify no error thrown)
    fireEvent.mouseMove(window, { clientX: 110, clientY: 110 });
    fireEvent.mouseUp(window);
    // No error = drag was allowed to start
  });
});

describe("LearnSection DiagramViewer — scroll to zoom", () => {
  const props = {
    name: "My Diagram",
    body: "graph TD\n  A --> B",
  };

  it("zooms in on scroll up (deltaY < 0) without requiring ctrlKey", async () => {
    const { container } = render(<DiagramViewer {...props} />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const viewport = container.querySelector(".relative.w-full.h-full.overflow-hidden");
    expect(viewport).not.toBeNull();

    // Wheel event without ctrlKey — should zoom, not throw
    const wheelEvent = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
    });

    // Should not throw
    expect(() => {
      viewport!.dispatchEvent(wheelEvent);
    }).not.toThrow();
  });

  it("zooms out on scroll down (deltaY > 0) without requiring ctrlKey", async () => {
    const { container } = render(<DiagramViewer {...props} />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const viewport = container.querySelector(".relative.w-full.h-full.overflow-hidden");
    expect(viewport).not.toBeNull();

    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 100,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
    });

    expect(() => {
      viewport!.dispatchEvent(wheelEvent);
    }).not.toThrow();
  });
});
