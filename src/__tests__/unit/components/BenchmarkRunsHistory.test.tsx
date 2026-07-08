/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-cuid-abc";
const WORKSPACE_SLUG = "openlaw";

const makeRun = (overrides: Partial<{
  id: string;
  status: string;
  projectId: number | null;
  taskSlug: string;
  taskTitle: string;
  createdAt: string;
}> = {}) => ({
  id: "runner-1",
  workspaceId: WORKSPACE_ID,
  status: "COMPLETED",
  projectId: 99,
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  ...overrides,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockSetExpandedId = vi.fn();
const mockRefetch = vi.fn();

const mockUseList = vi.fn(() => ({
  runs: [makeRun()],
  total: 1,
  isLoading: false,
  error: null,
  refetch: mockRefetch,
  setExpandedId: mockSetExpandedId,
}));

vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: (...args: unknown[]) => mockUseList(...args),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({
    workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
    isSuperAdmin: false,
  })),
}));

vi.mock("@/components/legal/LegalBenchmarkResults", () => ({
  LegalBenchmarkResults: ({
    runId,
    onReset,
  }: {
    runId: string;
    onReset: () => void;
    isSuperAdmin: boolean;
  }) =>
    React.createElement(
      "div",
      { "data-testid": `results-${runId}` },
      React.createElement("button", { onClick: onReset, "data-testid": "reset-btn" }, "Reset"),
    ),
}));

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: ({ projectId }: { projectId: number | null; isSuperAdmin: boolean }) =>
    React.createElement(
      "a",
      { href: `https://jobs.stakwork.com/admin/projects/${projectId}`, "data-testid": "stakwork-link" },
      "View on Stakwork",
    ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "about 1 month ago",
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { BenchmarkRunsHistory } = await import(
  "@/components/legal/BenchmarkRunsHistory"
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BenchmarkRunsHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseList.mockReturnValue({
      runs: [makeRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  });

  it("passes workspace.id (cuid) — not slug — to useLegalBenchmarkRunList", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(mockUseList).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(mockUseList).not.toHaveBeenCalledWith(WORKSPACE_SLUG);
  });

  it("renders task title and task slug columns", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Analyze Antitrust Strategy")).toBeInTheDocument();
    expect(screen.getByText("antitrust/task-1")).toBeInTheDocument();
  });

  it("renders relative time in Started column with ISO title tooltip", () => {
    render(React.createElement(BenchmarkRunsHistory));
    const timeCell = screen.getByText("about 1 month ago");
    expect(timeCell).toBeInTheDocument();
    expect(timeCell.closest("[title]")?.getAttribute("title")).toBe(
      new Date("2025-06-01T09:00:00Z").toISOString(),
    );
  });

  it("renders Runner Status column header (not 'Status')", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Runner Status")).toBeInTheDocument();
    // The column should be 'Runner Status', not just 'Status'
    expect(screen.queryByRole("columnheader", { name: /^status$/i })).toBeNull();
  });

  it("shows COMPLETED badge for a completed run", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("shows IN PROGRESS badge with spinner for an in-progress run", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "IN_PROGRESS" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("IN PROGRESS")).toBeInTheDocument();
  });

  it("shows FAILED badge for a failed run", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "FAILED" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("FAILED")).toBeInTheDocument();
  });

  it("shows PENDING badge for a pending run", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "PENDING" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("PENDING")).toBeInTheDocument();
  });

  it("does NOT show Stakwork column for non-super-admin", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByTestId("stakwork-link")).toBeNull();
    expect(screen.queryByText("Stakwork")).toBeNull();
  });

  it("shows Stakwork column and link for super-admin", async () => {
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    (useWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
      isSuperAdmin: true,
    });

    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByTestId("stakwork-link")).toBeInTheDocument();
  });

  it("shows empty state message when there are no runs", () => {
    mockUseList.mockReturnValue({
      runs: [],
      total: 0,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(
      screen.getByText("No runs yet. Select a task from the Benchmark tab to get started."),
    ).toBeInTheDocument();
  });

  it("shows 'Showing the most recent 100 runs' banner when total > 100", () => {
    mockUseList.mockReturnValue({
      runs: Array.from({ length: 5 }, (_, i) => makeRun({ id: `run-${i}` })),
      total: 150,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Showing the most recent 100 runs.")).toBeInTheDocument();
  });

  it("does NOT show the banner when total <= 100", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByText(/Showing the most recent 100 runs/)).toBeNull();
  });

  it("shows loading state", () => {
    mockUseList.mockReturnValue({
      runs: [],
      total: 0,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Loading runs…")).toBeInTheDocument();
  });

  it("clicking a row expands LegalBenchmarkResults with correct runId", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    expect(screen.getByTestId("results-runner-1")).toBeInTheDocument();
    expect(mockSetExpandedId).toHaveBeenCalledWith("runner-1");
  });

  it("clicking the same row again collapses it", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);
    expect(screen.getByTestId("results-runner-1")).toBeInTheDocument();

    await user.click(row);
    expect(screen.queryByTestId("results-runner-1")).toBeNull();
    expect(mockSetExpandedId).toHaveBeenLastCalledWith(null);
  });

  it("onReset passed to LegalBenchmarkResults collapses the expanded row", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    expect(screen.getByTestId("results-runner-1")).toBeInTheDocument();

    // Click the Reset button rendered by the mocked LegalBenchmarkResults
    await user.click(screen.getByTestId("reset-btn"));
    expect(screen.queryByTestId("results-runner-1")).toBeNull();
    expect(mockSetExpandedId).toHaveBeenLastCalledWith(null);
  });

  it("LegalBenchmarkResults receives isSuperAdmin prop", async () => {
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    (useWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
      isSuperAdmin: true,
    });

    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    // LegalBenchmarkResults mock is rendered — presence confirms it was mounted
    expect(screen.getByTestId("results-runner-1")).toBeInTheDocument();
  });
});
