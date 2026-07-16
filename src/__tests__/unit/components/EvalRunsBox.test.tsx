/**
 * @vitest-environment jsdom
 *
 * Tests for EvalRunsBox optimistic-row injection, polling loop, and real-data detection.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ───────────────────────────────────────────────────────────────────

// useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "openlaw", id: "ws-1" } }),
}));

// sonner — mock before any dynamic import resolves
const mockToastSuccess = vi.fn();
const mockToastWarning = vi.fn();
const mockToastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// date-fns
vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "just now",
}));

// UI primitives
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "skeleton", className }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement("button", { onClick, disabled, ...rest }, children),
}));

// StakworkRunLink — render a simple link so we can assert the href
vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: ({
    projectId,
    isSuperAdmin,
  }: {
    projectId: number | null;
    isSuperAdmin: boolean;
  }) => {
    if (!isSuperAdmin || projectId == null) return null;
    return React.createElement(
      "a",
      { href: `https://jobs.stakwork.com/admin/projects/${projectId}` },
      "View on Stakwork",
    );
  },
}));

// ─── useEvalRunHistory mock ───────────────────────────────────────────────────

const mockRefetch = vi.fn();
const mockUseEvalRunHistory = vi.fn(() => ({
  history: [] as import("@/types/legal").EvalRunHistoryEntry[],
  isLoading: false,
  error: null,
  refetch: mockRefetch,
}));

vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: (taskSlug: string) => mockUseEvalRunHistory(taskSlug),
}));

// ─── useLegalBenchmarkEval mock ───────────────────────────────────────────────

const mockRunEval = vi.fn(async () => ({
  status: "started" as import("@/hooks/useLegalBenchmarkEval").EvalResultStatus,
  message: "Eval started.",
  projectId: 99,
}));

vi.mock("@/hooks/useLegalBenchmarkEval", () => ({
  useLegalBenchmarkEval: () => ({
    runEval: mockRunEval,
    isSubmitting: false,
  }),
}));

// ─── Component under test ─────────────────────────────────────────────────────

const { EvalRunsBox } = await import("@/components/legal/EvalRunsBox");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<import("@/types/legal").EvalRunHistoryEntry> = {},
): import("@/types/legal").EvalRunHistoryEntry {
  return {
    triggerId: "trigger-1",
    output: null,
    createdAt: "2024-01-15T10:00:00.000Z",
    projectId: null,
    ...overrides,
  };
}

function renderBox(props: Partial<React.ComponentProps<typeof EvalRunsBox>> = {}) {
  return render(
    React.createElement(EvalRunsBox, {
      taskSlug: "antitrust/task-1",
      runId: "run-abc",
      isSuperAdmin: true,
      showRunEvalButton: true,
      ...props,
    }),
  );
}

/** Click the "Run Eval" button and flush microtasks so handleRunEval resolves. */
async function clickRunEval() {
  fireEvent.click(screen.getByRole("button", { name: "Run Eval" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ─── Recursion enroll tests ───────────────────────────────────────────────────

describe("EvalRunsBox — Recursion button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseEvalRunHistory.mockReturnValue({
      history: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  it("renders Recursion button when showRecursionButton=true", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );
    expect(screen.getByRole("button", { name: "Recursion" })).toBeInTheDocument();
  });

  it("does not render Recursion button when showRecursionButton is omitted", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
      }),
    );
    expect(screen.queryByRole("button", { name: "Recursion" })).toBeNull();
  });

  it("does not render Recursion button when showRecursionButton=false", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: false,
      }),
    );
    expect(screen.queryByRole("button", { name: "Recursion" })).toBeNull();
  });

  it("clicking Recursion button POSTs to the enroll endpoint with taskSlug and runId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskSlug: "antitrust/task-1", runId: "run-abc" }),
      }),
    );
  });

  it("shows success toast on 200 OK enroll response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Enrolled in recursion loop");
    expect(mockToastWarning).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows warning toast on 409 Already Enrolled response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastWarning).toHaveBeenCalledWith("Already enrolled");
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows error toast on non-ok, non-409 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to enroll");
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it("shows error toast when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        isSuperAdmin: false,
        showRunEvalButton: false,
        showRecursionButton: true,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to enroll");
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastWarning).not.toHaveBeenCalled();
  });
});

