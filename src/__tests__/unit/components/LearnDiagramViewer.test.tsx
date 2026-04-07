// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock mermaid renderer so tests don't depend on real SVG rendering
// ---------------------------------------------------------------------------
vi.mock("@/lib/diagrams/mermaid-renderer", () => ({
  renderMermaidToSvg: vi.fn().mockResolvedValue('<svg><text>diagram</text></svg>'),
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
