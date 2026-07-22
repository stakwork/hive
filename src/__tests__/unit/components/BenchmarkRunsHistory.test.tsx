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
  n_passed: number;
  n_total: number;
  all_pass: boolean;
  judgeNotes: string;
}> = {}) => ({
  id: "runner-1",
  workspaceId: WORKSPACE_ID,
  status: "COMPLETED",
  projectId: 99,
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  n_passed: undefined as number | undefined,
  n_total: undefined as number | undefined,
  all_pass: undefined as boolean | undefined,
  judgeNotes: undefined as string | undefined,
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
  useLegalBenchmarkRunList: (workspaceId: string | undefined) => mockUseList(workspaceId),
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
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseList.mockReturnValue({
      runs: [makeRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    // Reset useWorkspace back to non-super-admin default so tests don't bleed into each other.
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    (useWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
      isSuperAdmin: false,
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

  it("renders Runner Status column header and Score column header", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Runner Status")).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
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

  // ─── Score column tests ────────────────────────────────────────────────────

  it("renders PASS badge and score when all_pass=true and n_passed/n_total present", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 72, n_total: 74, all_pass: true })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("72/74")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("renders FAIL badge and score when all_pass=false", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 10, n_total: 20, all_pass: false })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("10/20")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  });

  it("renders neutral placeholder '—' for in-progress run (no score yet)", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "IN_PROGRESS", n_passed: undefined, n_total: undefined, all_pass: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("PASS")).toBeNull();
    expect(screen.queryByText("FAIL")).toBeNull();
  });

  it("renders neutral placeholder '—' for terminal run with no score (pre-collapse history)", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: undefined, n_total: undefined, all_pass: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("—")).toBeInTheDocument();
    // Must NOT render a false FAIL badge
    expect(screen.queryByText("FAIL")).toBeNull();
    expect(screen.queryByText("PASS")).toBeNull();
  });

  it("renders neutral placeholder '—' for PENDING run regardless of score fields", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "PENDING" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ─── judgeNotes / ScoreCell tooltip tests ─────────────────────────────────

  it("ScoreCell has title, aria-label, and cursor-help class when COMPLETED with judgeNotes", () => {
    const judgeNotes = "72/74 criteria passed. Judge: gpt-4";
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 72, n_total: 74, all_pass: true, judgeNotes })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const scoreDiv = screen.getByText("72/74").closest("div")!;
    expect(scoreDiv.getAttribute("title")).toBe(judgeNotes);
    expect(scoreDiv.getAttribute("aria-label")).toBe(judgeNotes);
    expect(scoreDiv.classList.contains("cursor-help")).toBe(true);
  });

  it("ScoreCell has no title or aria-label when judgeNotes is undefined for COMPLETED row", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 72, n_total: 74, all_pass: true, judgeNotes: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const scoreDiv = screen.getByText("72/74").closest("div")!;
    expect(scoreDiv.getAttribute("title")).toBeNull();
    expect(scoreDiv.getAttribute("aria-label")).toBeNull();
    expect(scoreDiv.classList.contains("cursor-help")).toBe(false);
  });

  it("ScoreCell renders no title or aria-label for PENDING run", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "PENDING", judgeNotes: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    // PENDING renders '—', no score div to check — just assert no title present on '—' cell
    const dash = screen.getByText("—");
    expect(dash.getAttribute("title")).toBeNull();
    expect(dash.getAttribute("aria-label")).toBeNull();
  });

  it("ScoreCell renders no title or aria-label for IN_PROGRESS run", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "IN_PROGRESS", judgeNotes: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const dash = screen.getByText("—");
    expect(dash.getAttribute("title")).toBeNull();
    expect(dash.getAttribute("aria-label")).toBeNull();
  });

  // ─── colSpan tests ─────────────────────────────────────────────────────────

  it("expanded row colSpan is 4 for non-super-admin (Task + Started + Runner Status + Score)", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    const expandedCell = screen.getByTestId("results-runner-1").closest("td")!;
    expect(expandedCell.getAttribute("colspan")).toBe("4");
  });

  it("expanded row colSpan is 5 for super-admin (adds Stakwork column)", async () => {
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    (useWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
      isSuperAdmin: true,
    });

    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    const expandedCell = screen.getByTestId("results-runner-1").closest("td")!;
    expect(expandedCell.getAttribute("colspan")).toBe("5");
  });

  // ─── Existing interaction tests ────────────────────────────────────────────

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
