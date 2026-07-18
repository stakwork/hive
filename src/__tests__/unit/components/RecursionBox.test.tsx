/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "openlaw", id: "ws-openlaw-id" }),
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: ({ series, label }: { series: unknown[]; label?: string }) =>
    React.createElement("div", { "data-testid": "hill-climb-chart", "aria-label": label }, `chart:${series.length}pts`),
}));

// Minimal Collapsible shim (opens/closes correctly for testing)
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    children: React.ReactNode;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "collapsible", "data-open": String(open) },
      children,
    ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "collapsible-trigger" }, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "collapsible-content" }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
    className,
    "aria-label": ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    className?: string;
    "aria-label"?: string;
  }) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-variant": variant, "data-size": size, className, "aria-label": ariaLabel },
      children,
    ),
}));

// ── Import the components under test AFTER mocks ─────────────────────────────

import { RecursionList } from "@/components/legal/RecursionBox";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TASK_SLUG_A = "antitrust/task-1";
const TASK_SLUG_B = "ip/task-2"; // no runner rows seeded

const entries: RecursionEntry[] = [
  { refId: "ref-a", id: TASK_SLUG_A, name: "Analyze Antitrust Strategy" },
  { refId: "ref-b", id: TASK_SLUG_B, name: "IP Review" },
];

function makeRunResult(taskSlug: string, n_passed: number, n_total: number) {
  return JSON.stringify({ taskSlug, n_passed, n_total, taskTitle: "T", all_pass: false });
}

/** Successful fetch: two runs for TASK_SLUG_A, none for TASK_SLUG_B */
function mockSuccessfulRunsFetch(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      runs: [
        {
          id: "run-1",
          workspaceId: "ws-openlaw-id",
          status: "COMPLETED",
          projectId: null,
          createdAt: "2024-01-01T00:00:00Z",
          result: makeRunResult(TASK_SLUG_A, 14, 42),
        },
        {
          id: "run-2",
          workspaceId: "ws-openlaw-id",
          status: "COMPLETED",
          projectId: null,
          createdAt: "2024-01-03T00:00:00Z",
          result: makeRunResult(TASK_SLUG_A, 38, 42),
        },
      ],
      total: 2,
    }),
  } as Response);
}

function mockFailedRunsFetch(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: "Network failure" }),
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecursionList", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Loading / error / empty states ─────────────────────────────────────────

  it("shows a loading spinner while the recursion list is loading", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={true}
        error={null}
        refetch={vi.fn()}
      />,
    );
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("shows the recursion-list error and retry button", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={false}
        error="GraphQL timeout"
        refetch={vi.fn()}
      />,
    );
    expect(screen.getByText(/GraphQL timeout/)).toBeDefined();
    expect(screen.getByText(/retry/i)).toBeDefined();
  });

  it("shows empty-state message when entries is empty", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );
    expect(screen.getByText(/no tasks enrolled/i)).toBeDefined();
  });

  // ── Runs fetch fires once regardless of card count ─────────────────────────

  it("fires the runs fetch exactly once regardless of card count (N+1 guard)", async () => {
    mockSuccessfulRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      // Cards should be rendered (task names visible)
      expect(screen.getByText("Analyze Antitrust Strategy")).toBeDefined();
    });

    // Exactly one fetch call regardless of number of entries
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/stakwork/runs");
    expect(fetchMock.mock.calls[0][0]).toContain("LEGAL_BENCHMARK_RUNNER");
    expect(fetchMock.mock.calls[0][0]).toContain("ws-openlaw-id");
  });

  // ── Loaded state: latest score shown ──────────────────────────────────────

  it("shows the latest score for a task with runs (38/42)", async () => {
    mockSuccessfulRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("38/42")).toBeDefined();
    });
  });

  it("shows 'no runs yet' for a task with zero matching runs", async () => {
    mockSuccessfulRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no runs yet/i)).toBeDefined();
    });
  });

  // ── Error state is structurally distinct from empty/no-runs ───────────────

  it("shows the runs-fetch error message distinctly (not silent scoreless cards)", async () => {
    mockFailedRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/could not load score data/i)).toBeDefined();
    });

    // "no runs yet" text should NOT appear in the error state
    expect(screen.queryByText(/no runs yet/i)).toBeNull();
  });

  it("error state shows a Retry button for the runs fetch", async () => {
    mockFailedRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/could not load score data/i)).toBeDefined();
    });

    const retryButtons = screen.getAllByText(/retry/i);
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  it("error state still renders task cards (actionable even without score data)", async () => {
    mockFailedRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/could not load score data/i)).toBeDefined();
    });

    // Task names should still be visible
    expect(screen.getByText("Analyze Antitrust Strategy")).toBeDefined();
    expect(screen.getByText("IP Review")).toBeDefined();
  });

  // ── Expandable chart ───────────────────────────────────────────────────────

  it("expands to reveal the HillClimbChart when the expand button is clicked", async () => {
    mockSuccessfulRunsFetch(fetchMock);
    const user = userEvent.setup();

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("38/42")).toBeDefined();
    });

    // Expand the chart for the first card (the one with runs)
    const expandButton = screen.getByLabelText(/expand chart/i);
    await user.click(expandButton);

    expect(screen.getByTestId("hill-climb-chart")).toBeDefined();
  });

  it("does not show the expand button for a task with no runs", async () => {
    mockSuccessfulRunsFetch(fetchMock);

    render(
      <RecursionList
        entries={[{ refId: "ref-b", id: TASK_SLUG_B, name: "IP Review" }]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no runs yet/i)).toBeDefined();
    });

    // No expand button since there are no runs
    expect(screen.queryByLabelText(/expand chart/i)).toBeNull();
  });
});
