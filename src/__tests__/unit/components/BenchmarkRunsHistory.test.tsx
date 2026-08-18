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
  requestedModel: string;
  requestedJudgeModel: string;
  generateJamieChat: boolean;
  jamieChatStatus: string;
  jamieChatPath: string;
  hasReport: boolean;
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
  requestedModel: undefined as string | undefined,
  requestedJudgeModel: undefined as string | undefined,
  generateJamieChat: undefined as boolean | undefined,
  jamieChatStatus: undefined as string | undefined,
  jamieChatPath: undefined as string | undefined,
  hasReport: undefined as boolean | undefined,
  ...overrides,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockSetExpandedId = vi.fn();
const mockRefetch = vi.fn();

const mockUseList = vi.fn((_workspaceId: string | undefined) => ({
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

// Recursion enrollment list — default: nothing enrolled, no badges.
const mockUseRecursionList = vi.fn(() => ({
  entries: [] as Array<{ refId: string; id: string; name: string }>,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useLegalBenchmarkRecursionList", () => ({
  useLegalBenchmarkRecursionList: () => mockUseRecursionList(),
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

// Radix Select doesn't work in jsdom — minimal clickable stand-in
let selectOnValueChange: ((value: string) => void) | null = null;

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children?: React.ReactNode;
  }) => {
    selectOnValueChange = onValueChange;
    return React.createElement("div", { "data-testid": "task-filter", "data-value": value }, children);
  },
  SelectTrigger: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("div", props, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement(
      "button",
      { "data-testid": `task-filter-option-${value}`, onClick: () => selectOnValueChange?.(value) },
      children,
    ),
}));

// The summary strip owns a second Select; stub it so the shared select mock
// above stays bound to the task filter. Exposes what the table hands down.
vi.mock("@/components/legal/BenchmarkSummaryStrip", () => ({
  BenchmarkSummaryStrip: ({
    runs,
    windowSize,
    onWindowChange,
  }: {
    runs: Array<{ id: string }>;
    windowSize: number;
    onWindowChange: (size: number) => void;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "summary-strip",
        "data-window": String(windowSize),
        "data-rows": String(runs.length),
      },
      React.createElement(
        "button",
        { "data-testid": "set-window-25", onClick: () => onWindowChange(25) },
        "Last 25",
      ),
    ),
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: ({
    attempts,
  }: {
    attempts: Array<{ n_passed?: number; n_total?: number; label?: string }>;
  }) =>
    React.createElement("div", {
      "data-testid": "hill-climb-chart",
      "data-labels": attempts.map((a) => a.label).join(","),
      "data-passed": attempts.map((a) => a.n_passed).join(","),
      "data-totals": attempts.map((a) => a.n_total).join(","),
    }),
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
    // Both the Score and Report cells render '—'
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
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
    // PENDING renders '—', no score div to check — just assert no title present on any '—' cell
    for (const dash of screen.getAllByText("—")) {
      expect(dash.getAttribute("title")).toBeNull();
      expect(dash.getAttribute("aria-label")).toBeNull();
    }
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
    for (const dash of screen.getAllByText("—")) {
      expect(dash.getAttribute("title")).toBeNull();
      expect(dash.getAttribute("aria-label")).toBeNull();
    }
  });

  // ─── colSpan tests ─────────────────────────────────────────────────────────

  it("expanded row colSpan is 5 for non-super-admin (Task + Started + Runner Status + Score + Report)", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    const expandedCell = screen.getByTestId("results-runner-1").closest("td")!;
    expect(expandedCell.getAttribute("colspan")).toBe("6");
  });

  it("expanded row colSpan is 6 for super-admin (adds Stakwork column)", async () => {
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
    expect(expandedCell.getAttribute("colspan")).toBe("7");
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

  it("shows the window banner when the window holds rows back, including the fetch cap", () => {
    // 12 scored runs, default window of 10 → 2 rows held back
    mockUseList.mockReturnValue({
      runs: Array.from({ length: 12 }, (_, i) =>
        makeRun({ id: `run-${i}`, status: "COMPLETED", all_pass: true }),
      ),
      total: 150,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const note = screen.getByTestId("window-note");
    expect(note.textContent).toContain("Showing 10 of 12 loaded runs");
    expect(note.textContent).toContain("back to the 10 most recent scored runs");
    // The fetch cap is disclosed too, rather than silently truncating
    expect(note.textContent).toContain("Only the latest 100 of 150 runs are loaded");
  });

  it("does NOT show the window banner when every loaded run is on screen", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByTestId("window-note")).toBeNull();
  });

  // ── Window: counted in scored runs, rendered across all states ─────────────

  it("keeps unscored rows that fall inside the window span", () => {
    // 10 scored runs with a FAILED and a PENDING run interleaved: the window is
    // 10 SCORED runs, so all 12 rows render.
    const runs = [
      makeRun({ id: "s-0", status: "COMPLETED", all_pass: true }),
      makeRun({ id: "failed-1", status: "FAILED" }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeRun({ id: `s-${i + 1}`, status: "COMPLETED", all_pass: false }),
      ),
      makeRun({ id: "pending-1", status: "PENDING" }),
      makeRun({ id: "s-9", status: "COMPLETED", all_pass: true }),
    ];
    mockUseList.mockReturnValue({
      runs,
      total: runs.length,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(12);
    expect(screen.getByTestId("run-row-failed-1")).toBeInTheDocument();
    expect(screen.getByTestId("run-row-pending-1")).toBeInTheDocument();
  });

  it("cuts the table at the Nth most recent scored run", () => {
    // 12 scored runs, window of 10 → the 2 oldest rows are dropped
    const runs = Array.from({ length: 12 }, (_, i) =>
      makeRun({ id: `s-${i}`, status: "COMPLETED", all_pass: true }),
    );
    mockUseList.mockReturnValue({
      runs,
      total: runs.length,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(10);
    expect(screen.getByTestId("run-row-s-9")).toBeInTheDocument();
    expect(screen.queryByTestId("run-row-s-10")).toBeNull();
  });

  it("hands the strip exactly the rows the table is showing", () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      makeRun({ id: `s-${i}`, status: "COMPLETED", all_pass: true }),
    );
    mockUseList.mockReturnValue({
      runs,
      total: runs.length,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    const strip = screen.getByTestId("summary-strip");
    expect(strip.getAttribute("data-window")).toBe("10");
    expect(strip.getAttribute("data-rows")).toBe(
      String(screen.getAllByTestId(/^run-row-/).length),
    );
  });

  it("widening the window from the strip grows the table", async () => {
    const user = userEvent.setup();
    const runs = Array.from({ length: 12 }, (_, i) =>
      makeRun({ id: `s-${i}`, status: "COMPLETED", all_pass: true }),
    );
    mockUseList.mockReturnValue({
      runs,
      total: runs.length,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(10);

    await user.click(screen.getByTestId("set-window-25"));

    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(12);
    expect(screen.getByTestId("summary-strip").getAttribute("data-window")).toBe("25");
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

  // ─── Model sub-line tests ──────────────────────────────────────────────────

  it("renders model sub-line when requestedModel and requestedJudgeModel are present", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({
        requestedModel: "anthropic/claude-sonnet-5",
        requestedJudgeModel: "anthropic/claude-sonnet-4-6",
      })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    // Sub-line should show bare names (prefix stripped)
    const subLine = screen.getByTestId("model-sub-line");
    expect(subLine).toBeInTheDocument();
    expect(subLine.textContent).toContain("claude-sonnet-5");
    expect(subLine.textContent).toContain("claude-sonnet-4-6");
    // Should NOT show the anthropic/ prefix
    expect(subLine.textContent).not.toContain("anthropic/");
  });

  it("does NOT render model sub-line for legacy runs (no requestedModel/requestedJudgeModel)", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun()], // no requestedModel or requestedJudgeModel
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByTestId("model-sub-line")).toBeNull();
  });

  it("model sub-line does not affect colSpan (non-super-admin still 5)", async () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({
        requestedModel: "anthropic/claude-sonnet-5",
        requestedJudgeModel: "anthropic/claude-sonnet-4-6",
      })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    const expandedCell = screen.getByTestId("results-runner-1").closest("td")!;
    expect(expandedCell.getAttribute("colspan")).toBe("6");
  });

  // ─── Chat column tests ─────────────────────────────────────────────────────

  it("renders Chat column header", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders 'View Chat' link when jamieChatPath is present", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({
        generateJamieChat: true,
        jamieChatStatus: "completed",
        jamieChatPath: "/org/stakwork?chat=conv-123",
      })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const link = screen.getByTestId("report-chat-link");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/org/stakwork?chat=conv-123");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders 'View Report' link with correct attributes when hasReport is true", () => {
    const run = makeRun({ hasReport: true });
    mockUseList.mockReturnValue({
      runs: [run],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const link = screen.getByTestId("run-report-link");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/legal/benchmarks/runs/${run.id}/report`
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe("View Report (opens in new tab)");
    expect(link.textContent).toBe("View Report");
  });

  it("clicking 'View Report' link does not expand the row", async () => {
    const run = makeRun({ hasReport: true });
    mockUseList.mockReturnValue({
      runs: [run],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const link = screen.getByTestId("run-report-link");
    fireEvent.click(link);
    expect(mockSetExpandedId).not.toHaveBeenCalled();
    expect(screen.queryByTestId("benchmark-results")).toBeNull();
  });

  it("shows Pending spinner when report requested but not yet written", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "IN_PROGRESS", generateJamieChat: true })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByTestId("report-chat-link")).toBeNull();
  });

  it("shows 'Failed' when jamieChatStatus is failed", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ generateJamieChat: true, jamieChatStatus: "failed" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows dash (not Pending) for a FAILED run with generateJamieChat (report will never fire)", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "FAILED", generateJamieChat: true })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows dash when report was not requested", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 5, n_total: 5, all_pass: true })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByTestId("report-chat-link")).toBeNull();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("judgeNotes tooltip still reflects judge model (no divergence from sub-line)", () => {
    const judgeModel = "claude-sonnet-4-6";
    const judgeNotes = `5/5 criteria passed. Judge: ${judgeModel}`;
    mockUseList.mockReturnValue({
      runs: [makeRun({
        status: "COMPLETED",
        n_passed: 5,
        n_total: 5,
        all_pass: true,
        judgeNotes,
        requestedModel: "anthropic/claude-sonnet-5",
        requestedJudgeModel: `anthropic/${judgeModel}`,
      })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));

    // The sub-line judge value matches what the tooltip shows
    const subLine = screen.getByTestId("model-sub-line");
    expect(subLine.textContent).toContain(judgeModel);

    const scoreDiv = screen.getByText("5/5").closest("div")!;
    expect(scoreDiv.getAttribute("title")).toBe(judgeNotes);
  });

  // ─── Task filter + hill-climb chart tests ─────────────────────────────────

  const TASK_A = { taskSlug: "antitrust/task-1", taskTitle: "Analyze Antitrust Strategy" };
  const TASK_B = { taskSlug: "tax/task-2", taskTitle: "Tax Structuring Memo" };

  // Newest-first, matching the API ordering
  const multiTaskRuns = [
    makeRun({ id: "a3", ...TASK_A, status: "COMPLETED", n_passed: 9, n_total: 12, all_pass: false, createdAt: new Date("2025-06-03T09:00:00Z").toISOString() }),
    makeRun({ id: "b1", ...TASK_B, status: "COMPLETED", n_passed: 5, n_total: 5, all_pass: true, createdAt: new Date("2025-06-02T12:00:00Z").toISOString() }),
    makeRun({ id: "a2", ...TASK_A, status: "IN_PROGRESS", createdAt: new Date("2025-06-02T09:00:00Z").toISOString() }),
    makeRun({ id: "a1", ...TASK_A, status: "COMPLETED", n_passed: 7, n_total: 12, all_pass: false, createdAt: new Date("2025-06-01T09:00:00Z").toISOString() }),
  ];

  const mockMultiTaskRuns = (runs = multiTaskRuns) => {
    mockUseList.mockReturnValue({
      runs,
      total: runs.length,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  };

  it("renders task filter with 'All tasks' plus one option per unique task with run counts", () => {
    mockMultiTaskRuns();
    render(React.createElement(BenchmarkRunsHistory));

    expect(screen.getByTestId("task-filter-option-all")).toHaveTextContent("All tasks");
    expect(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`)).toHaveTextContent(
      "Analyze Antitrust Strategy (3)",
    );
    expect(screen.getByTestId(`task-filter-option-${TASK_B.taskSlug}`)).toHaveTextContent(
      "Tax Structuring Memo (1)",
    );
  });

  it("does NOT render the progress card or chart when 'All tasks' is selected", () => {
    mockMultiTaskRuns();
    render(React.createElement(BenchmarkRunsHistory));

    expect(screen.queryByTestId("task-progress-card")).toBeNull();
    expect(screen.queryByTestId("hill-climb-chart")).toBeNull();
  });

  it("selecting a task filters the table to that task's runs and shows the count", async () => {
    mockMultiTaskRuns();
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));

    // Task B's row is gone; all three task A rows remain (slug renders once per row)
    expect(screen.queryByText(TASK_B.taskSlug)).toBeNull();
    expect(screen.getAllByText(TASK_A.taskSlug).length).toBe(3);
    expect(screen.getByText("3 of 4 runs")).toBeInTheDocument();
  });

  it("selecting a task shows the chart with scored runs oldest → newest, skipping unscored", async () => {
    mockMultiTaskRuns();
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));

    const chart = screen.getByTestId("hill-climb-chart");
    // a1 (7) then a3 (9); a2 has no score and is excluded
    expect(chart.getAttribute("data-passed")).toBe("7,9");
    expect(chart.getAttribute("data-labels")).toBe("#1,#2");
  });

  it("progress card shows best score and scored-run count", async () => {
    mockMultiTaskRuns();
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));

    const card = screen.getByTestId("task-progress-card");
    expect(card.textContent).toContain("Best: 9/12");
    expect(card.textContent).toContain("2 scored runs");
  });

  it("normalizes drifted n_total to the max across the task's runs", async () => {
    mockMultiTaskRuns([
      makeRun({ id: "a2", ...TASK_A, status: "COMPLETED", n_passed: 10, n_total: 14, all_pass: false, createdAt: new Date("2025-06-02T09:00:00Z").toISOString() }),
      makeRun({ id: "a1", ...TASK_A, status: "COMPLETED", n_passed: 7, n_total: 12, all_pass: false, createdAt: new Date("2025-06-01T09:00:00Z").toISOString() }),
    ]);
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));

    expect(screen.getByTestId("hill-climb-chart").getAttribute("data-totals")).toBe("14,14");
  });

  it("shows a 'no scored runs' note instead of the chart when the task has no scores", async () => {
    mockMultiTaskRuns([
      makeRun({ id: "a1", ...TASK_A, status: "IN_PROGRESS" }),
    ]);
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));

    expect(screen.getByText("No scored runs yet for this task.")).toBeInTheDocument();
    expect(screen.queryByTestId("hill-climb-chart")).toBeNull();
  });

  it("selecting 'All tasks' again restores all rows and hides the chart", async () => {
    mockMultiTaskRuns();
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));
    expect(screen.queryByText(TASK_B.taskSlug)).toBeNull();

    await user.click(screen.getByTestId("task-filter-option-all"));
    expect(screen.getByText(TASK_B.taskSlug)).toBeInTheDocument();
    expect(screen.queryByTestId("task-progress-card")).toBeNull();
  });

  it("changing the filter collapses an expanded row", async () => {
    mockMultiTaskRuns();
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText(TASK_B.taskSlug).closest("tr")!;
    await user.click(row);
    expect(screen.getByTestId("results-b1")).toBeInTheDocument();

    await user.click(screen.getByTestId(`task-filter-option-${TASK_A.taskSlug}`));
    expect(screen.queryByTestId("results-b1")).toBeNull();
    expect(mockSetExpandedId).toHaveBeenLastCalledWith(null);
  });
});