// ─── Optimistic row tests ─────────────────────────────────────────────────────

describe("EvalRunsBox — optimistic row", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: empty history, loaded (isLoading=false so initialLoadComplete fires)
    mockUseEvalRunHistory.mockReturnValue({
      history: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    mockRunEval.mockResolvedValue({
      status: "started",
      message: "Eval started.",
      projectId: 99,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows optimistic row immediately after clicking Run Eval", async () => {
    renderBox();

    // Initial load settles (isLoading=false triggers initialLoadComplete.current = true)
    await act(async () => {
      await Promise.resolve();
    });

    await clickRunEval();

    // Optimistic row: "Evaluating…" spinner and Stakwork link for project 99
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view on stakwork/i }),
    ).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/99");
  });

  it("does NOT show skeleton rows while optimistic row is visible (even if isLoading=true)", async () => {
    // First render: loaded
    mockUseEvalRunHistory.mockReturnValue({
      history: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    const { rerender } = renderBox();
    await act(async () => {
      await Promise.resolve();
    });

    // Click Run Eval
    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    // Simulate a poll tick: isLoading becomes true but history is still empty
    act(() => {
      mockUseEvalRunHistory.mockReturnValue({
        history: [],
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });
      rerender(
        React.createElement(EvalRunsBox, {
          taskSlug: "antitrust/task-1",
          runId: "run-abc",
          isSuperAdmin: true,
          showRunEvalButton: true,
        }),
      );
    });

    // Skeleton rows must NOT appear — optimistic entry is still visible
    expect(screen.queryByTestId("skeleton")).toBeNull();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
  });

  it("removes optimistic row and stops polling when history grows", async () => {
    const { rerender } = renderBox();

    await act(async () => {
      await Promise.resolve();
    });

    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    // Simulate real data arriving: history grows
    await act(async () => {
      mockUseEvalRunHistory.mockReturnValue({
        history: [
          makeEntry({
            triggerId: "trigger-real",
            output: { result: "pass", score: 0.9 },
            projectId: 999,
            createdAt: "2024-01-15T10:00:00.000Z",
          }),
        ],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      rerender(
        React.createElement(EvalRunsBox, {
          taskSlug: "antitrust/task-1",
          runId: "run-abc",
          isSuperAdmin: true,
          showRunEvalButton: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Optimistic row should be gone; real entry visible
    expect(screen.queryByText("Evaluating…")).toBeNull();

    // clearInterval should have been called (polling stopped)
    // We verify indirectly: refetch should NOT continue firing after 10s
    mockRefetch.mockClear();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("clears optimistic row after 3-minute timeout (silent workflow failure)", async () => {
    renderBox();

    await act(async () => {
      await Promise.resolve();
    });

    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    // Advance 3 minutes — timeout should fire and state should update
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Optimistic row cleared; no-runs message should be back
    expect(screen.queryByText("Evaluating…")).toBeNull();
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("polling fires refetch every 10 seconds while optimistic row is active", async () => {
    renderBox();

    await act(async () => {
      await Promise.resolve();
    });

    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    mockRefetch.mockClear();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT set optimistic entry when initial load is still in-flight (initialLoadComplete=false)", async () => {
    // isLoading=true means initialLoadComplete.current never gets set to true
    mockUseEvalRunHistory.mockReturnValue({
      history: [],
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    });

    renderBox();
    // Do NOT settle the load — isLoading stays true

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Eval" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Skeleton rows should be present (initial load still in-flight, no optimistic entry)
    expect(screen.getAllByTestId("skeleton")).toHaveLength(3);
    expect(screen.queryByText("Evaluating…")).toBeNull();
  });
});
