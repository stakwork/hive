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
  Object.defineProperty(SVGSVGElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 400, height: 140, left: 0, top: 0, right: 400, bottom: 140 }),
  });
});

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

/** Build a series as buildHillClimbSeries would: with accepted/isBaseline/actualPassed/bestPassed/label */
function makeSeriesOutput(overrides: Partial<EvalTriggerOutput> = {}): EvalTriggerOutput {
  return makeOutput(overrides);
}

const MULTI_POINT_ATTEMPTS: EvalTriggerOutput[] = [
  makeSeriesOutput({ ref_id: "a", n_passed: 28, isBaseline: true, accepted: true, actualPassed: 28, bestPassed: 28, label: "base" }),
  makeSeriesOutput({ ref_id: "b", n_passed: 34, isBaseline: false, accepted: true, actualPassed: 34, bestPassed: 34, label: "r1" }),
  makeSeriesOutput({ ref_id: "c", n_passed: 38, isBaseline: false, accepted: true, actualPassed: 38, bestPassed: 38, label: "r2" }),
];

// ─── toAttemptPoints ─────────────────────────────────────────────────────────

describe("toAttemptPoints", () => {
  it("marks the first attempt as baseline when isBaseline field absent", () => {
    const pts = toAttemptPoints([makeOutput({ ref_id: "a" }), makeOutput({ ref_id: "b" })]);
    expect(pts[0].isBaseline).toBe(true);
    expect(pts[1].isBaseline).toBe(false);
  });

  it("reads isBaseline from series field when present", () => {
    const pts = toAttemptPoints([
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base" }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: 20, bestPassed: 24, label: "r1" }),
    ]);
    expect(pts[0].isBaseline).toBe(true);
    expect(pts[1].isBaseline).toBe(false);
    expect(pts[1].accepted).toBe(false);
  });

  it("uses series-provided label directly", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
    expect(pts[0].label).toBe("base");
    expect(pts[1].label).toBe("r1");
    expect(pts[2].label).toBe("r2");
  });

  it("falls back to index-based labels when label field absent", () => {
    const pts = toAttemptPoints([makeOutput({ ref_id: "a" }), makeOutput({ ref_id: "b" })]);
    expect(pts[0].label).toBe("base");
    expect(pts[1].label).toBe("r1");
  });

  it("uses series-provided bestPassed", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
    expect(pts[0].bestPassed).toBe(28);
    expect(pts[1].bestPassed).toBe(34);
    expect(pts[2].bestPassed).toBe(38);
  });

  it("computes legacy bestPassed (monotonic) when not in series", () => {
    const pts = toAttemptPoints([
      makeOutput({ ref_id: "a", n_passed: 24, n_total: 33 }),
      makeOutput({ ref_id: "b", n_passed: 32, n_total: 33 }),
    ]);
    expect(pts[0].bestPassed).toBe(24);
    expect(pts[1].bestPassed).toBe(32);
  });

  it("actualPassed is null when series marks it null (slot-only point)", () => {
    const pts = toAttemptPoints([
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base" }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: null, bestPassed: 24, label: "r1", n_passed: undefined }),
    ]);
    expect(pts[1].actualPassed).toBeNull();
  });

  it("preserves n_total", () => {
    const pts = toAttemptPoints(MULTI_POINT_ATTEMPTS);
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

  it("renders one dot per accepted attempt", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("dot-0")).toBeTruthy();
    expect(screen.getByTestId("dot-1")).toBeTruthy();
    expect(screen.getByTestId("dot-2")).toBeTruthy();
  });

  // ─── Theme-safe colors ──────────────────────────────────────────────────────

  it("polyline does NOT use hsl(var(--*)) stroke", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const polyline = screen.getByTestId("climb-polyline");
    const stroke = polyline.getAttribute("stroke") ?? "";
    expect(stroke).not.toMatch(/hsl\(var\(/i);
    expect(stroke).toBe("currentColor");
  });

  it("accepted dot does NOT use hsl(var(--*)) fill or stroke", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-1"); // accepted, non-baseline
    const fill = dot.getAttribute("fill") ?? "";
    const stroke = dot.getAttribute("stroke") ?? "";
    expect(fill).not.toMatch(/hsl\(var\(/i);
    expect(stroke).not.toMatch(/hsl\(var\(/i);
  });

  it("accepted dot uses currentColor fill and stroke", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-1");
    expect(dot.getAttribute("fill")).toBe("currentColor");
    expect(dot.getAttribute("stroke")).toBe("currentColor");
  });

  // ─── Rejected dot styling ───────────────────────────────────────────────────

  it("rejected dot renders with fill=none and reduced strokeOpacity", () => {
    const attemptsWithRejected: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: 20, bestPassed: 24, label: "r1", n_passed: 20, n_total: 33 }),
      makeSeriesOutput({ ref_id: "c", isBaseline: false, accepted: true, actualPassed: 32, bestPassed: 32, label: "r2", n_passed: 32, n_total: 33 }),
    ];
    render(<HillClimbChart attempts={attemptsWithRejected} />);
    const rejectedDot = screen.getByTestId("dot-1");
    expect(rejectedDot.getAttribute("fill")).toBe("none");
    expect(rejectedDot.getAttribute("stroke")).toBe("currentColor");
    const strokeOpacity = parseFloat(rejectedDot.getAttribute("stroke-opacity") ?? rejectedDot.getAttribute("strokeopacity") ?? "1");
    expect(strokeOpacity).toBeLessThan(1);
    expect(strokeOpacity).toBeGreaterThan(0);
  });

  it("rejected dot aria-label mentions 'rejected'", () => {
    const attemptsWithRejected: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: 20, bestPassed: 24, label: "r1", n_passed: 20, n_total: 33 }),
    ];
    render(<HillClimbChart attempts={attemptsWithRejected} />);
    const rejectedDot = screen.getByTestId("dot-1");
    expect(rejectedDot.getAttribute("aria-label")).toMatch(/rejected/i);
  });

  // ─── Slot-only point (null actualPassed) ────────────────────────────────────

  it("renders a slot placeholder (no circle) for null actualPassed, but label is still present", () => {
    const attemptsWithSlot: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: null, bestPassed: 24, label: "r1", n_passed: undefined }),
      makeSeriesOutput({ ref_id: "c", isBaseline: false, accepted: true, actualPassed: 32, bestPassed: 32, label: "r2", n_passed: 32, n_total: 33 }),
    ];
    render(<HillClimbChart attempts={attemptsWithSlot} />);

    // No dot for index 1
    expect(screen.queryByTestId("dot-1")).toBeNull();
    // Slot placeholder still exists
    expect(screen.getByTestId("slot-1")).toBeTruthy();
    // r2 dot still rendered at index 2 (labels not shifted)
    expect(screen.getByTestId("dot-2")).toBeTruthy();
  });

  // ─── X-axis labels ──────────────────────────────────────────────────────────

  it("x-axis labels read 'base', 'r1', 'r2' from series label field", () => {
    const { container } = render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const svg = container.querySelector("svg")!;
    const texts = Array.from(svg.querySelectorAll("text")).map((el) => el.textContent ?? "");
    // Should contain base, r1, r2 as x-axis labels
    expect(texts).toContain("base");
    expect(texts).toContain("r1");
    expect(texts).toContain("r2");
  });

  it("x-axis labels include slot label even when dot is skipped", () => {
    const attemptsWithSlot: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: null, bestPassed: 24, label: "r1", n_passed: undefined }),
      makeSeriesOutput({ ref_id: "c", isBaseline: false, accepted: true, actualPassed: 32, bestPassed: 32, label: "r2", n_passed: 32, n_total: 33 }),
    ];
    const { container } = render(<HillClimbChart attempts={attemptsWithSlot} />);
    const svg = container.querySelector("svg")!;
    const texts = Array.from(svg.querySelectorAll("text")).map((el) => el.textContent ?? "");
    expect(texts).toContain("base");
    expect(texts).toContain("r1");
    expect(texts).toContain("r2");
  });

  // ─── Behavioral check: baseline 24/33 + accepted 32/33 ──────────────────────

  it("behavioral check: baseline 24/33 + accepted 32/33 renders exactly 2 dots with rising line", () => {
    const behavioralAttempts: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "base", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "fix1", isBaseline: false, accepted: true, actualPassed: 32, bestPassed: 32, label: "r1", n_passed: 32, n_total: 33 }),
    ];
    render(<HillClimbChart attempts={behavioralAttempts} />);

    // Both dots visible
    const dot0 = screen.getByTestId("dot-0");
    const dot1 = screen.getByTestId("dot-1");
    expect(dot0).toBeTruthy();
    expect(dot1).toBeTruthy();

    // Rising line exists
    expect(screen.getByTestId("climb-polyline")).toBeTruthy();

    // No extra dots
    expect(screen.queryByTestId("dot-2")).toBeNull();

    // Aria labels correct
    expect(dot0.getAttribute("aria-label")).toMatch(/24\/33/);
    expect(dot1.getAttribute("aria-label")).toMatch(/32\/33/);
  });

  // ─── Tooltip ──────────────────────────────────────────────────────────────────

  it("tooltip is not visible initially", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("shows tooltip on dot mouseenter with actualPassed/n_total", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-1"); // r1: 34/42
    fireEvent.mouseEnter(dot);
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toMatch(/34\/42/);
  });

  it("tooltip shows series label (base) for baseline dot", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-0"));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/base/);
  });

  it("tooltip shows series label (r1, r2) for subsequent dots", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-2"));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/r2/);
  });

  it("tooltip for rejected dot shows 'rejected'", () => {
    const attemptsWithRejected: EvalTriggerOutput[] = [
      makeSeriesOutput({ ref_id: "a", isBaseline: true, accepted: true, actualPassed: 24, bestPassed: 24, label: "base", n_passed: 24, n_total: 33 }),
      makeSeriesOutput({ ref_id: "b", isBaseline: false, accepted: false, actualPassed: 20, bestPassed: 24, label: "r1", n_passed: 20, n_total: 33 }),
    ];
    render(<HillClimbChart attempts={attemptsWithRejected} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-1"));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/rejected/i);
  });

  it("hides tooltip on svg mouseleave", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    fireEvent.mouseEnter(screen.getByTestId("dot-0"));
    expect(screen.getByTestId("chart-tooltip")).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole("img"));
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("has an accessible aria-label on the SVG", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toMatch(/42/);
  });

  it("each dot has an aria-label with actualPassed/n_total", () => {
    render(<HillClimbChart attempts={[makeSeriesOutput({ n_passed: 28, n_total: 42, actualPassed: 28, bestPassed: 28, isBaseline: true, accepted: true, label: "base" })]} />);
    const dot = screen.getByTestId("dot-0");
    expect(dot.getAttribute("aria-label")).toMatch(/28\/42/);
  });
});
