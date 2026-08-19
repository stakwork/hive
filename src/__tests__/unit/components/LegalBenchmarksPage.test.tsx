/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Legal Benchmarks page:
 * - Exactly one /api/stakwork/runs request fires on load (shared hook instance)
 * - Header summary strip and tab switching render off the shared run list
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
  runType: "manual",
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

describe("LegalBenchmarksPage", () => {
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

  it("does not fetch runs at page level — the Runs tab owns the list now", () => {
    render(React.createElement(LegalBenchmarksPage));
    // Radix defers the inactive Runs tab, so nothing requests the run list
    // until the user opens it.
    expect(
      mockRunListHook.mock.calls.filter(([id]) => id === WORKSPACE_ID),
    ).toHaveLength(0);
  });

  it("keeps the header free of the summary strip", () => {
    render(React.createElement(LegalBenchmarksPage));
    expect(screen.getByTestId("page-header")).toBeInTheDocument();
    expect(screen.queryByTestId("benchmark-strip")).toBeNull();
    expect(screen.getByTestId("benchmarks-panel")).toBeInTheDocument();
  });

  it("shows the summary strip inside the Runs tab, with no P/F pips", async () => {
    // Use real timers — fake timers + userEvent.click + Radix UI Tabs deadlock
    // because Radix's Presence animation callbacks call setTimeout/rAF
    // which userEvent's advanceTimers intercepts, causing an infinite loop.
    const user = userEvent.setup();
    const { container } = render(React.createElement(LegalBenchmarksPage));

    await user.click(screen.getByText("Runs"));

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-strip")).toBeInTheDocument();
    });
    expect(screen.getByText("Antitrust Strategy")).toBeInTheDocument();
    expect(container.querySelector('[data-testid^="pip-"]')).toBeNull();
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
