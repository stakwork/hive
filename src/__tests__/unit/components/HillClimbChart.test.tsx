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

  it("accepted dot: series fill via currentColor, surface ring via token class", () => {
    // The series group carries text-chart-1; the dot inherits it through
    // currentColor. The ring is the card surface (stroke-card class), never a
    // stroke drawn in the series color — separation comes from surface ink.
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const dot = screen.getByTestId("dot-1");
    expect(dot.getAttribute("fill")).toBe("currentColor");
    expect(dot.getAttribute("stroke")).toBeNull();
    expect(dot.getAttribute("class")).toContain("stroke-card");
    expect(dot.closest("g.text-chart-1")).not.toBeNull();
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

// ─── Flat eval-output series (concept-driven recursion) ──────────────────────

describe("HillClimbChart — flat eval-output series", () => {
  /** What buildEvalOutputSeries emits: real scores in actualPassed, a monotonic
   *  running best in bestPassed (the r2 regression keeps 52 but the line holds 58). */
  const CONCEPT_SERIES: EvalTriggerOutput[] = [
    makeOutput({ ref_id: "o-base", n_passed: 50, n_total: 80, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" }),
    makeOutput({ ref_id: "o-r1", n_passed: 58, n_total: 80, isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" }),
    makeOutput({ ref_id: "o-r2", n_passed: 52, n_total: 80, isBaseline: false, accepted: true, actualPassed: 52, bestPassed: 58, label: "r2" }),
    makeOutput({ ref_id: "o-r3", n_passed: 61, n_total: 80, isBaseline: false, accepted: true, actualPassed: 61, bestPassed: 61, label: "r3" }),
    makeOutput({ ref_id: "o-r4", n_passed: 64, n_total: 80, isBaseline: false, accepted: true, actualPassed: 64, bestPassed: 64, label: "r4" }),
  ];

  it("renders one dot per re-run, with no slots", () => {
    render(<HillClimbChart attempts={CONCEPT_SERIES} />);
    for (let i = 0; i < CONCEPT_SERIES.length; i++) {
      expect(screen.getByTestId(`dot-${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`dot-${CONCEPT_SERIES.length}`)).toBeNull();
    expect(screen.queryByTestId("slot-0")).toBeNull();
  });

  it("labels the baseline and every re-run from the series", () => {
    render(<HillClimbChart attempts={CONCEPT_SERIES} />);
    for (const label of ["base", "r1", "r2", "r3", "r4"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("the regressed dot dips below the line, which itself never falls", () => {
    render(<HillClimbChart attempts={CONCEPT_SERIES} />);

    // Higher n_passed → smaller cy (SVG y grows downward). r2 (52) scored below
    // r1 (58): its DOT sits lower on the chart while the line — driven by the
    // monotonic bestPassed — holds flat at 58 above it.
    const cy = (i: number) => Number(screen.getByTestId(`dot-${i}`).getAttribute("cy"));
    expect(cy(1)).toBeLessThan(cy(0));
    expect(cy(2)).toBeGreaterThan(cy(1));
    expect(cy(3)).toBeLessThan(cy(2));

    // The regressed run is "ignored" by the line: hollow, like a rejected fix.
    expect(screen.getByTestId("dot-2").getAttribute("fill")).toBe("none");
    expect(screen.getByTestId("dot-2").getAttribute("data-state")).toBe("below");

    const path = screen.getByTestId("climb-polyline").getAttribute("d") ?? "";
    expect(path.length).toBeGreaterThan(0);
  });

  it("uses the normalized denominator for the target line and aria labels", () => {
    render(<HillClimbChart attempts={CONCEPT_SERIES} />);
    expect(screen.getByTestId("target-line")).toBeTruthy();
    expect(screen.getByTestId("dot-4").getAttribute("aria-label")).toMatch(/64\/80/);
  });
});

// ─── Dot clipping ────────────────────────────────────────────────────────────

describe("HillClimbChart — dots are clipped to the plot", () => {
  it("wraps the dots in a clipped group", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    const group = screen.getByTestId("dot-group");
    expect(group.getAttribute("clip-path")).toMatch(/^url\(#.+-dots\)$/);
    // The dots really live inside that group
    expect(group.contains(screen.getByTestId("dot-1"))).toBe(true);
  });

  it("keeps an out-of-domain point inside the clipped group rather than loose in the SVG", () => {
    // points[0].n_total drives the whole y-domain; a later point scoring above it
    // would otherwise draw outside the plot.
    const overflowing: EvalTriggerOutput[] = [
      makeOutput({ ref_id: "a", n_passed: 10, n_total: 20, isBaseline: true, accepted: true, actualPassed: 10, bestPassed: 10, label: "base" }),
      makeOutput({ ref_id: "b", n_passed: 90, n_total: 20, isBaseline: false, accepted: true, actualPassed: 90, bestPassed: 90, label: "r1" }),
    ];
    render(<HillClimbChart attempts={overflowing} />);

    const group = screen.getByTestId("dot-group");
    const dot = screen.getByTestId("dot-1");
    expect(group.contains(dot)).toBe(true);
    // Above the plot area — exactly the case the clip exists for
    expect(Number(dot.getAttribute("cy"))).toBeLessThan(0);
  });
});

// ─── Running-best dot states ─────────────────────────────────────────────────

describe("HillClimbChart — running-best dot states", () => {
  /** base 50 → r1 58 (new best) → r2 52 (below) → r3 74 (target) of 74 */
  const STATE_SERIES: EvalTriggerOutput[] = [
    makeOutput({ ref_id: "s0", n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" }),
    makeOutput({ ref_id: "s1", n_passed: 58, n_total: 74, isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" }),
    makeOutput({ ref_id: "s2", n_passed: 52, n_total: 74, isBaseline: false, accepted: true, actualPassed: 52, bestPassed: 52, label: "r2" }),
    makeOutput({ ref_id: "s3", n_passed: 74, n_total: 74, isBaseline: false, accepted: true, actualPassed: 74, bestPassed: 74, label: "r3" }),
  ];

  it("marks dots that set or hold the best with the series color", () => {
    render(<HillClimbChart attempts={STATE_SERIES} />);
    expect(screen.getByTestId("dot-0").getAttribute("data-state")).toBe("best");
    expect(screen.getByTestId("dot-1").getAttribute("data-state")).toBe("best");
    expect(screen.getByTestId("dot-1").getAttribute("fill")).toBe("currentColor");
  });

  it("renders a below-best dot hollow — like a rejected fix — and says so", () => {
    render(<HillClimbChart attempts={STATE_SERIES} />);
    const below = screen.getByTestId("dot-2");
    expect(below.getAttribute("data-state")).toBe("below");
    expect(below.getAttribute("fill")).toBe("none");
    expect(below.getAttribute("stroke")).toBe("currentColor");
    expect(below.getAttribute("aria-label")).toMatch(/below best/i);

    fireEvent.mouseEnter(below);
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/below best · 58/);
  });

  it("turns the ENTIRE series green on a target hit — line, dots, halo", () => {
    render(<HillClimbChart attempts={STATE_SERIES} />);
    const target = screen.getByTestId("dot-3");
    expect(target.getAttribute("data-state")).toBe("target");
    // The whole series group swaps to status green; every currentColor mark
    // (line, filled dots, hollow strokes) inherits it.
    expect(target.closest("g.text-green-600")).not.toBeNull();
    expect(screen.getByTestId("climb-polyline").closest("g.text-green-600")).not.toBeNull();
    expect(target.closest("g.text-chart-1")).toBeNull();
    expect(Number(target.getAttribute("r"))).toBeGreaterThan(
      Number(screen.getByTestId("dot-1").getAttribute("r")),
    );
    expect(screen.getByTestId("halo-3")).toBeTruthy();
    expect(target.getAttribute("aria-label")).toMatch(/target reached/i);

    fireEvent.mouseEnter(target);
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/target reached/i);
  });

  it("keeps the series hue when the target has not been reached", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("dot-1").closest("g.text-chart-1")).not.toBeNull();
    expect(screen.getByTestId("dot-1").closest("g.text-green-600")).toBeNull();
  });

  it("returns to the series color once the score beats the old best again", () => {
    const recovery: EvalTriggerOutput[] = [
      makeOutput({ ref_id: "a", n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" }),
      makeOutput({ ref_id: "b", n_passed: 58, n_total: 74, isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" }),
      makeOutput({ ref_id: "c", n_passed: 52, n_total: 74, isBaseline: false, accepted: true, actualPassed: 52, bestPassed: 52, label: "r2" }),
      makeOutput({ ref_id: "d", n_passed: 60, n_total: 74, isBaseline: false, accepted: true, actualPassed: 60, bestPassed: 60, label: "r3" }),
    ];
    render(<HillClimbChart attempts={recovery} />);
    expect(screen.getByTestId("dot-3").getAttribute("data-state")).toBe("best");
    expect(screen.getByTestId("dot-3").getAttribute("fill")).toBe("currentColor");
  });

  it("a tie with the running best stays in the series color", () => {
    const tie: EvalTriggerOutput[] = [
      makeOutput({ ref_id: "a", n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" }),
      makeOutput({ ref_id: "b", n_passed: 58, n_total: 74, isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" }),
      makeOutput({ ref_id: "c", n_passed: 58, n_total: 74, isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r2" }),
    ];
    render(<HillClimbChart attempts={tie} />);
    expect(screen.getByTestId("dot-2").getAttribute("data-state")).toBe("best");
  });

  it("suppresses the target-edge value when the end label lands on it", () => {
    render(<HillClimbChart attempts={STATE_SERIES} />);
    // Series ends at 74/74 — the bold end label owns the right corner.
    expect(screen.queryByTestId("target-edge-value")).toBeNull();
    expect(screen.getByTestId("end-label").textContent).toBe("74");
  });

  it("keeps the target-edge value when the series ends well below the target", () => {
    render(<HillClimbChart attempts={MULTI_POINT_ATTEMPTS} />);
    expect(screen.getByTestId("target-edge-value")).toBeTruthy();
  });
});