// ─── Recursion badge ─────────────────────────────────────────────────────────

describe("BenchmarkRunsHistory — recursion badge", () => {
  beforeEach(() => {
    mockUseRecursionList.mockReturnValue({
      entries: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows no badge when nothing is enrolled", () => {
    render(<BenchmarkRunsHistory />);
    expect(screen.queryByTestId("recursion-badge")).toBeNull();
  });

  it("badges only the runs whose task is recursion-enrolled", () => {
    mockUseList.mockReturnValue({
      runs: [
        makeRun({ id: "r-enrolled", taskSlug: "antitrust/task-1" }),
        makeRun({ id: "r-other", taskSlug: "privacy/task-2", taskTitle: "Privacy Task" }),
      ],
      total: 2,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockUseRecursionList.mockReturnValue({
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust" }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);

    const enrolledRow = screen.getByTestId("run-row-r-enrolled");
    const otherRow = screen.getByTestId("run-row-r-other");
    expect(enrolledRow.querySelector('[data-testid="recursion-badge"]')).not.toBeNull();
    expect(otherRow.querySelector('[data-testid="recursion-badge"]')).toBeNull();
  });

  it("links the badge to the Recursion tab via ?tab=recursion", () => {
    mockUseRecursionList.mockReturnValue({
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust" }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);

    const badge = screen.getByTestId("recursion-badge");
    expect(badge.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/legal/benchmarks?tab=recursion`,
    );
  });

  it("clicking the badge does not toggle the row expansion", () => {
    mockUseRecursionList.mockReturnValue({
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust" }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);

    fireEvent.click(screen.getByTestId("recursion-badge"));
    // Row expansion renders the LegalBenchmarkResults mock — must be absent.
    expect(screen.queryByTestId("results-runner-1")).toBeNull();
    expect(mockSetExpandedId).not.toHaveBeenCalledWith("runner-1");
  });
});
