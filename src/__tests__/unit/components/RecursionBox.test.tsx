/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// Collapsible — render content only when the parent Collapsible is open
const CollapsibleOpenCtx = React.createContext(false);
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (v: boolean) => void;
    children: React.ReactNode;
  }) =>
    React.createElement(
      CollapsibleOpenCtx.Provider,
      { value: open },
      React.createElement("div", { "data-open": open }, children),
    ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => {
    const open = React.useContext(CollapsibleOpenCtx);
    if (!open) return null;
    return React.createElement("div", { "data-testid": "collapsible-content" }, children);
  },
}));

// HillClimbChart — simple placeholder so we can assert it's rendered
vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: ({ attempts }: { attempts: unknown[] }) =>
    React.createElement(
      "div",
      { "data-testid": "hill-climb-chart", "data-count": attempts.length },
      `chart:${attempts.length}pts`,
    ),
}));

// useEvalRunHistory mock
const mockUseEvalRunHistory = vi.fn();

vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: (taskSlug: string) => mockUseEvalRunHistory(taskSlug),
}));

// useWorkspace mock (needed by useEvalRunHistory through the component chain)
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "openlaw", id: "ws-1" } }),
}));

global.fetch = vi.fn();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
  return {
    refId: "ref-abc",
    id: "antitrust/task-1",
    name: "Antitrust Task 1",
    ...overrides,
  };
}

function makeOutput(n_passed: number, n_total: number, idx = 0) {
  return {
    ref_id: `out-${idx}`,
    attempt_number: idx,
    result: "pass",
    score: n_passed / n_total,
    n_passed,
    n_total,
    date_added_to_graph: String(1720000000 + idx * 86400),
  };
}

function mockHistoryLoaded(attempts: ReturnType<typeof makeOutput>[] = []) {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attempts,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function mockHistoryLoading() {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attempts: [],
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  });
}

function mockHistoryError(msg = "Fetch error") {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attempts: [],
    isLoading: false,
    error: msg,
    refetch: vi.fn(),
  });
}

function mockFetchOk() {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, enabled: false }),
  } as Response);
}

function mockFetchFail(status = 500, error = "Graph error") {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error }),
  } as Response);
}

// ─── Component under test ──────────────────────────────────────────────────────

import { RecursionList } from "@/components/legal/RecursionBox";

// ─── RecursionCard (via RecursionList) ────────────────────────────────────────

