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

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    variant,
    size,
    className,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
    className?: string;
  }) =>
    React.createElement(
      "button",
      { onClick, "data-variant": variant, "data-size": size, className },
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
});
