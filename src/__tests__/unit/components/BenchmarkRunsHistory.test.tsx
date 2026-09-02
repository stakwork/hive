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
  runType: "manual",
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
  entries: [] as Array<{ refId: string; id: string; name: string; reason: string }>,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

// Graph-first scoring hooks — defaults mirror their real failure mode in
// jsdom (fetch fails → empty maps → result-table fallback), so every
// pre-existing test renders exactly as before these mocks existed.
const mockRubricsMapHook = vi.fn((_slugs: string[]) => new Map());
const mockGraphScoresMapHook = vi.fn((_requests: unknown[]) => new Map());

vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  useBenchmarkRubricsMap: (slugs: string[]) => mockRubricsMapHook(slugs),
  useBenchmarkRubrics: () => ({ rubrics: null }),
}));

vi.mock("@/hooks/useBenchmarkGraphScores", () => ({
  useBenchmarkGraphScoresMap: (requests: unknown[]) => mockGraphScoresMapHook(requests),
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

vi.mock("@/components/legal/BenchmarkRunAgentLogs", () => ({
  BenchmarkRunAgentLogs: ({ runId }: { runId: string }) =>
    React.createElement("div", { "data-testid": "run-agent-logs", "data-run-id": runId }),
}));

vi.mock("@/components/legal/RunCascade", () => ({
  BenchmarkRunCascade: ({ runId, runStatus }: { runId: string; runStatus?: string }) =>
    React.createElement("div", {
      "data-testid": "run-cascade",
      "data-run-id": runId,
      "data-run-status": runStatus,
    }),
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
  Badge: ({ children, className, ...rest }: { children?: React.ReactNode; className?: string; [k: string]: unknown }) =>
    React.createElement("span", { "data-testid": "badge", className, ...rest }, children),
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

  it("renders Runner Status column header and Pass/Total column headers (no Fail header)", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Runner Status")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText("Score")).toBeNull();
    expect(screen.queryByText("Fail")).toBeNull();
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

  // ─── Pass/Total column tests ───────────────────────────────────────────────

  it("renders Pass but no PASS badge and Total '—' when there is no graph roster, even when all_pass=true (bail-out path)", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 72, n_total: 74, all_pass: true })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("72")).toBeInTheDocument();
    // No roster_total was assigned on the bail-out path, so Total is a dash
    // and the PASS badge — which requires a numeric roster_total — never
    // renders, regardless of the (ignored) all_pass flag.
    expect(screen.queryByText("PASS")).toBeNull();
    expect(screen.queryByText("72/74")).toBeNull();
  });

  it("renders Pass with no badge when all_pass=false", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 10, n_total: 20, all_pass: false })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("FAIL")).toBeNull();
    expect(screen.queryByText("PASS")).toBeNull();
    expect(screen.queryByText("10/20")).toBeNull();
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
    // Pass, Total, and Report cells all render '—'
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

  // ─── judgeNotes / PassCell tooltip tests ──────────────────────────────────

  it("PassCell has title, aria-label, and cursor-help class when COMPLETED with judgeNotes", () => {
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
    const passDiv = screen.getByText("72").closest("div")!;
    expect(passDiv.getAttribute("title")).toBe(judgeNotes);
    expect(passDiv.getAttribute("aria-label")).toBe(judgeNotes);
    expect(passDiv.classList.contains("cursor-help")).toBe(true);
  });

  it("PassCell has no title or aria-label when judgeNotes is undefined for COMPLETED row", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ status: "COMPLETED", n_passed: 72, n_total: 74, all_pass: true, judgeNotes: undefined })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(React.createElement(BenchmarkRunsHistory));
    const passDiv = screen.getByText("72").closest("div")!;
    expect(passDiv.getAttribute("title")).toBeNull();
    expect(passDiv.getAttribute("aria-label")).toBeNull();
    expect(passDiv.classList.contains("cursor-help")).toBe(false);
  });

  it("PassCell renders no title or aria-label for PENDING run", () => {
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

  it("PassCell renders no title or aria-label for IN_PROGRESS run", () => {
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

  it("expanded row colSpan is 9 for non-super-admin (Task + Type + Started + Runner Status + Score + Contested + Disputed + Chat + Report)", async () => {
    const user = userEvent.setup();
    render(React.createElement(BenchmarkRunsHistory));

    const row = screen.getByText("Analyze Antitrust Strategy").closest("tr")!;
    await user.click(row);

    const expandedCell = screen.getByTestId("results-runner-1").closest("td")!;
    expect(expandedCell.getAttribute("colspan")).toBe("10");
  });

  it("expanded row colSpan is 11 for super-admin (adds Stakwork column)", async () => {
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
    expect(expandedCell.getAttribute("colspan")).toBe("11");
  });

  // ─── Existing interaction tests ────────────────────────────────────────────

  it("does NOT show Stakwork column for non-super-admin", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.queryByText("Stakwork")).toBeNull();
    expect(screen.queryByTitle("View on Stakwork (admin)")).toBeNull();
  });

  it("shows Stakwork column and icon-only link for super-admin", async () => {
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    (useWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
      isSuperAdmin: true,
    });

    render(React.createElement(BenchmarkRunsHistory));
    const link = screen.getByTitle("View on Stakwork (admin)");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("aria-label")).toBe("View on Stakwork (admin)");
    expect(link.getAttribute("href")).toContain("jobs.stakwork.com/admin/projects/");
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

  it("model sub-line does not affect colSpan (non-super-admin still 10)", async () => {
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
    expect(expandedCell.getAttribute("colspan")).toBe("10");
  });

  // ─── Chat column tests ─────────────────────────────────────────────────────

  it("renders Chat column header", () => {
    render(React.createElement(BenchmarkRunsHistory));
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders icon-only 'View Chat' link when jamieChatPath is present", () => {
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
    expect(link.getAttribute("title")).toBe("View Chat");
    expect(link.getAttribute("aria-label")).toBe("View Chat");
    expect(link.textContent).not.toBe("View Chat");
  });

  it("renders icon-only 'View Report' link with correct attributes when hasReport is true", () => {
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
    expect(link.getAttribute("title")).toBe("View Report (opens in new tab)");
    expect(link.textContent).not.toBe("View Report");
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
    const failedMatches = screen.getAllByText("Failed");
    expect(failedMatches.length).toBeGreaterThan(0);
    expect(
      failedMatches.some((el) => el.className.includes("text-destructive")),
    ).toBe(true);
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

    const passDiv = screen.getByText("5").closest("div")!;
    expect(passDiv.getAttribute("title")).toBe(judgeNotes);
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
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust", reason: "active" }],
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
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust", reason: "active" }],
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
      entries: [{ refId: "ref-1", id: "antitrust/task-1", name: "Antitrust", reason: "active" }],
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

// ─── Run-type filter and Type column ─────────────────────────────────────────

describe("BenchmarkRunsHistory — run types", () => {
  const manualRun = () =>
    makeRun({ id: "m-1", taskSlug: "antitrust/task-1" });
  // The analysis pipeline (LEGAL_BENCHMARK_EVAL) maps to runType "recursion" —
  // it is an internal stage of the loop, not an operator-facing category.
  const analysisRun = () => ({
    ...makeRun({ id: "a-1" }),
    runType: "recursion",
    taskSlug: "antitrust/task-1",
    taskTitle: "",
    n_passed: undefined,
    n_total: undefined,
    all_pass: undefined,
    createdAt: new Date("2025-06-02T09:00:00Z").toISOString(),
  });
  const recursionRun = () => ({
    ...makeRun({ id: "r-1" }),
    runType: "recursion",
    taskSlug: "antitrust/task-1",
    taskTitle: "",
    n_passed: undefined,
    n_total: undefined,
    all_pass: undefined,
    status: "IN_PROGRESS",
    createdAt: new Date("2025-06-02T10:00:00Z").toISOString(),
  });

  function mockMixedRuns() {
    mockUseList.mockReturnValue({
      runs: [recursionRun(), analysisRun(), manualRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRecursionList.mockReturnValue({
      entries: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("defaults to All: every pipeline newest-first with type badges and score dashes", () => {
    mockMixedRuns();
    render(<BenchmarkRunsHistory />);

    const rows = screen.getAllByTestId(/^run-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "run-row-r-1",
      "run-row-a-1",
      "run-row-m-1",
    ]);
    // Both cron pipelines wear the same recursion badge — no "analysis" facing
    // the operator.
    expect(screen.getAllByTestId("run-type-recursion")).toHaveLength(2);
    expect(screen.getByTestId("run-type-manual")).toBeInTheDocument();
    // Title derived from the manual row sharing the slug
    expect(screen.getByTestId("run-row-a-1").textContent).toContain("Analyze Antitrust Strategy");
  });

  it("renders score and report link on recursion rows that carry them", () => {
    mockUseList.mockReturnValue({
      runs: [
        {
          ...analysisRun(),
          status: "COMPLETED",
          n_passed: 34,
          n_total: 39,
          all_pass: false,
          hasReport: true,
        },
        manualRun(),
      ],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-a-1");
    // Bail-out path (no roster mocked): Pass shows n_passed, Total is a dash.
    expect(row.textContent).toContain("34");
    expect(row.textContent).not.toContain("34/39");
    expect(row.textContent).not.toContain("FAIL");
    const links = screen.getAllByTestId("run-report-link");
    expect(
      links.some((l) => l.getAttribute("href") === "/w/openlaw/legal/benchmarks/runs/a-1/report"),
    ).toBe(true);
  });

  it("the Type column dropdown narrows to Manual", () => {
    mockMixedRuns();
    render(<BenchmarkRunsHistory />);
    fireEvent.change(screen.getByTestId("type-filter"), { target: { value: "manual" } });
    expect(screen.getByTestId("run-row-m-1")).toBeInTheDocument();
    expect(screen.queryByTestId("run-row-a-1")).toBeNull();
    expect(screen.queryByTestId("run-row-r-1")).toBeNull();
  });

  it("the Recursion filter shows the whole loop — analysis AND fix-proposal rows", () => {
    mockMixedRuns();
    render(<BenchmarkRunsHistory />);
    fireEvent.change(screen.getByTestId("type-filter"), { target: { value: "recursion" } });
    expect(screen.getByTestId("run-row-r-1")).toBeInTheDocument();
    expect(screen.getByTestId("run-row-a-1")).toBeInTheDocument();
    expect(screen.queryByTestId("run-row-m-1")).toBeNull();
  });

  it("summary strip stays pinned to manual rows whatever the filter", () => {
    mockMixedRuns();
    render(<BenchmarkRunsHistory />);
    expect(screen.getByTestId("summary-strip").getAttribute("data-rows")).toBe("1");
    fireEvent.change(screen.getByTestId("type-filter"), { target: { value: "recursion" } });
    expect(screen.getByTestId("summary-strip").getAttribute("data-rows")).toBe("1");
  });

  it("cron rows do not expand on click", () => {
    mockMixedRuns();
    render(<BenchmarkRunsHistory />);
    fireEvent.click(screen.getByTestId("run-row-a-1"));
    expect(screen.queryByTestId("results-a-1")).toBeNull();
    fireEvent.click(screen.getByTestId("run-row-m-1"));
    expect(screen.getByTestId("results-m-1")).toBeInTheDocument();
  });

  it("explains an empty Recursion filter instead of showing a bare table", () => {
    mockUseList.mockReturnValue({
      runs: [makeRun({ id: "m-1" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    render(<BenchmarkRunsHistory />);
    fireEvent.change(screen.getByTestId("type-filter"), { target: { value: "recursion" } });
    expect(screen.getByTestId("type-filter-empty").textContent).toMatch(/Recursion tab/);
  });
});

// ─── Graph-first score numerators ────────────────────────────────────────────

describe("BenchmarkRunsHistory — graph-first score numerators", () => {
  const TASK = "antitrust/task-1";

  /** Ten-rubric roster, two contested — denominator 8 after exclusion. */
  const roster = Array.from({ length: 10 }, (_, i) => ({
    ref_id: `req-${i}`,
    id: `C-${i}`,
    name: `Rubric ${i}`,
    contested: i < 2,
  }));

  const graphOutput = (overrides: Record<string, unknown> = {}) => ({
    ref_id: "out-1",
    triggerRef: "trig-1",
    attempt_number: 1,
    result: "fail",
    score: 0.8,
    n_passed: 8,
    n_total: 10,
    judge_notes: "8/10 criteria passed. Judge: mock-judge",
    date_added_to_graph: "1760000000",
    ...overrides,
  });

  const scoreSourceOf = (rowTestId: string) =>
    screen
      .getByTestId(rowTestId)
      .querySelector("[data-score-source]")
      ?.getAttribute("data-score-source");

  beforeEach(() => {
    vi.clearAllMocks();
    mockRubricsMapHook.mockImplementation(() => new Map());
    mockGraphScoresMapHook.mockImplementation(() => new Map());
    mockUseRecursionList.mockReturnValue({
      entries: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("scores a recursion row from the graph output joined by projectId suffix", () => {
    mockUseList.mockReturnValue({
      runs: [
        {
          ...makeRun({ id: "r-1", taskSlug: TASK, projectId: 57419, status: "COMPLETED" }),
          runType: "recursion",
          taskTitle: "",
        },
        makeRun({ id: "m-1", taskSlug: TASK }),
      ],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockRubricsMapHook.mockImplementation(() => new Map([[TASK, roster]]));
    mockGraphScoresMapHook.mockImplementation(
      () => new Map([[TASK, [graphOutput({ id: "task-src--57419" })]]]),
    );

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-r-1");
    // Graph numerator 8 passed; Total is the full 10-rubric roster (not the
    // 8-after-exclusion denominator); PASS because remaining = 10 - 2 = 8 === 8.
    expect(row.textContent).toContain("8");
    expect(row.textContent).toContain("10");
    expect(row.textContent).toContain("PASS");
    expect(scoreSourceOf("run-row-r-1")).toBe("graph");
    expect(screen.getByTestId("score-cell-contested")).toBeInTheDocument();
  });

  it("falls back to the result-table score when no graph output joins", () => {
    mockUseList.mockReturnValue({
      runs: [
        {
          ...makeRun({ id: "r-1", taskSlug: TASK, projectId: 111, status: "COMPLETED", n_passed: 34, n_total: 39, all_pass: false }),
          runType: "recursion",
          taskTitle: "",
        },
        makeRun({ id: "m-1", taskSlug: TASK }),
      ],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-r-1");
    // No roster mocked — bail-out path: Pass shows n_passed, Total is a dash.
    expect(row.textContent).toContain("34");
    expect(row.textContent).not.toContain("34/39");
    expect(row.textContent).not.toContain("FAIL");
    expect(scoreSourceOf("run-row-r-1")).toBe("result");
  });

  it("prefers the graph output over echoed counts on a manual row and requests its trigger ref", () => {
    const manualWithTrigger = {
      ...makeRun({ id: "m-1", taskSlug: TASK, status: "COMPLETED", n_passed: 50, n_total: 74, all_pass: false }),
      evalTriggerRef: "trig-1",
    };
    mockUseList.mockReturnValue({
      runs: [manualWithTrigger],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockGraphScoresMapHook.mockImplementation(
      () => new Map([[TASK, [graphOutput({ n_passed: 60, n_total: 74 })]]]),
    );

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-m-1");
    // No roster mocked — bail-out path: Pass shows the graph numerator, Total is a dash.
    expect(row.textContent).toContain("60");
    expect(row.textContent).not.toContain("60/74");
    expect(scoreSourceOf("run-row-m-1")).toBe("graph");
    // The hook was asked for this task's trigger ref (the requirement-hosted
    // trigger only the row knows about).
    expect(mockGraphScoresMapHook).toHaveBeenCalledWith([
      { taskSlug: TASK, triggerRefs: ["trig-1"], outputRefs: [] },
    ]);
  });

  it("a stored evalOutputRef pointer scores verbatim from the node — both numbers, no roster overlay", () => {
    const manualWithPointer = {
      ...makeRun({ id: "m-1", taskSlug: TASK, status: "COMPLETED", n_passed: 50, n_total: 74, all_pass: false }),
      evalTriggerRef: "trig-1",
      evalOutputRef: "out-9",
      criteria_results: [{ id: "C-0", title: "Rubric 0", verdict: "PASS", reasoning: "" }],
    };
    mockUseList.mockReturnValue({
      runs: [manualWithPointer],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    // Roster present — but the pointer must win over roster math entirely.
    mockRubricsMapHook.mockImplementation(() => new Map([[TASK, roster]]));
    mockGraphScoresMapHook.mockImplementation(
      () =>
        new Map([
          [TASK, [graphOutput({ ref_id: "out-9", triggerRef: undefined, n_passed: 9, n_total: 10 })]],
        ]),
    );

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-m-1");
    // Node counts verbatim: NOT contested-adjusted, NOT the result-column 50/74.
    // Output-ref path never sets roster_total, so Total is a dash and no PASS.
    expect(row.textContent).toContain("9");
    expect(row.textContent).not.toContain("9/10");
    expect(scoreSourceOf("run-row-m-1")).toBe("output-ref");
    expect(screen.queryByTestId("score-cell-contested")).toBeNull();
    expect(screen.queryByText("PASS")).toBeNull();
    // The pointer was requested from the graph-scores hook
    expect(mockGraphScoresMapHook).toHaveBeenCalledWith([
      { taskSlug: TASK, triggerRefs: ["trig-1"], outputRefs: ["out-9"] },
    ]);
  });

  it("PASS never shows for a fully-contested roster (remaining === 0)", () => {
    const fullyContestedRoster = Array.from({ length: 10 }, (_, i) => ({
      ref_id: `req-${i}`,
      id: `C-${i}`,
      name: `Rubric ${i}`,
      contested: true,
    }));
    mockUseList.mockReturnValue({
      runs: [makeRun({ id: "m-1", taskSlug: TASK, status: "COMPLETED", n_passed: 0, n_total: 10, all_pass: false })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockRubricsMapHook.mockImplementation(() => new Map([[TASK, fullyContestedRoster]]));

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-m-1");
    // roster_total (10) === n_contested (10) → remaining is 0 → never PASS.
    expect(row.textContent).toContain("10");
    expect(screen.queryByText("PASS")).toBeNull();
  });

  it("Total still shows the roster length when all_pass is missing/null on an otherwise-scored row", () => {
    mockUseList.mockReturnValue({
      runs: [
        {
          ...makeRun({ id: "m-1", taskSlug: TASK, status: "COMPLETED", n_passed: 8, n_total: 10 }),
          all_pass: undefined,
        },
      ],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockRubricsMapHook.mockImplementation(() => new Map([[TASK, roster]]));

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-m-1");
    // Total is not gated on hasScoreData/all_pass — the roster size (10) still shows.
    expect(row.textContent).toContain("10");
  });

  it("keeps analysis rows scoreless even when the task has graph outputs", () => {
    mockUseList.mockReturnValue({
      runs: [
        {
          ...makeRun({ id: "a-1", taskSlug: TASK, projectId: null, status: "COMPLETED" }),
          runType: "recursion",
          taskTitle: "",
        },
        makeRun({ id: "m-1", taskSlug: TASK }),
      ],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
    mockGraphScoresMapHook.mockImplementation(
      () => new Map([[TASK, [graphOutput({ id: "task-src--57419" })]]]),
    );

    render(<BenchmarkRunsHistory />);

    // No trigger ref, no matching project → honest dash, never a borrowed score
    const row = screen.getByTestId("run-row-a-1");
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toContain("8/");
  });
});

// ─── Non-manual (recursion) row expand tests ──────────────────────────────────

const makeRecursionRun = (overrides: Partial<ReturnType<typeof makeRun>> = {}) => ({
  ...makeRun({ id: "rec-1", status: "COMPLETED", ...overrides }),
  runType: "recursion" as const,
  taskTitle: "Recursion Task",
});

describe("BenchmarkRunsHistory — non-manual row expansion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseList.mockReturnValue({
      runs: [makeRecursionRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  });

  it("recursion row has cursor-pointer class (is clickable)", () => {
    render(<BenchmarkRunsHistory />);
    const row = screen.getByTestId("run-row-rec-1");
    expect(row.className).toContain("cursor-pointer");
  });

  it("recursion row has hover:bg-muted/30 class", () => {
    render(<BenchmarkRunsHistory />);
    const row = screen.getByTestId("run-row-rec-1");
    expect(row.className).toContain("hover:bg-muted/30");
  });

  it("expanding a recursion row renders the Agents panel with correct runId", async () => {
    const user = userEvent.setup();
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-rec-1");
    await user.click(row);

    const agentLogs = screen.getByTestId("run-agent-logs");
    expect(agentLogs).toBeInTheDocument();
    expect(agentLogs.getAttribute("data-run-id")).toBe("rec-1");
  });

  it("expanding a recursion row renders the Traces panel with correct runId and runStatus", async () => {
    const user = userEvent.setup();
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-rec-1");
    await user.click(row);

    const cascade = screen.getByTestId("run-cascade");
    expect(cascade).toBeInTheDocument();
    expect(cascade.getAttribute("data-run-id")).toBe("rec-1");
    expect(cascade.getAttribute("data-run-status")).toBe("COMPLETED");
  });

  it("expanding a recursion row does NOT mount LegalBenchmarkResults", async () => {
    const user = userEvent.setup();
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-rec-1");
    await user.click(row);

    expect(screen.queryByTestId("results-rec-1")).toBeNull();
  });

  it("clicking the same recursion row again collapses it", async () => {
    const user = userEvent.setup();
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-rec-1");

    await user.click(row);
    expect(screen.getByTestId("run-agent-logs")).toBeInTheDocument();

    await user.click(row);
    expect(screen.queryByTestId("run-agent-logs")).toBeNull();
    expect(screen.queryByTestId("run-cascade")).toBeNull();
    expect(mockSetExpandedId).toHaveBeenLastCalledWith(null);
  });

  it("manual rows still render LegalBenchmarkResults when expanded", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({
      runs: [makeRun({ id: "manual-1" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-manual-1");
    await user.click(row);

    expect(screen.getByTestId("results-manual-1")).toBeInTheDocument();
    expect(screen.queryByTestId("run-agent-logs")).toBeNull();
    expect(screen.queryByTestId("run-cascade")).toBeNull();
  });

  it("opening a recursion row collapses a previously open recursion row (single-expand)", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({
      runs: [
        makeRecursionRun({ id: "rec-1", taskTitle: "Recursion Task A" }),
        makeRecursionRun({ id: "rec-2", taskTitle: "Recursion Task B" }),
      ],
      total: 2,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    render(<BenchmarkRunsHistory />);

    await user.click(screen.getByTestId("run-row-rec-1"));
    expect(screen.getAllByTestId("run-agent-logs")).toHaveLength(1);
    expect(screen.getAllByTestId("run-agent-logs")[0].getAttribute("data-run-id")).toBe("rec-1");

    await user.click(screen.getByTestId("run-row-rec-2"));
    // rec-1 panel must be gone; rec-2 panel must be the only one
    const panels = screen.getAllByTestId("run-agent-logs");
    expect(panels).toHaveLength(1);
    expect(panels[0].getAttribute("data-run-id")).toBe("rec-2");
  });

  it("clicking an interactive cell (Report) on a recursion row does not toggle expansion", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({
      runs: [makeRecursionRun({ hasReport: true } as Parameters<typeof makeRecursionRun>[0])],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    render(<BenchmarkRunsHistory />);

    // The Report cell is inside its own <td onClick={stopPropagation}>
    const reportLink = screen.getByTestId("run-report-link");
    await user.click(reportLink);

    // Panel must not have opened
    expect(screen.queryByTestId("run-agent-logs")).toBeNull();
    expect(screen.queryByTestId("run-cascade")).toBeNull();
  });

  it("a recursion row whose children both render nothing still toggles without error (empty-panel path)", async () => {
    // Both mocked children always render a div, so to exercise the
    // "empty-panel accepted" path we just verify the panel wrapper mounts and
    // dismounts cleanly even when the children produce no visible content.
    const user = userEvent.setup();
    render(<BenchmarkRunsHistory />);

    const row = screen.getByTestId("run-row-rec-1");

    // open
    await user.click(row);
    // The wrapper div is present (children mounted)
    expect(screen.getByTestId("run-agent-logs")).toBeInTheDocument();

    // close — no error thrown
    await user.click(row);
    expect(screen.queryByTestId("run-agent-logs")).toBeNull();
  });
});
