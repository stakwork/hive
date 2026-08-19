/**
 * @vitest-environment jsdom
 *
 * Tests for the new runList prop and focusRequest behaviors added in T2.
 * The existing zero-prop tests live in BenchmarkRunsHistory.test.tsx and
 * must continue passing unmodified.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Stub scrollIntoView (jsdom does not implement it) ────────────────────────
// Pattern from DashboardChat.test.tsx / GlobalSearch.test.tsx
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-cuid-abc";
const WORKSPACE_SLUG = "openlaw";

const makeRun = (
  overrides: Partial<{
    id: string;
    status: string;
    projectId: number | null;
    taskSlug: string;
    taskTitle: string;
    createdAt: string;
    updatedAt: string;
    n_passed: number;
    n_total: number;
    all_pass: boolean;
  }> = {},
) => ({
  id: "runner-1",
  workspaceId: WORKSPACE_ID,
  runType: "manual",
  status: "COMPLETED",
  projectId: null,
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  updatedAt: new Date("2025-06-01T09:05:00Z").toISOString(),
  n_passed: undefined as number | undefined,
  n_total: undefined as number | undefined,
  all_pass: undefined as boolean | undefined,
  ...overrides,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockSetExpandedId = vi.fn();
const mockRefetch = vi.fn();

/** Default hook return used internally when no runList prop is supplied */
const mockInternalList = vi.fn((_workspaceId: string | undefined) => ({
  runs: [makeRun()],
  total: 1,
  isLoading: false,
  error: null,
  refetch: mockRefetch,
  setExpandedId: mockSetExpandedId,
}));

vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: (workspaceId: string | undefined) =>
    mockInternalList(workspaceId),
}));

vi.mock("@/hooks/useLegalBenchmarkRecursionList", () => ({
  useLegalBenchmarkRecursionList: () => ({
    entries: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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
      React.createElement(
        "button",
        { onClick: onReset, "data-testid": "reset-btn" },
        "Reset",
      ),
    ),
}));

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: ({
    projectId,
  }: {
    projectId: number | null;
    isSuperAdmin: boolean;
  }) =>
    React.createElement(
      "a",
      {
        href: `https://jobs.stakwork.com/admin/projects/${projectId}`,
        "data-testid": "stakwork-link",
      },
      "View on Stakwork",
    ),
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: () =>
    React.createElement("div", { "data-testid": "hill-climb-chart" }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "about 1 month ago",
}));

