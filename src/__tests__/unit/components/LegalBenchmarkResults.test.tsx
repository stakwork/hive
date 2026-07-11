/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RunStatus = "running" | "complete" | "failed";

function makeRunnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "runner-row-id",
    workspaceId: "workspace-123",
    type: "LEGAL_BENCHMARK_RUNNER",
    status: "IN_PROGRESS" as string,
    projectId: null as number | null,
    result: null as Record<string, unknown> | null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockRun(overrides: Partial<{
  status: RunStatus;
  runnerRun: ReturnType<typeof makeRunnerRow>;
  runnerOutputText: string | null;
  runnerOutputUrl: string | null;
  scoreJson: string | null;
  errorMessage: string | null;
}> = {}) {
  return {
    id: "run-abc",
    workspaceId: "workspace-123",
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    status: "running" as RunStatus,
    runnerRun: makeRunnerRow(),
    scorerRun: null as null,
    runnerOutputUrl: null as string | null,
    runnerOutputText: null as string | null,
    scoreJson: null as string | null,
    errorMessage: null as string | null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseLegalBenchmarkRun = vi.fn(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: makeMockRun() as any,
  isLoading: false,
  isStale: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useLegalBenchmarkRun", () => ({
  useLegalBenchmarkRun: (runId: string) => mockUseLegalBenchmarkRun(runId),
}));

