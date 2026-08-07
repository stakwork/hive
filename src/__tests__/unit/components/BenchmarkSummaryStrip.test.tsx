/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeRun = (
  overrides: Partial<{
    id: string;
    workspaceId: string;
    status: string;
    taskSlug: string;
    taskTitle: string;
    createdAt: string;
    updatedAt: string;
    n_passed: number;
    n_total: number;
    all_pass: boolean;
  }> = {},
) => ({
  id: "run-1",
  workspaceId: "ws-1",
  status: "COMPLETED",
  projectId: null,
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  updatedAt: new Date("2025-06-01T09:05:00Z").toISOString(),
  n_passed: 8,
  n_total: 10,
  all_pass: true,
  ...overrides,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Default: legal slug, so gate passes
const mockUseWorkspace = vi.fn(() => ({
  workspace: { id: "ws-1", slug: "openlaw" },
  isSuperAdmin: false,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: (_date: Date, _opts?: { addSuffix?: boolean }) =>
    "2 months ago",
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { BenchmarkSummaryStrip } = await import(
  "@/components/legal/BenchmarkSummaryStrip"
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BenchmarkSummaryStrip", () => {
  const onSelectRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-1", slug: "openlaw" },
      isSuperAdmin: false,
    });
  });

  // ── Gate tests ─────────────────────────────────────────────────────────────

  it("renders content for a legal slug (openlaw)", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun()],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    // strip or empty state — either way, it renders something (not null)
    expect(document.body.textContent).not.toBe("");
  });

  it("renders null for a non-legal, non-dev slug", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { id: "ws-2", slug: "some-other-workspace" },
      isSuperAdmin: false,
    });
    const { container } = render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun()],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Loading skeleton ────────────────────────────────────────────────────────

  it("shows skeleton pips while isLoading and runs is empty", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: true,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("benchmark-strip-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip")).toBeNull();
    expect(screen.queryByTestId("benchmark-strip-empty")).toBeNull();
  });

  it("does NOT show skeleton when runs are already loaded (even if isLoading=true)", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun()],
        isLoading: true,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.queryByTestId("benchmark-strip-skeleton")).toBeNull();
    expect(screen.getByTestId("benchmark-strip")).toBeInTheDocument();
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it("shows error affordance when error is set (and not loading)", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: false,
        error: "Network error",
        onSelectRun,
      }),
    );
    const errorEl = screen.getByTestId("benchmark-strip-error");
    expect(errorEl).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip-empty")).toBeNull();
    expect(screen.queryByTestId("benchmark-strip")).toBeNull();
  });

  it("error state is visually distinct from empty state (different testids)", () => {
    const { unmount } = render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: false,
        error: "err",
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("benchmark-strip-error")).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip-empty")).toBeNull();
    unmount();

    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("benchmark-strip-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip-error")).toBeNull();
  });

  it("calls onRetry when the Retry button is clicked (error state)", () => {
    const onRetry = vi.fn();
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: false,
        error: "err",
        onSelectRun,
        onRetry,
      }),
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  it("shows empty state when loaded with no scored runs", () => {
    // Unscored runs (PENDING) should produce empty state
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ status: "PENDING", all_pass: undefined })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("benchmark-strip-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip")).toBeNull();
  });

  it("shows 'No scored runs yet' text in empty state", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByText("No scored runs yet")).toBeInTheDocument();
  });

  // ── Pip rendering ───────────────────────────────────────────────────────────

  it("renders the strip with pips for scored runs", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ id: "r1", all_pass: true }), makeRun({ id: "r2", all_pass: false })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("benchmark-strip")).toBeInTheDocument();
    expect(screen.getByTestId("pip-r1")).toBeInTheDocument();
    expect(screen.getByTestId("pip-r2")).toBeInTheDocument();
  });

  it("pip title includes task title, score, and date", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [
          makeRun({
            id: "r1",
            taskTitle: "Analyze Antitrust Strategy",
            n_passed: 8,
            n_total: 10,
            all_pass: true,
          }),
        ],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    const pip = screen.getByTestId("pip-r1");
    expect(pip.getAttribute("title")).toContain("Analyze Antitrust Strategy");
    expect(pip.getAttribute("title")).toContain("8/10");
    expect(pip.getAttribute("title")).toContain("2 months ago");
  });

  it("pip aria-label matches title", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ id: "r1", all_pass: true })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    const pip = screen.getByTestId("pip-r1");
    expect(pip.getAttribute("aria-label")).toBe(pip.getAttribute("title"));
  });

  it("pip omits score from title when n_passed/n_total absent", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [
          makeRun({
            id: "r1",
            all_pass: true,
            n_passed: undefined,
            n_total: undefined,
          }),
        ],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    const pip = screen.getByTestId("pip-r1");
    expect(pip.getAttribute("title")).not.toContain("/");
  });

  it("clicking a pip calls onSelectRun with the correct run id", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ id: "run-abc" })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    fireEvent.click(screen.getByTestId("pip-run-abc"));
    expect(onSelectRun).toHaveBeenCalledWith("run-abc");
  });

  it("pips are <button> elements (keyboard reachable)", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ id: "r1" })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByTestId("pip-r1").tagName).toBe("BUTTON");
  });

  // ── Average + sub-label ─────────────────────────────────────────────────────

  it("renders avg criteria pass rate label", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ n_passed: 8, n_total: 10, all_pass: true })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByText("avg criteria pass rate")).toBeInTheDocument();
  });

  it("renders '—' for average when no runs qualify for rating", () => {
    // all_pass present (pip) but n_total is missing (no rating)
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ all_pass: true, n_passed: undefined, n_total: undefined })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("sub-label reflects scoredCount and ratedCount when they differ", () => {
    // 2 scored, 1 rated (second run has all_pass but no counts)
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [
          makeRun({ id: "r1", all_pass: true, n_passed: 8, n_total: 10 }),
          makeRun({
            id: "r2",
            all_pass: false,
            n_passed: undefined,
            n_total: undefined,
            updatedAt: new Date("2025-06-02T09:00:00Z").toISOString(),
          }),
        ],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    const subLabel = screen.getByTestId("strip-sub-label");
    // 2 scored, 1 rated
    expect(subLabel.textContent).toContain("2 scored");
    expect(subLabel.textContent).toContain("1 rated");
  });

  it("sub-label scoredCount and ratedCount are equal when all runs have counts", () => {
    render(
      React.createElement(BenchmarkSummaryStrip, {
        runs: [makeRun({ id: "r1", all_pass: true, n_passed: 5, n_total: 5 })],
        isLoading: false,
        error: null,
        onSelectRun,
      }),
    );
    const subLabel = screen.getByTestId("strip-sub-label");
    expect(subLabel.textContent).toContain("1 scored");
    expect(subLabel.textContent).toContain("1 rated");
  });
});
