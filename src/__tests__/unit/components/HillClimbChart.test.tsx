/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HillClimbChart, toAttemptPoints } from "@/components/legal/HillClimbChart";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

globalThis.React = React;

// ─── SVG mock (jsdom doesn't implement getBoundingClientRect for SVG) ─────────

beforeAll(() => {
  // Minimal SVGSVGElement mock so getBoundingClientRect works in jsdom
  Object.defineProperty(SVGSVGElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 400, height: 140, left: 0, top: 0, right: 400, bottom: 140 }),
  });
});

// d3 uses these; jsdom has partial SVG support — silence the warnings
vi.mock("d3", async () => {
  const actual = await vi.importActual<typeof import("d3")>("d3");
  return actual;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOutput(overrides: Partial<EvalTriggerOutput> = {}): EvalTriggerOutput {
  return {
    ref_id: "out",
    attempt_number: 1,
    result: "pass",
    score: 0.8,
    n_passed: 28,
    n_total: 42,
    ...overrides,
  };
}

const MULTI_POINT_ATTEMPTS: EvalTriggerOutput[] = [
  makeOutput({ ref_id: "a", n_passed: 28 }),
  makeOutput({ ref_id: "b", n_passed: 34 }),
  makeOutput({ ref_id: "c", n_passed: 38 }),
];

// ─── toAttemptPoints ─────────────────────────────────────────────────────────

describe("toAttemptPoints", () => {
  it("marks the first attempt as baseline", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
    expect(pts[0].isBaseline).toBe(true);
    expect(pts[1].isBaseline).toBe(false);
    expect(pts[2].isBaseline).toBe(false);
  });

  it("labels baseline as 'Baseline' and reruns as 'Rerun N'", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
    expect(pts[0].label).toBe("Baseline");
    expect(pts[1].label).toBe("Rerun 1");
    expect(pts[2].label).toBe("Rerun 2");
  });

  it("preserves n_passed and n_total", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
    expect(pts[0].n_passed).toBe(28);
    expect(pts[2].n_passed).toBe(38);
    expect(pts[0].n_total).toBe(42);
  });

  it("returns empty array for empty input", () => {
    expect(toAttemptPoints([])).toEqual([]);
  });
});

// ─── HillClimbChart rendering ─────────────────────────────────────────────────

describe("HillClimbChart", () => {
  it("renders nothing for an empty attempts array", () => {
    const { container } = render(<HillClimbChart attempts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the chart container for a single-point (baseline-only) series", () => {
    render(<HillClimbChart attempts={[makeOutput()]} />);
    expect(screen.getByTestId("hill-climb-chart")).toBeTruthy();
  });

  it("renders the dashed target reference line", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("target-line")).toBeTruthy();
  });

  it("target line is present for single-point case", () => {
    render(<HillClimbChart attempts={[makeOutput({ n_total: 42 })]} />);
    expect(screen.getByTestId("target-line")).toBeTruthy();
  });

  it("renders the climbing polyline for multi-point series", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("climb-polyline")).toBeTruthy();
  });

  it("does NOT render a polyline for a single-point series (only one dot)", () => {
    render(<HillClimbChart attempts={[makeOutput()]} />);
    expect(screen.queryByTestId("climb-polyline")).toBeNull();
  });

  it("renders one dot per attempt", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("dot-0")).toBeTruthy();
    expect(screen.getByTestId("dot-1")).toBeTruthy();
    expect(screen.getByTestId("dot-2")).toBeTruthy();
  });

  it("renders exactly the right number of dots", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dots = MULTI_POINT_ATTEMPTS.map((_, i) => screen.queryByTestId(`dot-${i}`));
    expect(dots.every(Boolean)).toBe(true);
    // No extra dot
    expect(screen.queryByTestId(`dot-${MULTI_POINT_ATTEMPTS.length}`)).toBeNull();
  });

  it("tooltip is not visible initially", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("shows tooltip on dot mouseenter with n_passed/n_total", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-1"); // Rerun 1: 34/42
    fireEvent.mouseEnter(dot);
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toMatch(/34\/42/);
  });

  it("tooltip shows 'Baseline' label for the first dot", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-0"));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/Baseline/);
  });

  it("tooltip shows 'Rerun N' label for subsequent dots", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-2"));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/Rerun/);
  });

  it("hides tooltip on svg mouseleave", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-0");
    fireEvent.mouseEnter(dot);
    expect(screen.getByTestId("chart-tooltip")).toBeTruthy();

    const svg = screen.getByRole("img");
    fireEvent.mouseLeave(svg);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("has an accessible aria-label on the SVG", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toMatch(/42/); // mentions n_total
  });

  it("each dot has an aria-label with n_passed/n_total", () => {
    render(<HillClimbChart attempts={[makeOutput({ n_passed: 28, n_total: 42 })]} />);
    const dot = screen.getByTestId("dot-0");
    expect(dot.getAttribute("aria-label")).toMatch(/28\/42/);
  });
});