vi.mock("@/components/ui/collapsible", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Collapsible: ({ children, open, onOpenChange }: any) => (
    <div data-testid="collapsible" data-open={String(open)} onClick={() => onOpenChange?.(!open)}>{children}</div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CollapsibleTrigger: ({ children, asChild }: any) => (
    <div data-testid="collapsible-trigger" data-aschild={String(asChild)}>{children}</div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CollapsibleContent: ({ children }: any) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Input: ({ value, onChange, placeholder, className }: any) =>
    React.createElement("input", {
      "data-testid": "filter-input",
      value,
      onChange,
      placeholder,
      className,
    }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    variant,
    size,
    className,
    "aria-label": ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
    className?: string;
    "aria-label"?: string;
  }) =>
    React.createElement(
      "button",
      { onClick, "data-variant": variant, "data-size": size, className, "aria-label": ariaLabel },
      children
    ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
    variant,
  }: {
    children?: React.ReactNode;
    className?: string;
    variant?: string;
  }) =>
    React.createElement(
      "span",
      { "data-testid": "badge", className, "data-variant": variant },
      children
    ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { LegalBenchmarkResults } = await import(
  "@/components/legal/LegalBenchmarkResults"
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LegalBenchmarkResults", () => {
  const onReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun(),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });
  });

  it("shows full-width spinner when isLoading and run is null", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: null,
      isLoading: true,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    const container = document.querySelector(".flex.items-center.justify-center");
    expect(container).toBeTruthy();
  });

  it("shows RUNNING spinner with correct message", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ status: "running" }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(
      screen.getByText("Running task… (document ingestion & analysis)")
    ).toBeInTheDocument();
  });

  it("renders null for an unknown/legacy status ('scoring' removed in single-run pipeline)", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      // Cast to never to simulate a legacy/unknown status reaching the component
      run: makeMockRun({ status: "scoring" as never }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    const { container } = render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(container.firstChild).toBeNull();
  });

  it("shows Stakwork link for super admin when projectId is non-null in RUNNING state", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ runnerRun: makeRunnerRow({ projectId: 123 }) }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset, isSuperAdmin: true }));
    const link = screen.getByRole("link", { name: /view on stakwork/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/123");
  });

  it("does not show Stakwork link for non-super admin in RUNNING state", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ runnerRun: makeRunnerRow({ projectId: 123 }) }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset, isSuperAdmin: false }));
    expect(screen.queryByRole("link", { name: /view on stakwork/i })).toBeNull();
  });

  it("does not show Stakwork link when projectId is null in RUNNING state", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ runnerRun: makeRunnerRow({ projectId: null }) }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset, isSuperAdmin: true }));
    expect(screen.queryByRole("link", { name: /view on stakwork/i })).toBeNull();
  });

  it("shows FAILED error state with errorMessage", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ status: "failed", errorMessage: "Stakwork timed out" }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(screen.getByText("Run failed")).toBeInTheDocument();
    expect(screen.getByText("Stakwork timed out")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("calls onReset when 'Try again' is clicked in FAILED state", async () => {
    const user = userEvent.setup();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ status: "failed", errorMessage: "Error" }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    await user.click(screen.getByText("Try again"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  // ─── COMPLETE state: aggregate score summary ──────────────────────────────

  it("renders COMPLETE view with Task Output section", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Draft output text here",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test", n_passed: 72, n_total: 74, all_pass: true },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText("Task Output")).toBeInTheDocument();
    expect(screen.getByText("Draft output text here")).toBeInTheDocument();
  });

  it("renders aggregate Score Summary with PASS badge when all_pass=true", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Output",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test", n_passed: 72, n_total: 74, all_pass: true },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText("Score Summary")).toBeInTheDocument();
    expect(screen.getByText(/72\/74 criteria passed/)).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("renders aggregate Score Summary with FAIL badge when all_pass=false", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Output",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test", n_passed: 10, n_total: 20, all_pass: false },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText("Score Summary")).toBeInTheDocument();
    expect(screen.getByText(/10\/20 criteria passed/)).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  });

  it("renders 'No score available' placeholder when no score fields present on complete run", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Output",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test" },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText("Score Summary")).toBeInTheDocument();
    expect(screen.getByText("No score available.")).toBeInTheDocument();
    // Must NOT render a false FAIL badge
    expect(screen.queryByText("FAIL")).toBeNull();
    expect(screen.queryByText("PASS")).toBeNull();
  });

  it("does NOT render the per-criterion rubric table (removed in single-run pipeline)", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Output",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test", n_passed: 5, n_total: 5, all_pass: true },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    // "Rubric Scores" table header should no longer exist
    expect(screen.queryByText("Rubric Scores")).toBeNull();
    expect(screen.queryByText("Criterion")).toBeNull();
  });

  it("calls onReset when 'Run again' is clicked in COMPLETE state", async () => {
    const user = userEvent.setup();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Some output",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test" },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    await user.click(screen.getByText("Run again"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("shows Copy and Download buttons in COMPLETE state", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({
        status: "complete",
        runnerOutputText: "Output text",
        runnerRun: makeRunnerRow({
          status: "COMPLETED",
          result: { taskSlug: "antitrust/task-1", taskTitle: "Test" },
        }),
      }),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Download .txt")).toBeInTheDocument();
  });

  it("shows stale warning with Refresh button when isStale is true", async () => {
    const mockRefetch = vi.fn();
    const user = userEvent.setup();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeMockRun({ status: "running" }),
      isLoading: false,
      isStale: true,
      refetch: mockRefetch,
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(screen.getByText("Taking longer than expected…")).toBeInTheDocument();
    const refreshBtn = screen.getByText("Refresh");
    await user.click(refreshBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("passes runId to useLegalBenchmarkRun hook", () => {
    render(React.createElement(LegalBenchmarkResults, { runId: "run-xyz", onReset }));
    expect(mockUseLegalBenchmarkRun).toHaveBeenCalledWith("run-xyz");
  });

  it("returns null when run is null and not loading", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    const { container } = render(
      React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset })
    );
    expect(container.firstChild).toBeNull();
  });

  // ─── Rubric Details accordion ─────────────────────────────────────────────

  const makeCriteriaResults = () => [
    { id: "crit-1", title: "Accuracy", verdict: "fail", reasoning: "Missing key point" },
    { id: "crit-2", title: "Completeness", verdict: "pass", reasoning: "All sections covered" },
    { id: "crit-3", title: "Clarity", verdict: "fail", reasoning: "Ambiguous wording" },
  ];

  function makeCompleteRunWithCriteria(criteriaResults: Array<{ id: string; title: string; verdict: string; reasoning: string }> | undefined, allPass = false) {
    return makeMockRun({
      status: "complete",
      runnerOutputText: "Output",
      runnerRun: makeRunnerRow({
        status: "COMPLETED",
        result: {
          taskSlug: "antitrust/task-1",
          taskTitle: "Test",
          n_passed: criteriaResults?.filter((c) => c.verdict === "pass").length ?? 0,
          n_total: criteriaResults?.length ?? 0,
          all_pass: allPass,
          criteria_results: criteriaResults,
        },
      }),
    });
  }

  it("renders Rubric Details section when criteria_results is present", () => {
    const criteriaResults = makeCriteriaResults();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText(/Rubric Details/)).toBeInTheDocument();
    // failedCount = 2, total = 3
    expect(screen.getByText(/2 failed \/ 3 total/)).toBeInTheDocument();
  });

  it("renders failed criteria before passing criteria in list order", () => {
    const criteriaResults = makeCriteriaResults(); // fail, pass, fail
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    // All three titles should appear
    const titleEls = [
      screen.getByText("Accuracy"),
      screen.getByText("Clarity"),
      screen.getByText("Completeness"),
    ];
    // Failed ("Accuracy", "Clarity") should appear before passed ("Completeness")
    const allText = document.body.textContent ?? "";
    const accPos = allText.indexOf("Accuracy");
    const clarPos = allText.indexOf("Clarity");
    const compPos = allText.indexOf("Completeness");
    expect(titleEls.length).toBe(3);
    expect(accPos).toBeLessThan(compPos);
    expect(clarPos).toBeLessThan(compPos);
  });

  it("is collapsed by default when all_pass is true", () => {
    const criteriaResults = [
      { id: "crit-1", title: "Accuracy", verdict: "pass", reasoning: "Great" },
    ];
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, true),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    // The outer Collapsible (first one) should have data-open="false"
    const collapsibles = screen.getAllByTestId("collapsible");
    // First collapsible is the outer Rubric Details section
    expect(collapsibles[0]).toHaveAttribute("data-open", "false");
  });

  it("is expanded by default when all_pass is false", () => {
    const criteriaResults = makeCriteriaResults();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    const collapsibles = screen.getAllByTestId("collapsible");
    // First collapsible is the outer Rubric Details section
    expect(collapsibles[0]).toHaveAttribute("data-open", "true");
  });

  it("filter input narrows the displayed criterion list", async () => {
    const user = userEvent.setup();
    const criteriaResults = makeCriteriaResults(); // Accuracy, Completeness, Clarity
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    // All three visible initially
    expect(screen.getByText("Accuracy")).toBeInTheDocument();
    expect(screen.getByText("Completeness")).toBeInTheDocument();
    expect(screen.getByText("Clarity")).toBeInTheDocument();

    // Type in filter to show only "Accuracy"
    const filterInput = screen.getByTestId("filter-input");
    await user.type(filterInput, "Accuracy");

    expect(screen.getByText("Accuracy")).toBeInTheDocument();
    expect(screen.queryByText("Completeness")).toBeNull();
    expect(screen.queryByText("Clarity")).toBeNull();
  });

  it("Rubric Details section is absent when criteria_results is undefined", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(undefined, true),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.queryByText(/Rubric Details/)).toBeNull();
    expect(screen.queryByTestId("filter-input")).toBeNull();
  });

  // ─── Rubric Details copy icon ─────────────────────────────────────────────

  it("copies TSV text to clipboard when rubric copy icon is clicked", async () => {
    // userEvent.setup() installs its own clipboard stub; spy on writeText AFTER setup()
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    const criteriaResults = makeCriteriaResults();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    const copyBtn = screen.getByRole("button", { name: "Copy rubric results" });
    await user.click(copyBtn);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const copied: string = writeSpy.mock.calls[0][0];
    expect(copied).toContain("\t");
    expect(copied).toContain("fail");
    expect(copied).toContain("crit-1");
    expect(copied).toContain("Missing key point");

    vi.restoreAllMocks();
  });

  it("sanitizes embedded newlines and tabs in reasoning so TSV has one row per criterion plus header", async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    const criteriaWithSpecialChars = [
      { id: "crit-a", title: "Title\twith\ttabs", verdict: "pass", reasoning: "Line one\nLine two\tTabbed" },
      { id: "crit-b", title: "Normal", verdict: "fail", reasoning: "Simple reasoning" },
    ];
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaWithSpecialChars, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    const copyBtn = screen.getByRole("button", { name: "Copy rubric results" });
    await user.click(copyBtn);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const copied: string = writeSpy.mock.calls[0][0];
    const lines = copied.split("\n");
    // header + 2 criteria = 3 lines total
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Verdict\tID\tTitle\tReasoning");
    // no embedded newlines or tabs remain in data rows
    expect(lines[1]).not.toContain("\n");
    expect(lines[2]).not.toContain("\n");

    vi.restoreAllMocks();
  });

  it("clicking the rubric copy icon does not toggle the Rubric Details collapsible", async () => {
    const user = userEvent.setup();
    const criteriaResults = makeCriteriaResults();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(criteriaResults, false),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    // Outer collapsible (Rubric Details) starts open (all_pass=false)
    const collapsibles = screen.getAllByTestId("collapsible");
    expect(collapsibles[0]).toHaveAttribute("data-open", "true");

    const copyBtn = screen.getByRole("button", { name: "Copy rubric results" });
    await user.click(copyBtn);

    // Still open after clicking copy — stopPropagation prevents collapsible toggle
    expect(screen.getAllByTestId("collapsible")[0]).toHaveAttribute("data-open", "true");
  });

  it("rubric copy icon is absent when criteria_results is undefined", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: makeCompleteRunWithCriteria(undefined, true),
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.queryByRole("button", { name: "Copy rubric results" })).toBeNull();
  });
});
