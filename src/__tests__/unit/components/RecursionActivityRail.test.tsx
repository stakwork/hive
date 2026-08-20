/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecursionActivityRail } from "@/components/legal/RecursionActivityRail";
import type { AttemptRailRow } from "@/hooks/useEvalRunHistory";

globalThis.React = React;

const mockUseWorkspace = vi.fn();
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

function makeRow(overrides: Partial<AttemptRailRow> = {}): AttemptRailRow {
  return {
    key: "trigger-1",
    label: "base",
    attemptIndex: 0,
    timestamp: "2026-08-18T10:00:00.000Z",
    score: { passed: 50, total: 74 },
    status: "COMPLETED",
    runType: "runner",
    runId: "run-1",
    projectId: 42,
    hasReport: false,
    graphReportRef: null,
    reportPending: false,
    inFlight: false,
    fixSnapshot: null,
    ...overrides,
  };
}

describe("RecursionActivityRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "openlaw", id: "ws-1" },
      role: "DEVELOPER",
      isSuperAdmin: false,
    });
  });

  it("renders an empty state when there are no rows", () => {
    render(<RecursionActivityRail rows={[]} partial={false} />);
    expect(screen.getByTestId("activity-rail-empty")).toBeTruthy();
  });

  it("renders label, status icon, score and relative time per row", () => {
    render(<RecursionActivityRail rows={[makeRow()]} partial={false} />);
    const row = screen.getByTestId("rail-row-trigger-1");
    expect(row.textContent).toContain("base");
    expect(row.textContent).toContain("50/74");
    expect(row.textContent).toContain("ago");
    // Terminal success is a dot with a tooltip — no word cluttering the rail
    const status = screen.getByTestId("rail-status-trigger-1");
    expect(status.getAttribute("data-status")).toBe("COMPLETED");
    expect(status.getAttribute("title")).toBe("completed");
    expect(status.textContent).not.toContain("completed");
  });

  it("renders a graph-only row with an em dash for status", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ status: null, runType: null, runId: null, projectId: null })]}
        partial={false}
      />,
    );
    expect(screen.getByTestId("rail-status-trigger-1").textContent).toBe("—");
  });

  it("in-flight rows spin without the word 'running'", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ status: "IN_PROGRESS", inFlight: true, score: null })]}
        partial={false}
      />,
    );
    const status = screen.getByTestId("rail-status-trigger-1");
    expect(status.getAttribute("data-status")).toBe("IN_PROGRESS");
    expect(status.textContent).not.toContain("running");
    expect(status.querySelector(".animate-spin")).not.toBeNull();
  });

  it("failure states keep their word — a red dot alone under-sells them", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ status: "FAILED", score: null })]}
        partial={false}
      />,
    );
    expect(screen.getByTestId("rail-status-trigger-1").textContent).toContain("failed");
  });

  it("marks a run-only row with the loop icon, stage in the tooltip — no words", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ key: "rec-1", label: null, attemptIndex: null, runType: "recursion", status: "PENDING", inFlight: true, score: null })]}
        partial={false}
      />,
    );
    const icon = screen.getByTestId("rail-pipeline-rec-1");
    expect(icon.getAttribute("title")).toMatch(/recursion loop/i);
    expect(screen.getByTestId("rail-row-rec-1").textContent).not.toContain("analysis");
    expect(screen.getByTestId("rail-row-rec-1").textContent).not.toContain("recursion");
  });

  it("links to the report when the bundle exists", () => {
    render(
      <RecursionActivityRail rows={[makeRow({ hasReport: true })]} partial={false} />,
    );
    const link = screen.getByTestId("rail-report-trigger-1");
    expect(link.getAttribute("href")).toBe("/w/openlaw/legal/benchmarks/runs/run-1/report");
  });

  it("links graph-only rows to the attempt-report page, never the raw bundle URL", () => {
    // Recursion attempts written by the eval workflow carry report_url on the
    // EvalTriggerOutput node and usually never join a StakworkRun row. The link
    // must route through the server-side viewer — a direct S3 href opens bare
    // bundle JSON in the browser.
    render(
      <RecursionActivityRail
        rows={[
          makeRow({
            status: null,
            runType: null,
            runId: null,
            projectId: null,
            graphReportRef: "output-base",
          }),
        ]}
        partial={false}
        taskSlug="environmental-esg/extract-evidence"
      />,
    );
    const link = screen.getByTestId("rail-report-trigger-1");
    expect(link.getAttribute("href")).toBe(
      "/w/openlaw/legal/benchmarks/attempts/output-base/report?task=environmental-esg%2Fextract-evidence",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("hides the graph report link from roles below the report gate", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "openlaw", id: "ws-1" },
      role: "VIEWER",
      isSuperAdmin: false,
    });
    render(
      <RecursionActivityRail
        rows={[makeRow({ runId: null, graphReportRef: "output-base" })]}
        partial={false}
      />,
    );
    expect(screen.queryByTestId("rail-report-trigger-1")).toBeNull();
  });

  it("prefers the run report page over the graph attempt link", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ hasReport: true, graphReportRef: "output-base" })]}
        partial={false}
      />,
    );
    const link = screen.getByTestId("rail-report-trigger-1");
    expect(link.getAttribute("href")).toBe("/w/openlaw/legal/benchmarks/runs/run-1/report");
  });

  it("a landed graph report outranks the report-pending state", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ reportPending: true, graphReportRef: "output-base" })]}
        partial={false}
      />,
    );
    expect(screen.getByTestId("rail-report-trigger-1")).toBeTruthy();
    expect(screen.queryByTestId("rail-report-pending-trigger-1")).toBeNull();
  });

  it("renders the distinct report-pending state, not a link and not blank", () => {
    render(
      <RecursionActivityRail rows={[makeRow({ reportPending: true })]} partial={false} />,
    );
    expect(screen.getByTestId("rail-report-pending-trigger-1")).toBeTruthy();
    expect(screen.queryByTestId("rail-report-trigger-1")).toBeNull();
  });

  it("shows the Stakwork link only for super admins", () => {
    const { unmount } = render(
      <RecursionActivityRail rows={[makeRow()]} partial={false} />,
    );
    expect(screen.queryByText(/View on Stakwork/)).toBeNull();
    unmount();

    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "openlaw", id: "ws-1" },
      isSuperAdmin: true,
    });
    render(<RecursionActivityRail rows={[makeRow()]} partial={false} />);
    expect(screen.getByText(/View on Stakwork/)).toBeTruthy();
  });

  it("shows the incomplete-list note only when the walk was partial", () => {
    const { unmount } = render(
      <RecursionActivityRail rows={[makeRow()]} partial={true} />,
    );
    expect(screen.getByTestId("rail-partial-note")).toBeTruthy();
    unmount();
    render(<RecursionActivityRail rows={[makeRow()]} partial={false} />);
    expect(screen.queryByTestId("rail-partial-note")).toBeNull();
  });
});

describe("RecursionActivityRail — fix snapshot diff control", () => {
  beforeEach(() => {
    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "openlaw", id: "ws-1" },
      role: "ADMIN",
      isSuperAdmin: false,
    });
  });

  it("renders the diff control only when the row carries a snapshot", () => {
    const rows = [
      makeRow({
        key: "with-snapshot",
        fixSnapshot: {
          ref_id: "fix-1",
          target_type: "concept",
          target_name: "Limitation of Liability",
          old_value: '{"docs": "before"}',
          new_value: '{"docs": "after"}',
        },
      }),
      makeRow({ key: "without-snapshot" }),
    ];
    render(<RecursionActivityRail rows={rows} partial={false} />);
    expect(screen.getByTestId("rail-fix-snapshot-with-snapshot")).toBeTruthy();
    expect(screen.queryByTestId("rail-fix-snapshot-without-snapshot")).toBeNull();
  });
});