describe("RecursionCard", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockHistoryLoaded(); // default: loaded, no attempts
  });

  function renderCard(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
    const entry = makeEntry(overrides);
    render(
      <RecursionList
        entries={[entry]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
      />,
    );
  }

  it("renders task name and id", () => {
    renderCard();
    expect(screen.getByText("Antitrust Task 1")).toBeTruthy();
    expect(screen.getByText("antitrust/task-1")).toBeTruthy();
  });

  it("shows Disable button", () => {
    renderCard();
    expect(screen.getByRole("button", { name: /disable/i })).toBeTruthy();
  });

  it("calls PATCH with correct refId and enabled=false on Disable click", async () => {
    mockFetchOk();
    renderCard({ refId: "ref-xyz" });

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion/ref-xyz",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it("calls refetch after successful toggle", async () => {
    mockFetchOk();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledOnce());
  });

  it("does NOT call refetch on failed toggle", async () => {
    mockFetchFail();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("shows inline error message on toggle failure", async () => {
    mockFetchFail(502, "Graph write failed");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => screen.getByText("Graph write failed"));
  });

  it("shows inline error on network error", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network down"));
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => screen.getByText("Network down"));
  });

  it("does not make any DELETE calls", async () => {
    mockFetchOk();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    const call = vi.mocked(global.fetch).mock.calls[0];
    const options = call[1] as RequestInit | undefined;
    expect(options?.method).not.toBe("DELETE");
  });

  // ─── Score display ──────────────────────────────────────────────────────────

  it('shows "no runs yet" when attempts array is empty', () => {
    mockHistoryLoaded([]); // empty series
    renderCard();
    expect(screen.getByTestId("score-no-runs")).toBeTruthy();
    expect(screen.getByTestId("score-no-runs").textContent).toMatch(/no runs yet/i);
  });

  it("shows latest n_passed/n_total when attempts present", () => {
    mockHistoryLoaded([
      makeOutput(28, 42, 0),
      makeOutput(34, 42, 1),
      makeOutput(38, 42, 2), // latest
    ]);
    renderCard();
    const score = screen.getByTestId("score-display");
    expect(score.textContent).toBe("38/42");
  });

  it("shows loading indicator while history is loading", () => {
    mockHistoryLoading();
    renderCard();
    expect(screen.getByTestId("score-loading")).toBeTruthy();
  });

  it("shows error state when history fetch fails", () => {
    mockHistoryError("Fetch error");
    renderCard();
    expect(screen.getByTestId("score-error")).toBeTruthy();
    expect(screen.getByTestId("score-error").textContent).toMatch(/failed to load/i);
  });

  it("error state is visually distinct from 'no runs yet'", () => {
    // Error: score-error testid
    mockHistoryError("boom");
    const { unmount } = render(
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByTestId("score-error")).toBeTruthy();
    expect(screen.queryByTestId("score-no-runs")).toBeNull();
    unmount();

    // No runs: score-no-runs testid
    mockHistoryLoaded([]);
    render(
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByTestId("score-no-runs")).toBeTruthy();
    expect(screen.queryByTestId("score-error")).toBeNull();
  });

  // ─── Expand / chart ─────────────────────────────────────────────────────────

  it("does NOT render expand toggle when attempts is empty", () => {
    mockHistoryLoaded([]);
    renderCard();
    expect(screen.queryByTestId("expand-toggle")).toBeNull();
  });

  it("renders expand toggle when attempts are present", () => {
    mockHistoryLoaded([makeOutput(28, 42, 0)]);
    renderCard();
    expect(screen.getByTestId("expand-toggle")).toBeTruthy();
  });

  it("expands to reveal HillClimbChart on toggle click", async () => {
    mockHistoryLoaded([
      makeOutput(28, 42, 0),
      makeOutput(34, 42, 1),
    ]);
    renderCard();

    // Chart not visible initially
    expect(screen.queryByTestId("hill-climb-chart")).toBeNull();

    fireEvent.click(screen.getByTestId("expand-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("hill-climb-chart")).toBeTruthy();
    });
  });

  it("passes all attempts to HillClimbChart", async () => {
    const attempts = [makeOutput(28, 42, 0), makeOutput(38, 42, 1)];
    mockHistoryLoaded(attempts);
    renderCard();

    fireEvent.click(screen.getByTestId("expand-toggle"));

    await waitFor(() => {
      const chart = screen.getByTestId("hill-climb-chart");
      expect(chart.getAttribute("data-count")).toBe("2");
    });
  });
});

// ─── RecursionList ────────────────────────────────────────────────────────────

describe("RecursionList", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockHistoryLoaded();
  });

  it("shows loading spinner when isLoading=true", () => {
    render(
      <RecursionList entries={[]} isLoading={true} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error message and Retry button when error is set", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="Fetch failed" refetch={mockRefetch} />,
    );
    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("Retry button calls refetch", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="err" refetch={mockRefetch} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it("shows empty-state copy when entries is empty and not loading", () => {
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(container.textContent).toMatch(/No tasks enrolled in recursion/i);
    expect(container.textContent).toMatch(/toggles the recursion flag/i);
  });

  it("empty-state mentions completing a benchmark run with failing criteria", () => {
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Recursion/i);
    expect(text).toMatch(/failing criteria/i);
  });

  it("renders a card per entry", () => {
    const entries = [
      makeEntry({ refId: "r1", id: "slug-1", name: "Task One" }),
      makeEntry({ refId: "r2", id: "slug-2", name: "Task Two" }),
    ];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByText("Task One")).toBeTruthy();
    expect(screen.getByText("Task Two")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /disable/i })).toHaveLength(2);
  });

  it("calls useEvalRunHistory once per card (no N+1)", () => {
    const entries = [
      makeEntry({ refId: "r1", id: "slug-1", name: "Task One" }),
      makeEntry({ refId: "r2", id: "slug-2", name: "Task Two" }),
      makeEntry({ refId: "r3", id: "slug-3", name: "Task Three" }),
    ];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    // Called once per card
    expect(mockUseEvalRunHistory).toHaveBeenCalledTimes(3);
    // Each with its own slug
    expect(mockUseEvalRunHistory).toHaveBeenCalledWith("slug-1");
    expect(mockUseEvalRunHistory).toHaveBeenCalledWith("slug-2");
    expect(mockUseEvalRunHistory).toHaveBeenCalledWith("slug-3");
  });

  it("does not render StatusBadge or status-related UI", () => {
    const entries = [makeEntry()];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Inactive")).toBeNull();
  });
});
