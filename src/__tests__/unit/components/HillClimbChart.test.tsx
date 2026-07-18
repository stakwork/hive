/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AttemptPoint } from "@/lib/harvey-lab/attempt-series";

globalThis.React = React;

// ── d3 mock: use real linear scale logic but avoid DOM issues ────────────────
vi.mock("d3-scale", () => ({
  scaleLinear: () => {
    let _domain: [number, number] = [0, 1];
    let _range: [number, number] = [0, 1];
    const scale = (val: number) => {
      const [d0, d1] = _domain;
      const [r0, r1] = _range;
      return r0 + ((val - d0) / (d1 - d0)) * (r1 - r0);
    };
    scale.domain = (d?: [number, number]) => { if (d) { _domain = d; } return scale; };
    scale.range = (r?: [number, number]) => { if (r) { _range = r; } return scale; };
    scale.nice = () => scale;
    return scale;
  },
}));

vi.mock("d3-shape", () => ({
  line: () => {
    let _x: ((d: AttemptPoint) => number) | null = null;
    let _y: ((d: AttemptPoint) => number) | null = null;
    const lineGen = (data: AttemptPoint[]) => {
      if (!data || data.length < 2) return null;
      return "M0,0 L1,1"; // simplified path
    };
    lineGen.x = (fn: (d: AttemptPoint) => number) => { _x = fn; return lineGen; };
    lineGen.y = (fn: (d: AttemptPoint) => number) => { _y = fn; return lineGen; };
    return lineGen;
  },
}));

import { HillClimbChart } from "@/components/legal/HillClimbChart";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(overrides: Partial<AttemptPoint> = {}): AttemptPoint {
  return {
    n_passed: 10,
    n_total: 42,
    createdAt: "2024-01-01T00:00:00Z",
    isBaseline: true,
    attemptIndex: 0,
    ...overrides,
  };
}

const multiSeries: AttemptPoint[] = [
  makePoint({ n_passed: 14, isBaseline: true, attemptIndex: 0, createdAt: "2024-01-01T00:00:00Z" }),
  makePoint({ n_passed: 28, isBaseline: false, attemptIndex: 1, createdAt: "2024-01-02T00:00:00Z" }),
  makePoint({ n_passed: 38, isBaseline: false, attemptIndex: 2, createdAt: "2024-01-03T00:00:00Z" }),
];

const singleSeries: AttemptPoint[] = [
  makePoint({ n_passed: 14, n_total: 42, isBaseline: true, attemptIndex: 0 }),
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("HillClimbChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an SVG element with accessible label", () => {
    render(<HillClimbChart series={multiSeries} label="Test chart" />);
    const svg = screen.getByRole("img", { name: "Test chart" });
    expect(svg).toBeDefined();
  });

  it("renders one dot per attempt point", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(multiSeries.length);
  });

  it("renders a dashed target reference line at n_total", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    // The target line is a <line> with strokeDasharray
    const dashedLines = Array.from(container.querySelectorAll("line")).filter(
      (el) => el.getAttribute("stroke-dasharray") !== null,
    );
    expect(dashedLines.length).toBeGreaterThan(0);
  });

  it("renders a polyline path for multi-point series", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const paths = container.querySelectorAll("path");
    // At least one path should be present for the polyline (may also include others)
    expect(paths.length).toBeGreaterThan(0);
  });

  it("does NOT render a polyline for a single-point series", () => {
    const { container } = render(<HillClimbChart series={singleSeries} />);
    // With a single point, no path is generated (our mock returns null for length < 2)
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(0);
  });

  it("still renders a dot for a single-point baseline-only series", () => {
    const { container } = render(<HillClimbChart series={singleSeries} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(1);
  });

  it("still renders the target line for a single-point series", () => {
    const { container } = render(<HillClimbChart series={singleSeries} />);
    const dashedLines = Array.from(container.querySelectorAll("line")).filter(
      (el) => el.getAttribute("stroke-dasharray") !== null,
    );
    expect(dashedLines.length).toBeGreaterThan(0);
  });

  it("renders nothing for an empty series", () => {
    const { container } = render(<HillClimbChart series={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows tooltip with n_passed/n_total and baseline label on dot hover (baseline)", async () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const circles = container.querySelectorAll("circle");
    // Hover the first dot (baseline)
    fireEvent.mouseEnter(circles[0]);
    // Tooltip should contain the score and "Baseline"
    const tooltipContent = container.textContent ?? "";
    expect(tooltipContent).toContain("14/42");
    expect(tooltipContent).toContain("Baseline");
  });

  it("shows tooltip with rerun label on non-baseline dot hover", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const circles = container.querySelectorAll("circle");
    // Hover the second dot (rerun 1)
    fireEvent.mouseEnter(circles[1]);
    const tooltipContent = container.textContent ?? "";
    expect(tooltipContent).toContain("28/42");
    expect(tooltipContent).toContain("Rerun");
  });

  it("hides tooltip on mouse leave", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const circles = container.querySelectorAll("circle");
    fireEvent.mouseEnter(circles[0]);
    // Tooltip shown
    expect(container.textContent).toContain("Baseline");
    fireEvent.mouseLeave(circles[0]);
    // Tooltip should be gone (no Baseline/Rerun text)
    const afterLeave = container.textContent ?? "";
    // Axis labels like "Base" might still be visible, but not the score
    expect(afterLeave).not.toContain("14/42");
  });

  it("sets aria-label on each dot for accessibility", () => {
    const { container } = render(<HillClimbChart series={multiSeries} />);
    const circles = container.querySelectorAll("circle");
    expect(circles[0].getAttribute("aria-label")).toContain("Baseline");
    expect(circles[0].getAttribute("aria-label")).toContain("14/42");
    expect(circles[1].getAttribute("aria-label")).toContain("Rerun");
  });
});
