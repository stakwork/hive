/**
 * @vitest-environment jsdom
 *
 * Snapshot / render tests for RecursionTimelineViz.
 *
 * Covers:
 *   - null scorePct → neutral gray render, no delta label
 *   - EvalSet dashed connecting edge rendered
 *   - All three score color thresholds (green/amber/red)
 *   - Run N badge text rendered for each column
 *   - scoreDelta label rendered on col > 0 when delta != 0
 *   - Empty layout renders "No timeline data" message
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecursionTimelineViz } from "@/components/legal/RecursionTimelineViz";
import type { TimelineLayout, RunColumn } from "@/lib/harvey-lab/timeline-layout";
import type { SubgraphNode } from "@/lib/harvey-lab/hill-climb-series";

globalThis.React = React;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(ref_id: string, node_type: string): SubgraphNode {
  return { ref_id, node_type, properties: {} };
}

function makeColumn(overrides: Partial<RunColumn> & { runIndex: number }): RunColumn {
  return {
    trigger: null,
    output: null,
    proposedFix: null,
    scorePct: null,
    scoreDelta: null,
    ...overrides,
  };
}

function makeLayout(columns: RunColumn[], evalSetNode: SubgraphNode | null = null): TimelineLayout {
  return { columns, evalSetNode, partial: false };
}

// ─── Empty layout ─────────────────────────────────────────────────────────────

describe("RecursionTimelineViz — empty layout", () => {
  it("renders 'No timeline data available' when columns is empty", () => {
    render(<RecursionTimelineViz layout={makeLayout([])} />);
    expect(screen.getByText(/no timeline data/i)).toBeTruthy();
  });
});

// ─── Run column badges ────────────────────────────────────────────────────────

describe("RecursionTimelineViz — Run N badges", () => {
  it("renders 'Run 1' badge for column 0", () => {
    const layout = makeLayout([
      makeColumn({
        runIndex: 0,
        trigger: makeNode("trigger-0", "EvalTrigger"),
        output: makeNode("output-0", "EvalTriggerOutput"),
        scorePct: 0.8,
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    const svg = container.querySelector("svg");
    expect(svg?.textContent).toContain("Run 1");
  });

  it("renders 'Run 2' badge for column 1", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, trigger: makeNode("t0", "EvalTrigger"), output: makeNode("o0", "EvalTriggerOutput"), scorePct: 0.5 }),
      makeColumn({ runIndex: 1, proposedFix: makeNode("fix1", "ProposedFix"), output: makeNode("o1", "EvalTriggerOutput"), scorePct: 0.6, scoreDelta: 0.1 }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    expect(container.querySelector("svg")?.textContent).toContain("Run 2");
  });

  it("renders a Run badge for every column", () => {
    const cols = [0, 1, 2].map((i) =>
      makeColumn({ runIndex: i, output: makeNode(`o${i}`, "EvalTriggerOutput"), scorePct: 0.5 }),
    );
    const { container } = render(<RecursionTimelineViz layout={makeLayout(cols)} />);
    const svg = container.querySelector("svg");
    expect(svg?.textContent).toContain("Run 1");
    expect(svg?.textContent).toContain("Run 2");
    expect(svg?.textContent).toContain("Run 3");
  });
});

// ─── Output colors ────────────────────────────────────────────────────────────

describe("RecursionTimelineViz — output node color thresholds", () => {
  function renderWithScore(scorePct: number | null) {
    const col = makeColumn({
      runIndex: 0,
      trigger: makeNode("trig", "EvalTrigger"),
      output: makeNode("out", "EvalTriggerOutput"),
      scorePct,
    });
    return render(<RecursionTimelineViz layout={makeLayout([col])} />);
  }

  it("green fill (#dcfce7) for scorePct >= 0.75", () => {
    const { container } = renderWithScore(0.8);
    const rects = container.querySelectorAll("rect");
    const fills = Array.from(rects).map((r) => r.getAttribute("fill"));
    expect(fills).toContain("#dcfce7");
  });

  it("amber fill (#fef3c7) for scorePct = 0.5 (>= 0.45, < 0.75)", () => {
    const { container } = renderWithScore(0.5);
    const rects = container.querySelectorAll("rect");
    const fills = Array.from(rects).map((r) => r.getAttribute("fill"));
    expect(fills).toContain("#fef3c7");
  });

  it("red fill (#fee2e2) for scorePct < 0.45", () => {
    const { container } = renderWithScore(0.3);
    const rects = container.querySelectorAll("rect");
    const fills = Array.from(rects).map((r) => r.getAttribute("fill"));
    expect(fills).toContain("#fee2e2");
  });

  it("neutral gray fill (#f3f4f6) for null scorePct", () => {
    const { container } = renderWithScore(null);
    const rects = container.querySelectorAll("rect");
    const fills = Array.from(rects).map((r) => r.getAttribute("fill"));
    expect(fills).toContain("#f3f4f6");
  });
});

// ─── null scorePct: no delta label ───────────────────────────────────────────

describe("RecursionTimelineViz — null scorePct suppresses delta label", () => {
  it("does not render a pts label when scorePct is null", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, output: makeNode("o0", "EvalTriggerOutput"), scorePct: 0.5 }),
      makeColumn({ runIndex: 1, output: makeNode("o1", "EvalTriggerOutput"), scorePct: null, scoreDelta: null }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    expect(container.querySelector("svg")?.textContent).not.toMatch(/pts/);
  });
});

// ─── Score delta label ────────────────────────────────────────────────────────

describe("RecursionTimelineViz — score delta label", () => {
  it("renders '+N pts' when scoreDelta > 0 and scorePct is not null", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, output: makeNode("o0", "EvalTriggerOutput"), scorePct: 0.5 }),
      makeColumn({
        runIndex: 1,
        proposedFix: makeNode("fix1", "ProposedFix"),
        output: makeNode("o1", "EvalTriggerOutput"),
        scorePct: 0.6,
        scoreDelta: 0.1,
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    // scoreDelta = 0.10 → +10 pts (Math.round(0.1 * 100))
    expect(container.querySelector("svg")?.textContent).toContain("+10 pts");
  });

  it("renders '−N pts' when scoreDelta < 0", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, output: makeNode("o0", "EvalTriggerOutput"), scorePct: 0.7 }),
      makeColumn({
        runIndex: 1,
        proposedFix: makeNode("fix1", "ProposedFix"),
        output: makeNode("o1", "EvalTriggerOutput"),
        scorePct: 0.5,
        scoreDelta: -0.2,
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    expect(container.querySelector("svg")?.textContent).toContain("−20 pts");
  });

  it("suppresses delta label when delta is 0", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, output: makeNode("o0", "EvalTriggerOutput"), scorePct: 0.5 }),
      makeColumn({
        runIndex: 1,
        proposedFix: makeNode("fix1", "ProposedFix"),
        output: makeNode("o1", "EvalTriggerOutput"),
        scorePct: 0.5,
        scoreDelta: 0,
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    expect(container.querySelector("svg")?.textContent).not.toMatch(/pts/);
  });

  it("suppresses delta label on column 0 even when delta is provided", () => {
    // Column 0 should never show a delta
    const layout = makeLayout([
      makeColumn({
        runIndex: 0,
        output: makeNode("o0", "EvalTriggerOutput"),
        scorePct: 0.5,
        scoreDelta: 0.1, // would be unusual but guard against it
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    // runIndex === 0 → delta suppressed
    expect(container.querySelector("svg")?.textContent).not.toMatch(/pts/);
  });
});

// ─── EvalSet dashed connecting edge ──────────────────────────────────────────

describe("RecursionTimelineViz — EvalSet dashed edge", () => {
  it("renders a dashed-border rect for the EvalSet node when evalSetNode is present", () => {
    const evalSetNode = makeNode("evalset-1", "EvalSet");
    const col0 = makeColumn({
      runIndex: 0,
      trigger: makeNode("trig", "EvalTrigger"),
      output: makeNode("out", "EvalTriggerOutput"),
      scorePct: 0.8,
    });
    const { container } = render(
      <RecursionTimelineViz layout={makeLayout([col0], evalSetNode)} />,
    );
    // The EvalSet node renders as a rect with strokeDasharray
    const rects = container.querySelectorAll("rect");
    const dashedRects = Array.from(rects).filter(
      (r) => r.getAttribute("stroke-dasharray") !== null,
    );
    expect(dashedRects.length).toBeGreaterThan(0);
  });

  it("renders a dashed line from the EvalSet to the column-0 trigger when both exist", () => {
    const evalSetNode = makeNode("evalset-1", "EvalSet");
    const col0 = makeColumn({
      runIndex: 0,
      trigger: makeNode("trig", "EvalTrigger"),
      output: makeNode("out", "EvalTriggerOutput"),
      scorePct: 0.8,
    });
    const { container } = render(
      <RecursionTimelineViz layout={makeLayout([col0], evalSetNode)} />,
    );
    // Look for any line with stroke-dasharray (the EvalSet connecting line)
    const lines = container.querySelectorAll("line");
    const dashedLines = Array.from(lines).filter(
      (l) => l.getAttribute("stroke-dasharray") !== null,
    );
    expect(dashedLines.length).toBeGreaterThan(0);
  });

  it("does not render the EvalSet dashed edge when evalSetNode is null", () => {
    const col0 = makeColumn({
      runIndex: 0,
      trigger: makeNode("trig", "EvalTrigger"),
      output: makeNode("out", "EvalTriggerOutput"),
      scorePct: 0.8,
    });
    const { container } = render(
      <RecursionTimelineViz layout={makeLayout([col0], null)} />,
    );
    // Without evalSetNode, no dashed rect should appear at the EvalSet position
    const rects = container.querySelectorAll("rect");
    const dashedRects = Array.from(rects).filter(
      (r) => r.getAttribute("stroke-dasharray") !== null,
    );
    expect(dashedRects.length).toBe(0);
  });
});

// ─── Scroll wrapper ───────────────────────────────────────────────────────────

describe("RecursionTimelineViz — horizontal scroll wrapper", () => {
  it("wraps the SVG in a div with overflowX set", () => {
    const col0 = makeColumn({
      runIndex: 0,
      output: makeNode("o0", "EvalTriggerOutput"),
      scorePct: 0.5,
    });
    const { container } = render(<RecursionTimelineViz layout={makeLayout([col0])} />);
    const wrapper = container.firstElementChild as HTMLElement;
    // The outer div should have overflow: auto (or overflowX: auto)
    expect(wrapper?.style?.overflowX).toBe("auto");
  });
});

// ─── Inter-column bezier edges ────────────────────────────────────────────────

describe("RecursionTimelineViz — inter-column bezier edges", () => {
  it("renders a <path> bezier edge between column 0 and column 1", () => {
    const layout = makeLayout([
      makeColumn({
        runIndex: 0,
        trigger: makeNode("trig", "EvalTrigger"),
        output: makeNode("o0", "EvalTriggerOutput"),
        scorePct: 0.5,
      }),
      makeColumn({
        runIndex: 1,
        proposedFix: makeNode("fix1", "ProposedFix"),
        output: makeNode("o1", "EvalTriggerOutput"),
        scorePct: 0.6,
        scoreDelta: 0.1,
      }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    // At least one <path> with a bezier d attribute (C = cubic bezier command)
    const paths = container.querySelectorAll("path");
    const bezierPaths = Array.from(paths).filter((p) => {
      const d = p.getAttribute("d") ?? "";
      return d.includes("C");
    });
    expect(bezierPaths.length).toBeGreaterThan(0);
  });

  it("renders an arrowhead marker def in the SVG defs", () => {
    const layout = makeLayout([
      makeColumn({ runIndex: 0, trigger: makeNode("t", "EvalTrigger"), output: makeNode("o", "EvalTriggerOutput"), scorePct: 0.5 }),
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    const markers = container.querySelectorAll("marker");
    expect(markers.length).toBeGreaterThan(0);
  });
});
