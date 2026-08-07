/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Legal Benchmarks page:
 * - Exactly one /api/stakwork/runs request fires on load (shared hook instance)
 * - Clicking a pip switches to the Runs tab and expands the corresponding row
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-page-test";
const WORKSPACE_SLUG = "openlaw";

const makeRun = (overrides: Record<string, unknown> = {}) => ({
  id: "run-page-1",
  workspaceId: WORKSPACE_ID,
  status: "COMPLETED",
  projectId: null,
  taskSlug: "antitrust/task-1",
  taskTitle: "Antitrust Strategy",
  createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  updatedAt: new Date("2025-06-01T09:05:00Z").toISOString(),
  n_passed: 8,
  n_total: 10,
  all_pass: true,
  ...overrides,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Track fetch calls
const fetchMock = vi.fn();
global.fetch = fetchMock;

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({
    workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG },
    isSuperAdmin: false,
  })),
}));

// useLegalBenchmarkRunList — spy on calls, return controlled data
const mockRunListHook = vi.fn((_workspaceId: string | undefined) => ({
  runs: [makeRun()],
  total: 1,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  setExpandedId: vi.fn(),
}));

vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: (workspaceId: string | undefined) =>
    mockRunListHook(workspaceId),
}));

vi.mock("@/hooks/useLegalBenchmarkRecursionList", () => ({
  useLegalBenchmarkRecursionList: () => ({
    entries: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: () => null,
}));

// Heavy legal components — stub to keep test focused
vi.mock("@/components/legal/LegalBenchmarksPanel", () => ({
  LegalBenchmarksPanel: () =>
    React.createElement("div", { "data-testid": "benchmarks-panel" }, "Panel"),
}));

vi.mock("@/components/legal/LegalBenchmarkResults", () => ({
  LegalBenchmarkResults: ({ runId, onReset }: { runId: string; onReset: () => void }) =>
    React.createElement(
      "div",
      { "data-testid": `results-${runId}` },
      React.createElement("button", { onClick: onReset, "data-testid": "reset-btn" }, "Reset"),
    ),
}));

vi.mock("@/components/legal/RecursionBox", () => ({
  RecursionList: () =>
    React.createElement("div", { "data-testid": "recursion-list" }, "Recursion"),
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: () =>
    React.createElement("div", { "data-testid": "hill-climb-chart" }),
}));

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: () => null,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 months ago",
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

const LegalBenchmarksPage = (await import(
  "@/app/w/[slug]/legal/benchmarks/page"
)).default;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LegalBenchmarksPage — shared run-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunListHook.mockReturnValue({
      runs: [makeRun()],
      total: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setExpandedId: vi.fn(),
    });
  });

  it("calls useLegalBenchmarkRunList exactly once at page level with the workspace id", () => {
    render(React.createElement(LegalBenchmarksPage));
    // The page-level shared instance fires with the real workspace id
    const calls = mockRunListHook.mock.calls;
    const realCalls = calls.filter(([id]) => id === WORKSPACE_ID);
    expect(realCalls).toHaveLength(1);
    // BenchmarkRunsHistory (rendered inside an inactive Radix TabsContent) is
    // deferred by Radix Presence and does not mount until the tab first becomes
    // active — so we only assert the page-level call here rather than counting
    // a noop call that depends on Radix internals.
    // The unit tests in BenchmarkRunsHistory-focus.test.tsx independently verify
    // that when runList prop is supplied the internal hook is called with undefined.
  });

  it("renders both the summary strip and the runs tab", () => {
    render(React.createElement(LegalBenchmarksPage));
    // Summary strip is visible in the header
    expect(screen.getByTestId("benchmark-strip")).toBeInTheDocument();
    // Benchmark tab (default) is shown
    expect(screen.getByTestId("benchmarks-panel")).toBeInTheDocument();
  });

  it("pip click switches to the Runs tab", async () => {
    // Use real timers — fake timers + userEvent.click + Radix UI Tabs deadlock
    // because Radix's Presence animation callbacks call setTimeout/rAF
    // which userEvent's advanceTimers intercepts, causing an infinite loop.
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPage));

    // Strip is visible
    const pip = screen.getByTestId("pip-run-page-1");
    await user.click(pip);

    // Runs tab content should now be rendered
    await waitFor(() => {
      expect(screen.getByText("Antitrust Strategy")).toBeInTheDocument();
    });
  });

  it("pip click expands the corresponding row in BenchmarkRunsHistory", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPage));

    const pip = screen.getByTestId("pip-run-page-1");
    await user.click(pip);

    // After switching tabs and focus effect fires, the row should be expanded
    await waitFor(() => {
      expect(screen.getByTestId("results-run-page-1")).toBeInTheDocument();
    });
  });

  it("clicking a pip twice with different nonces re-fires focus", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPage));

    const pip = screen.getByTestId("pip-run-page-1");

    // First click — expand row
    await user.click(pip);
    await waitFor(() => {
      expect(screen.getByTestId("results-run-page-1")).toBeInTheDocument();
    });

    // Collapse via reset button
    await act(async () => {
      const resetBtn = screen.getByTestId("reset-btn");
      await user.click(resetBtn);
    });
    expect(screen.queryByTestId("results-run-page-1")).toBeNull();

    // Second click — expand again
    await user.click(pip);
    await waitFor(() => {
      expect(screen.getByTestId("results-run-page-1")).toBeInTheDocument();
    });
  });

  it("renders the Recursion tab when its trigger is clicked", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPage));

    await user.click(screen.getByText("Recursion"));
    await waitFor(() => {
      expect(screen.getByTestId("recursion-list")).toBeInTheDocument();
    });
  });
});
