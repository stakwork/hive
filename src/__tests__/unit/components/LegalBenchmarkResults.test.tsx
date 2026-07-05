/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRun = {
  id: "run-abc",
  workspaceId: "workspace-123",
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  status: "RUNNING" as const,
  runnerProjectId: null,
  scorerProjectId: null,
  runnerOutputUrl: null,
  runnerOutputText: null,
  scoreJson: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockUseLegalBenchmarkRun = vi.fn(() => ({
  run: mockRun,
  isLoading: false,
  isStale: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useLegalBenchmarkRun", () => ({
  useLegalBenchmarkRun: (...args: unknown[]) => mockUseLegalBenchmarkRun(...args),
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
      run: mockRun,
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
    // Should render the loading spinner container
    const container = document.querySelector(".flex.items-center.justify-center");
    expect(container).toBeTruthy();
  });

  it("shows PENDING/RUNNING spinner with correct message", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: { ...mockRun, status: "RUNNING" },
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(
      screen.getByText("Running task… (document ingestion & analysis)")
    ).toBeInTheDocument();
  });

  it("shows PENDING spinner with correct message", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: { ...mockRun, status: "PENDING" },
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(
      screen.getByText("Running task… (document ingestion & analysis)")
    ).toBeInTheDocument();
  });

  it("shows SCORING spinner with correct message", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: { ...mockRun, status: "SCORING" },
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    expect(
      screen.getByText("Scoring output against rubric…")
    ).toBeInTheDocument();
  });

  it("shows FAILED error state with errorMessage", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: { ...mockRun, status: "FAILED", errorMessage: "Stakwork timed out" },
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
      run: { ...mockRun, status: "FAILED", errorMessage: "Error" },
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));
    await user.click(screen.getByText("Try again"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders COMPLETE view with output text and rubric table", () => {
    const scores = [
      { criterion: "Accuracy", pass: true, notes: "Meets standard" },
      { criterion: "Completeness", pass: false, notes: "Missing section" },
    ];

    mockUseLegalBenchmarkRun.mockReturnValue({
      run: {
        ...mockRun,
        status: "COMPLETE",
        runnerOutputText: "Draft output text here",
        scoreJson: JSON.stringify(scores),
      },
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });

    render(React.createElement(LegalBenchmarkResults, { runId: "run-abc", onReset }));

    expect(screen.getByText("Task Output")).toBeInTheDocument();
    expect(screen.getByText("Draft output text here")).toBeInTheDocument();
    expect(screen.getByText("Rubric Scores")).toBeInTheDocument();
    expect(screen.getByText("Accuracy")).toBeInTheDocument();
    expect(screen.getByText("Completeness")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
    expect(screen.getByText("Meets standard")).toBeInTheDocument();
    expect(screen.getByText("Missing section")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/criteria passed/)).toBeInTheDocument();
  });

  it("calls onReset when 'Run again' is clicked in COMPLETE state", async () => {
    const user = userEvent.setup();
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: {
        ...mockRun,
        status: "COMPLETE",
        runnerOutputText: "Some output",
        scoreJson: JSON.stringify([]),
      },
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
      run: {
        ...mockRun,
        status: "COMPLETE",
        runnerOutputText: "Output text",
        scoreJson: JSON.stringify([]),
      },
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
      run: { ...mockRun, status: "RUNNING" },
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
