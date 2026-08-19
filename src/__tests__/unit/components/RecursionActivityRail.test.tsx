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
    reportPending: false,
    inFlight: false,
    ...overrides,
  };
}

describe("RecursionActivityRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "openlaw", id: "ws-1" },
      isSuperAdmin: false,
    });
  });

  it("renders an empty state when there are no rows", () => {
    render(<RecursionActivityRail rows={[]} partial={false} />);
    expect(screen.getByTestId("activity-rail-empty")).toBeTruthy();
  });

  it("renders label, status, score and relative time per row", () => {
    render(<RecursionActivityRail rows={[makeRow()]} partial={false} />);
    const row = screen.getByTestId("rail-row-trigger-1");
    expect(row.textContent).toContain("base");
    expect(row.textContent).toContain("completed");
    expect(row.textContent).toContain("50/74");
    expect(row.textContent).toContain("ago");
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

  it("shows a spinner-style running state for in-flight rows", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ status: "IN_PROGRESS", inFlight: true, score: null })]}
        partial={false}
      />,
    );
    expect(screen.getByTestId("rail-status-trigger-1").textContent).toContain("running");
  });

  it("labels a run-only recursion row by pipeline name", () => {
    render(
      <RecursionActivityRail
        rows={[makeRow({ key: "rec-1", label: null, attemptIndex: null, runType: "recursion", status: "PENDING", inFlight: true, score: null })]}
        partial={false}
      />,
    );
    expect(screen.getByTestId("rail-row-rec-1").textContent).toContain("recursion");
  });

  it("links to the report when the bundle exists", () => {
    render(
      <RecursionActivityRail rows={[makeRow({ hasReport: true })]} partial={false} />,
    );
    const link = screen.getByTestId("rail-report-trigger-1");
    expect(link.getAttribute("href")).toBe("/w/openlaw/legal/benchmarks/runs/run-1/report");
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
