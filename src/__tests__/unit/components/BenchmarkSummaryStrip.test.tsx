/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowStatus } from "@prisma/client";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

globalThis.React = React;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
const makeRun = (
  overrides: Partial<BenchmarkRunListRow> = {},
): BenchmarkRunListRow => {
  _seq += 1;
  return {
    id: `run-${_seq}`,
    workspaceId: "ws-1",
    runType: "manual",
    status: WorkflowStatus.COMPLETED,
    projectId: null,
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    createdAt: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    n_passed: 8,
    n_total: 10,
    all_pass: true,
    ...overrides,
  };
};

/** One run per supplied pass flag. */
const makeRuns = (passFlags: boolean[]) =>
  passFlags.map((all_pass) => makeRun({ all_pass }));

const { BenchmarkSummaryStrip } = await import(
  "@/components/legal/BenchmarkSummaryStrip"
);

const renderStrip = (
  runs: BenchmarkRunListRow[],
  onWindowChange = vi.fn(),
  windowSize: 10 | 25 | 50 | 100 = 10,
) => {
  render(
    React.createElement(BenchmarkSummaryStrip, {
      runs,
      windowSize,
      onWindowChange,
    }),
  );
  return onWindowChange;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BenchmarkSummaryStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Radix Select needs these APIs, which jsdom does not implement
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  // ── No P/F pips ─────────────────────────────────────────────────────────────

  it("renders no per-run P/F pips", () => {
    const { container } = render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: makeRuns([true, false, false]),
        windowSize: 10 as const,
        onWindowChange: vi.fn(),
      }),
    );
    expect(container.querySelector('[data-testid^="pip-"]')).toBeNull();
    expect(screen.queryByText("P")).toBeNull();
    expect(screen.queryByText("F")).toBeNull();
  });

  // ── Rolling pass rate ───────────────────────────────────────────────────────

  it("shows the run-level pass rate, not the criteria average", () => {
    // 2 of 8 runs fully passed → 25%
    renderStrip(makeRuns([true, true, false, false, false, false, false, false]));
    expect(screen.getByTestId("strip-pass-rate")).toHaveTextContent("25%");
    expect(screen.getByText("rolling pass rate")).toBeInTheDocument();
  });

  it("shows 100% when every scored run passed", () => {
    renderStrip(makeRuns([true, true, true]));
    expect(screen.getByTestId("strip-pass-rate")).toHaveTextContent("100%");
  });

  it("shows 0% when no scored run passed", () => {
    renderStrip(makeRuns([false, false]));
    expect(screen.getByTestId("strip-pass-rate")).toHaveTextContent("0%");
  });

  it("sub-label reports passed-of-scored and the criteria average", () => {
    renderStrip([
      makeRun({ all_pass: true, n_passed: 10, n_total: 10 }),
      makeRun({ all_pass: false, n_passed: 8, n_total: 10 }),
    ]);
    const subLabel = screen.getByTestId("strip-sub-label");
    expect(subLabel.textContent).toContain("1/2 scored runs passed");
    // mean(1.0, 0.8) = 0.9
    expect(subLabel.textContent).toContain("90% avg criteria");
  });

  it("omits the criteria average when no run carries counts", () => {
    renderStrip([
      makeRun({ all_pass: true, n_passed: undefined, n_total: undefined }),
    ]);
    const subLabel = screen.getByTestId("strip-sub-label");
    expect(subLabel.textContent).toContain("1/1 scored runs passed");
    expect(subLabel.textContent).not.toContain("avg criteria");
    expect(screen.getByTestId("strip-pass-rate")).toHaveTextContent("100%");
  });

  // ── Unscored rows are shown by the table but never move the rate ────────────

  it("ignores unscored rows handed in alongside scored ones", () => {
    // The table passes every row in the window, whatever its state
    renderStrip([
      makeRun({ all_pass: true }),
      makeRun({ status: WorkflowStatus.FAILED, all_pass: false }),
      makeRun({ status: WorkflowStatus.PENDING, all_pass: undefined }),
      makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: undefined }),
    ]);
    expect(screen.getByTestId("strip-pass-rate")).toHaveTextContent("100%");
    expect(screen.getByTestId("strip-sub-label").textContent).toContain(
      "1/1 scored runs passed",
    );
  });

  it("shows the empty message when no row in view is scored", () => {
    renderStrip([
      makeRun({ status: WorkflowStatus.PENDING, all_pass: undefined }),
      makeRun({ status: WorkflowStatus.FAILED, all_pass: undefined }),
    ]);
    expect(screen.getByTestId("benchmark-strip-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("strip-pass-rate")).toBeNull();
  });

  it("keeps the window dropdown available even with nothing scored", () => {
    // The dropdown drives the table too, so it must never disappear
    renderStrip([makeRun({ status: WorkflowStatus.PENDING, all_pass: undefined })]);
    expect(screen.getByTestId("summary-window-trigger")).toBeInTheDocument();
  });

  // ── Window dropdown ─────────────────────────────────────────────────────────

  it("renders the window it was given", () => {
    renderStrip(makeRuns([true]), vi.fn(), 25);
    expect(screen.getByTestId("summary-window-trigger")).toHaveTextContent(
      "Last 25",
    );
  });

  it("reports the chosen window to the parent instead of self-managing", async () => {
    const user = userEvent.setup();
    const onWindowChange = renderStrip(makeRuns([true, false]));

    await user.click(screen.getByTestId("summary-window-trigger"));
    await user.click(await screen.findByRole("option", { name: "Last 50" }));

    expect(onWindowChange).toHaveBeenCalledWith(50);
    // Still displays the prop value — the table owns the state
    expect(screen.getByTestId("summary-window-trigger")).toHaveTextContent(
      "Last 10",
    );
  });

  it("offers 10 / 25 / 50 / 100 as window options", async () => {
    const user = userEvent.setup();
    renderStrip(makeRuns([true, false]));

    await user.click(screen.getByTestId("summary-window-trigger"));
    for (const size of [10, 25, 50, 100]) {
      expect(
        await screen.findByRole("option", { name: `Last ${size}` }),
      ).toBeInTheDocument();
    }
  });
});
