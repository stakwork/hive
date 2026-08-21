/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecursionTimelineViz } from "@/components/legal/RecursionTimelineViz";
import type { TimelineLayout } from "@/lib/harvey-lab/timeline-layout";
import type { SubgraphNode } from "@/lib/harvey-lab/hill-climb-series";

globalThis.React = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
const uid = (p = "n") => `${p}-${++_seq}`;

function evalSetNode(ref_id: string): SubgraphNode {
  return { ref_id, node_type: "EvalSet", date_added_to_graph: "1700000000", properties: { name: "My EvalSet" } };
}
function triggerNode(ref_id: string): SubgraphNode {
  return { ref_id, node_type: "EvalTrigger", date_added_to_graph: "1700001000", properties: {} };
}
function outputNode(ref_id: string): SubgraphNode {
  return { ref_id, node_type: "EvalTriggerOutput", date_added_to_graph: "1700002000", properties: { n_passed: 50, n_total: 100 } };
}
function fixNode(ref_id: string): SubgraphNode {
  return { ref_id, node_type: "ProposedFix", date_added_to_graph: "1700003000", properties: { eval_status: "accepted" } };
}

function makeLayout(columns: TimelineLayout["columns"], evalSet?: SubgraphNode): TimelineLayout {
  return {
    columns,
    evalSetNode: evalSet ?? evalSetNode(uid("es")),
    partial: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecursionTimelineViz", () => {
  it("renders 'No timeline data available' when columns is empty", () => {
    const layout: TimelineLayout = { columns: [], evalSetNode: null, partial: false };
    render(<RecursionTimelineViz layout={layout} />);
    expect(screen.getByText(/no timeline data available/i)).toBeTruthy();
  });

  it("renders an SVG for a non-empty layout", () => {
    const tr = uid("tr");
    const out = uid("out");
    const layout = makeLayout([
      {
        runIndex: 0,
        trigger: triggerNode(tr),
        output: outputNode(out),
        proposedFix: null,
        scorePct: 0.50,
        scoreDelta: null,
      },
    ]);
    render(<RecursionTimelineViz layout={layout} />);
    expect(screen.getByTestId("timeline-svg")).toBeTruthy();
  });

  it("renders correct number of run badges", () => {
    const columns: TimelineLayout["columns"] = [
      { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
      { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.6, scoreDelta: 0.1 },
      { runIndex: 2, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.7, scoreDelta: 0.1 },
    ];
    render(<RecursionTimelineViz layout={makeLayout(columns)} />);
    // Each column has a "Run N" badge (1-indexed)
    expect(screen.getByTestId("run-badge-0").textContent).toBe("Run 1");
    expect(screen.getByTestId("run-badge-1").textContent).toBe("Run 2");
    expect(screen.getByTestId("run-badge-2").textContent).toBe("Run 3");
  });

  it("renders green stroke for scorePct >= 0.75", () => {
    const tr = uid("tr");
    const out = uid("out");
    const { container } = render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(tr), output: outputNode(out), proposedFix: null, scorePct: 0.8, scoreDelta: null },
        ])}
      />,
    );
    // The output node rect should have stroke="#16a34a" (green)
    const outputNode0 = container.querySelector("[data-testid='output-node-0'] rect");
    expect(outputNode0?.getAttribute("stroke")).toBe("#16a34a");
  });

  it("renders amber stroke for scorePct >= 0.45 and < 0.75", () => {
    const tr = uid("tr");
    const out = uid("out");
    const { container } = render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(tr), output: outputNode(out), proposedFix: null, scorePct: 0.5, scoreDelta: null },
        ])}
      />,
    );
    const outputNode0 = container.querySelector("[data-testid='output-node-0'] rect");
    expect(outputNode0?.getAttribute("stroke")).toBe("#d97706");
  });

  it("renders red stroke for scorePct < 0.45", () => {
    const tr = uid("tr");
    const out = uid("out");
    const { container } = render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(tr), output: outputNode(out), proposedFix: null, scorePct: 0.3, scoreDelta: null },
        ])}
      />,
    );
    const outputNode0 = container.querySelector("[data-testid='output-node-0'] rect");
    expect(outputNode0?.getAttribute("stroke")).toBe("#dc2626");
  });

  it("renders neutral gray stroke and no fill for null scorePct", () => {
    const tr = uid("tr");
    const out = uid("out");
    const { container } = render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(tr), output: outputNode(out), proposedFix: null, scorePct: null, scoreDelta: null },
        ])}
      />,
    );
    const outputRect = container.querySelector("[data-testid='output-node-0'] rect");
    expect(outputRect?.getAttribute("stroke")).toBe("#6b7280");
    expect(outputRect?.getAttribute("fill")).toBe("none");
  });

  it("does NOT render score delta label on column 0", () => {
    const tr = uid("tr");
    const out = uid("out");
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(tr), output: outputNode(out), proposedFix: null, scorePct: 0.5, scoreDelta: null },
        ])}
      />,
    );
    expect(screen.queryByTestId("score-delta-0")).toBeNull();
  });

  it("renders score delta label on column 1+ when delta != 0", () => {
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
          { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.7, scoreDelta: 0.2 },
        ])}
      />,
    );
    const deltaLabel = screen.getByTestId("score-delta-1");
    expect(deltaLabel).toBeTruthy();
    expect(deltaLabel.textContent).toMatch(/\+20 pts/);
  });

  it("does NOT render delta label when delta is 0", () => {
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
          { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.5, scoreDelta: 0 },
        ])}
      />,
    );
    expect(screen.queryByTestId("score-delta-1")).toBeNull();
  });

  it("renders negative delta label with minus sign", () => {
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.7, scoreDelta: null },
          { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.5, scoreDelta: -0.2 },
        ])}
      />,
    );
    const deltaLabel = screen.getByTestId("score-delta-1");
    expect(deltaLabel.textContent).toMatch(/−20 pts/);
  });

  it("renders EvalSet dashed node when evalSetNode is present", () => {
    const layout: TimelineLayout = {
      columns: [
        { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
      ],
      evalSetNode: evalSetNode(uid("es")),
      partial: false,
    };
    render(<RecursionTimelineViz layout={layout} />);
    expect(screen.getByTestId("evalset-node")).toBeTruthy();
  });

  it("omits EvalSet node when evalSetNode is null", () => {
    const layout: TimelineLayout = {
      columns: [
        { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
      ],
      evalSetNode: null,
      partial: false,
    };
    render(<RecursionTimelineViz layout={layout} />);
    expect(screen.queryByTestId("evalset-node")).toBeNull();
  });

  it("renders trigger node for column 0 only", () => {
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
          { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.6, scoreDelta: 0.1 },
        ])}
      />,
    );
    expect(screen.getByTestId("trigger-node-0")).toBeTruthy();
    expect(screen.queryByTestId("trigger-node-1")).toBeNull();
  });

  it("renders ProposedFix node for columns 1+", () => {
    render(
      <RecursionTimelineViz
        layout={makeLayout([
          { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
          { runIndex: 1, trigger: null, output: outputNode(uid()), proposedFix: fixNode(uid()), scorePct: 0.6, scoreDelta: 0.1 },
        ])}
      />,
    );
    expect(screen.queryByTestId("fix-node-0")).toBeNull();
    expect(screen.getByTestId("fix-node-1")).toBeTruthy();
  });

  it("wraps SVG in a horizontally scrollable container", () => {
    const layout = makeLayout([
      { runIndex: 0, trigger: triggerNode(uid()), output: outputNode(uid()), proposedFix: null, scorePct: 0.5, scoreDelta: null },
    ]);
    const { container } = render(<RecursionTimelineViz layout={layout} />);
    const scrollDiv = container.querySelector("[data-testid='timeline-scroll-container']");
    expect(scrollDiv).toBeTruthy();
    // overflowX should be "auto" (set inline)
    expect((scrollDiv as HTMLElement).style.overflowX).toBe("auto");
  });
});