// The summary strip owns a second Select; stub it so the shared select mock
// below stays bound to the task filter.
vi.mock("@/components/legal/BenchmarkSummaryStrip", () => ({
  BenchmarkSummaryStrip: ({ windowSize }: { windowSize: number }) =>
    React.createElement("div", {
      "data-testid": "summary-strip",
      "data-window": String(windowSize),
    }),
}));

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
    return React.createElement(
      "div",
      { "data-testid": "task-filter", "data-value": value },
      children,
    );
  },
  SelectTrigger: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("div", props, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": `task-filter-option-${value}`,
        onClick: () => selectOnValueChange?.(value),
      },
      children,
    ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { BenchmarkRunsHistory } = await import(
  "@/components/legal/BenchmarkRunsHistory"
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BenchmarkRunsHistory — runList prop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInternalList.mockReturnValue({
      runs: [makeRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  });

  it("existing zero-prop call still works and uses workspace.id", () => {
    render(React.createElement(BenchmarkRunsHistory));
    // The hook must be called with the workspace id (not slug, not undefined)
    expect(mockInternalList).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(screen.getByText("Analyze Antitrust Strategy")).toBeInTheDocument();
  });

  it("when runList prop is supplied, internal hook is called with undefined (no fetch)", () => {
    const externalList = {
      runs: [makeRun({ id: "ext-run-1", taskTitle: "External Run Task" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setExpandedId: vi.fn(),
    };

    render(
      React.createElement(BenchmarkRunsHistory, { runList: externalList }),
    );

    // Hook must have been called with undefined (no internal fetch)
    expect(mockInternalList).toHaveBeenCalledWith(undefined);
    // Data from the prop is rendered
    expect(screen.getByText("External Run Task")).toBeInTheDocument();
  });

  it("when runList prop is supplied, renders its runs (not the internal hook's runs)", () => {
    // Internal hook returns "Analyze Antitrust Strategy"
    // Prop provides "External Task" — prop wins
    const externalList = {
      runs: [makeRun({ id: "ext-1", taskTitle: "Prop Task Title" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setExpandedId: vi.fn(),
    };

    render(
      React.createElement(BenchmarkRunsHistory, { runList: externalList }),
    );

    expect(screen.getByText("Prop Task Title")).toBeInTheDocument();
    expect(screen.queryByText("Analyze Antitrust Strategy")).toBeNull();
  });
});

describe("BenchmarkRunsHistory — focusRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset scrollIntoView mock
    (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    mockInternalList.mockReturnValue({
      runs: [makeRun({ id: "run-target", taskTitle: "Target Run" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a focusRequest resets the task filter to ALL_TASKS", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    // First select a task filter so we can verify it gets reset
    await act(async () => {
      selectOnValueChange?.("antitrust/task-1");
    });

    const filterEl = screen.getByTestId("task-filter");
    expect(filterEl.getAttribute("data-value")).toBe("antitrust/task-1");

    // Now trigger a focus request
    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
    });

    // Filter should reset to "all"
    expect(screen.getByTestId("task-filter").getAttribute("data-value")).toBe(
      "all",
    );
  });

  it("a focusRequest expands the correct row", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
    });

    // Row should now be expanded
    expect(screen.getByTestId("results-run-target")).toBeInTheDocument();
    // setExpandedId should have been called
    expect(mockSetExpandedId).toHaveBeenCalledWith("run-target");
  });

  it("a focusRequest calls onFocusHandled", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
    });

    expect(onFocusHandled).toHaveBeenCalledTimes(1);
  });

  it("focusing the same run twice with a new nonce re-fires the effect", async () => {
    const onFocusHandled = vi.fn();
    mockInternalList.mockReturnValue({
      runs: [makeRun({ id: "run-target" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
    });
    expect(onFocusHandled).toHaveBeenCalledTimes(1);

    // Simulate parent clearing token, then pip clicked again
    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: null,
          onFocusHandled,
        }),
      );
    });

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 2 },
          onFocusHandled,
        }),
      );
    });

    expect(onFocusHandled).toHaveBeenCalledTimes(2);
    expect(mockSetExpandedId).toHaveBeenCalledTimes(2);
  });

  it("an unknown run id no-ops and still calls onFocusHandled", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-does-not-exist", nonce: 1 },
          onFocusHandled,
        }),
      );
    });

    // Not expanded (run not found)
    expect(screen.queryByTestId("results-run-does-not-exist")).toBeNull();
    // setExpandedId should NOT have been called for an unknown run
    expect(mockSetExpandedId).not.toHaveBeenCalled();
    // Token must still clear
    expect(onFocusHandled).toHaveBeenCalledTimes(1);
  });

  it("applies a highlight ring on the row and removes it after ~1.5s", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
      // Flush rAF + microtasks so the class is applied
      await Promise.resolve();
    });

    const row = screen.getByTestId("run-row-run-target");

    // Advance timers to trigger the setTimeout inside rAF
    // rAF fires synchronously in jsdom when wrapped in act
    await act(async () => {
      vi.runAllTimers();
    });

    // After 1.5s timer fires, ring classes should be removed
    expect(row.classList.contains("ring-2")).toBe(false);
    expect(row.classList.contains("ring-primary")).toBe(false);
  });

  it("focusRequest does not call handleReset (no spurious setExpandedId(null))", async () => {
    const onFocusHandled = vi.fn();

    const { rerender } = render(
      React.createElement(BenchmarkRunsHistory, {
        focusRequest: null,
        onFocusHandled,
      }),
    );

    await act(async () => {
      rerender(
        React.createElement(BenchmarkRunsHistory, {
          focusRequest: { runId: "run-target", nonce: 1 },
          onFocusHandled,
        }),
      );
    });

    // Must never have been called with null (handleReset path)
    const nullCalls = mockSetExpandedId.mock.calls.filter(
      (args) => args[0] === null,
    );
    expect(nullCalls).toHaveLength(0);
  });
});

describe("BenchmarkRunsHistory — pip-click integration shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockInternalList.mockReturnValue({
      runs: [makeRun({ id: "r1", taskTitle: "Task Alpha" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      setExpandedId: mockSetExpandedId,
    });
  });

  it("supplying runList from page level renders prop data and calls internal hook with undefined", () => {
    const propList = {
      runs: [makeRun({ id: "page-run", taskTitle: "Page-Level Run" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setExpandedId: vi.fn(),
    };

    render(
      React.createElement(BenchmarkRunsHistory, { runList: propList }),
    );

    expect(screen.getByText("Page-Level Run")).toBeInTheDocument();
    // No additional real fetch — internal hook received undefined
    expect(mockInternalList).toHaveBeenCalledWith(undefined);
  });

  it("clicking a row row still works correctly when runList prop is supplied", async () => {
    const extSetExpandedId = vi.fn();
    const propList = {
      runs: [makeRun({ id: "ext-r1", taskTitle: "External Task" })],
      total: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setExpandedId: extSetExpandedId,
    };

    const user = userEvent.setup();
    render(
      React.createElement(BenchmarkRunsHistory, { runList: propList }),
    );

    const row = screen.getByText("External Task").closest("tr")!;
    await user.click(row);

    expect(screen.getByTestId("results-ext-r1")).toBeInTheDocument();
    expect(extSetExpandedId).toHaveBeenCalledWith("ext-r1");
  });
});
