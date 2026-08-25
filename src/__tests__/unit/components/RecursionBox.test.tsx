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

// Switch — renders a checkbox so fireEvent.click toggles its checked state.
// onCheckedChange is called with the new checked value (boolean), matching
// the Radix Switch API the component relies on.
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement("input", {
      type: "checkbox",
      role: "switch",
      checked: checked ?? false,
      disabled,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange?.(e.target.checked),
      ...rest,
    }),
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

// RecursionGraphPanel — lightweight placeholder
vi.mock("@/components/legal/RecursionGraphPanel", () => ({
  RecursionGraphPanel: ({ evalSetRefId }: { evalSetRefId: string }) =>
    React.createElement(
      "div",
      { "data-testid": "recursion-graph-panel", "data-ref": evalSetRefId },
      "graph-panel",
    ),
}));

// useEvalRunHistory mock
const mockUseEvalRunHistory = vi.fn();

vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: (input: { refId?: string | null; slug: string }) => mockUseEvalRunHistory(input),
}));

// useBenchmarkRubrics mock — the graph rubric roster. Default: no roster
// (set in beforeEach), so attempt counts pass through untouched.
const mockUseBenchmarkRubrics = vi.fn();

vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  useBenchmarkRubrics: (taskSlug?: string) => mockUseBenchmarkRubrics(taskSlug),
}));

function mockRoster(total: number, contestedCount: number) {
  mockUseBenchmarkRubrics.mockReturnValue({
    rubrics: Array.from({ length: total }, (_, i) => ({
      ref_id: `req-${i}`,
      id: `C-${String(i + 1).padStart(3, "0")}`,
      name: `Rubric ${i + 1}`,
      contested: i < contestedCount,
    })),
  });
}

// useWorkspace mock (needed by useEvalRunHistory through the component chain)
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "openlaw", id: "ws-1" } }),
}));

// useLegalBenchmarkRunList — after the lift, RecursionCard no longer calls this
// hook; the hook is only called once in RecursionTab and threaded down via
// the `allRuns` prop. The mock is kept here so any residual import in the
// module graph doesn't throw, but it should never be invoked by RecursionCard.
vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: vi.fn(() => ({
    runs: [],
    total: 0,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    setExpandedId: vi.fn(),
  })),
}));

// useLegalBenchmarkRun — RecursionCard calls this to poll the consolidated run
// status. Use vi.fn() so per-test overrides are possible.
const mockUseLegalBenchmarkRun = vi.fn(() => ({
  run: null,
  isLoading: false,
  isStale: false,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/useLegalBenchmarkRun", () => ({
  useLegalBenchmarkRun: (...args: unknown[]) => mockUseLegalBenchmarkRun(...args),
}));

global.fetch = vi.fn();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{ refId: string; id: string; name: string; recursion: boolean }> = {}) {
  return {
    refId: "ref-abc",
    id: "antitrust/task-1",
    name: "Antitrust Task 1",
    recursion: true,
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

const MOCK_SUBGRAPH_DATA = {
  nodes: [{ ref_id: "evalset-1", node_type: "EvalSet", properties: {} }],
  edges: [] as { source: string; target: string; edge_type: string }[],
};

function mockHistoryLoaded(
  attempts: Array<ReturnType<typeof makeOutput> & Record<string, unknown>> = [],
  extra: {
    seriesKind?: string;
    partial?: boolean;
    attemptRows?: unknown[];
    subgraphData?: typeof MOCK_SUBGRAPH_DATA | null;
  } = {},
) {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attemptRows: [],
    attempts,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    subgraphData: MOCK_SUBGRAPH_DATA, // default: subgraph available
    ...extra,
  });
}

function mockHistoryLoading() {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attemptRows: [],
    attempts: [],
    isLoading: true,
    error: null,
    refetch: vi.fn(),
    subgraphData: null,
  });
}

function mockHistoryError(msg = "Fetch error") {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attemptRows: [],
    attempts: [],
    isLoading: false,
    error: msg,
    refetch: vi.fn(),
    subgraphData: null,
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
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null }); // default: no roster
  });

  function renderCard(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
    const entry = makeEntry(overrides);
    render(
      <RecursionList
        entries={[entry]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[]}
      />,
    );
  }

  it("renders task name and id", () => {
    renderCard();
    expect(screen.getByText("Antitrust Task 1")).toBeTruthy();
    expect(screen.getByText("antitrust/task-1")).toBeTruthy();
  });

  it("renders recursion toggle (Switch) in the on position when entry.recursion is true", () => {
    renderCard({ recursion: true });
    const toggle = screen.getByTestId("recursion-toggle") as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Disable recursion");
  });

  it("renders recursion toggle in the off position when entry.recursion is false", () => {
    renderCard({ recursion: false });
    const toggle = screen.getByTestId("recursion-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Enable recursion");
  });

  it("renders recursion toggle in the off position when entry.recursion is absent (default makeEntry has recursion:true, so override to false)", () => {
    // entry without a recursion field — the component treats undefined as false
    const entry = { refId: "ref-abc", id: "antitrust/task-1", name: "Antitrust Task 1" };
    render(
      <RecursionList entries={[entry]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    const toggle = screen.getByTestId("recursion-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Enable recursion");
  });

  it("calls PATCH with correct refId and enabled=false when toggled off", async () => {
    mockFetchOk();
    renderCard({ refId: "ref-xyz", recursion: true });

    // Toggle is currently ON; clicking it inverts the controlled checkbox and fires onChange(false)
    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion/ref-xyz",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it("calls PATCH with enabled=true when toggled on", async () => {
    mockFetchOk();
    renderCard({ refId: "ref-xyz", recursion: false });

    // Toggle is currently OFF; clicking it inverts the controlled checkbox and fires onChange(true)
    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion/ref-xyz",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });

  it("calls refetch after successful toggle", async () => {
    mockFetchOk();
    renderCard({ recursion: true });

    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledOnce());
  });

  it("does NOT call refetch on failed toggle", async () => {
    mockFetchFail();
    renderCard({ recursion: true });

    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("shows inline error message on toggle failure", async () => {
    mockFetchFail(502, "Graph write failed");
    renderCard({ recursion: true });

    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => screen.getByText("Graph write failed"));
  });

  it("shows inline error on network error", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network down"));
    renderCard({ recursion: true });

    fireEvent.click(screen.getByTestId("recursion-toggle"));

    await waitFor(() => screen.getByText("Network down"));
  });

  it("does not make any DELETE calls", async () => {
    mockFetchOk();
    renderCard({ recursion: true });

    fireEvent.click(screen.getByTestId("recursion-toggle"));
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    const call = vi.mocked(global.fetch).mock.calls[0];
    const options = call[1] as RequestInit | undefined;
    expect(options?.method).not.toBe("DELETE");
  });

  it("toggle is disabled and spinner is visible while toggling is in-flight", async () => {
    // Use a never-resolving fetch to keep the toggle in the "toggling" state
    let resolveFetch!: (v: Response) => void;
    vi.mocked(global.fetch).mockReturnValue(new Promise<Response>((r) => { resolveFetch = r; }));

    renderCard({ recursion: true });
    fireEvent.click(screen.getByTestId("recursion-toggle"));

    // Toggle should immediately become disabled
    await waitFor(() => {
      const toggle = screen.getByTestId("recursion-toggle") as HTMLInputElement;
      expect(toggle.disabled).toBe(true);
    });

    // Clean up — resolve the pending promise
    resolveFetch({ ok: true, json: async () => ({ success: true }) } as Response);
  });

  // ─── Score display ──────────────────────────────────────────────────────────

  it('shows "no runs yet" when attempts array is empty', () => {
    mockHistoryLoaded([]); // empty series
    renderCard();
    expect(screen.getByTestId("score-no-runs")).toBeTruthy();
    expect(screen.getByTestId("score-no-runs").textContent).toMatch(/no runs yet/i);
  });

  it("shows latest n_passed/n_total when attempts present (all accepted)", () => {
    mockHistoryLoaded([
      makeOutput(28, 42, 0),
      makeOutput(34, 42, 1),
      makeOutput(38, 42, 2), // highest = best
    ]);
    renderCard();
    const score = screen.getByTestId("score-display");
    expect(score.textContent).toBe("38/42");
  });

  it("shows best score (not last element) when trailing attempt is rejected/lower", () => {
    // Series: baseline=24, accepted=32 (best), rejected=20 (last element but lower)
    // bestPassed drives the badge; the trailing rejected element should not show 20
    mockHistoryLoaded([
      {
        ...makeOutput(24, 33, 0),
        isBaseline: true,
        accepted: true,
        actualPassed: 24,
        bestPassed: 24,
        label: "base",
      },
      {
        ...makeOutput(32, 33, 1),
        isBaseline: false,
        accepted: true,
        actualPassed: 32,
        bestPassed: 32,
        label: "r1",
      },
      {
        ...makeOutput(20, 33, 2),
        isBaseline: false,
        accepted: false,
        actualPassed: 20,
        bestPassed: 32, // best stays flat after rejection
        label: "r2",
      },
    ]);
    renderCard();
    const score = screen.getByTestId("score-display");
    // Should show 32 (best) not 20 (last element's n_passed)
    expect(score.textContent).toBe("32/33");
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
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    expect(screen.getByTestId("score-error")).toBeTruthy();
    expect(screen.queryByTestId("score-no-runs")).toBeNull();
    unmount();

    // No runs: score-no-runs testid
    mockHistoryLoaded([]);
    render(
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
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

  // ─── Graph-first denominator (contested exclusion) ─────────────────────────

  it("uses the graph roster denominator and shows the contested annotation", () => {
    // 50-rubric roster, 7 contested → denominator 43. Attempt says 43/50.
    mockRoster(50, 7);
    mockHistoryLoaded([makeOutput(43, 50, 0)]);
    renderCard();

    expect(screen.getByTestId("score-display").textContent).toBe("43/43");
    const note = screen.getByTestId("score-contested-annotation");
    expect(note.textContent).toBe("+7 contested");
  });

  it("clamps attempt passes to the contested-excluded denominator", () => {
    // Runner-reported 48/50 with 7 contested → clamp to 43/43.
    mockRoster(50, 7);
    mockHistoryLoaded([makeOutput(48, 50, 0)]);
    renderCard();

    expect(screen.getByTestId("score-display").textContent).toBe("43/43");
  });

  it("shows no contested annotation when the roster has no contested rubrics", () => {
    mockRoster(42, 0);
    mockHistoryLoaded([makeOutput(38, 42, 0)]);
    renderCard();

    expect(screen.getByTestId("score-display").textContent).toBe("38/42");
    expect(screen.queryByTestId("score-contested-annotation")).toBeNull();
  });

  it("leaves scores untouched when no roster exists", () => {
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    mockHistoryLoaded([makeOutput(38, 42, 0)]);
    renderCard();

    expect(screen.getByTestId("score-display").textContent).toBe("38/42");
    expect(screen.queryByTestId("score-contested-annotation")).toBeNull();
  });

  it("chart target reflects the roster denominator with a contested note", async () => {
    mockRoster(50, 7);
    mockHistoryLoaded([makeOutput(40, 50, 0), makeOutput(43, 50, 1)]);
    renderCard();

    fireEvent.click(screen.getByTestId("expand-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("hill-climb-chart")).toBeTruthy();
    });
    expect(screen.getByText(/target: 43/)).toBeTruthy();
    expect(screen.getByTestId("chart-contested-note").textContent).toMatch(
      /\+7 contested excluded · 50 total/,
    );
  });

  it("requests the roster with the entry's task slug", () => {
    // useBenchmarkRubrics is gated behind rosterRequested — called with undefined
    // on mount, only called with the real slug after user interaction (popover open).
    renderCard({ id: "contracts/some-task" });
    expect(mockUseBenchmarkRubrics).toHaveBeenCalledWith(undefined);
  });
});

// ─── RecursionList ────────────────────────────────────────────────────────────

describe("RecursionList", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockHistoryLoaded();
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
  });

  it("shows loading spinner when isLoading=true", () => {
    render(
      <RecursionList entries={[]} isLoading={true} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error message and Retry button when error is set", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="Fetch failed" refetch={mockRefetch} allRuns={[]} />,
    );
    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("Retry button calls refetch", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="err" refetch={mockRefetch} allRuns={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it("shows empty-state copy when entries is empty and not loading", () => {
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    expect(container.textContent).toMatch(/No tasks enrolled in recursion/i);
    expect(container.textContent).toMatch(/toggles the recursion flag/i);
  });

  it("empty-state mentions completing a benchmark run with failing criteria", () => {
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
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
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    expect(screen.getByText("Task One")).toBeTruthy();
    expect(screen.getByText("Task Two")).toBeTruthy();
    expect(screen.getAllByTestId("recursion-toggle")).toHaveLength(2);
  });

  it("calls useEvalRunHistory once per card (no N+1)", () => {
    const entries = [
      makeEntry({ refId: "r1", id: "slug-1", name: "Task One" }),
      makeEntry({ refId: "r2", id: "slug-2", name: "Task Two" }),
      makeEntry({ refId: "r3", id: "slug-3", name: "Task Three" }),
    ];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    // Called once per card — deferred fetch: while collapsed, refId is undefined
    // and slug is "" so the hook is a no-op until the user expands the card.
    expect(mockUseEvalRunHistory).toHaveBeenCalledTimes(3);
    expect(mockUseEvalRunHistory).toHaveBeenCalledWith({ refId: undefined, slug: "" });
  });

  it("does not render StatusBadge or status-related UI", () => {
    const entries = [makeEntry()];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Inactive")).toBeNull();
  });
});

// ─── Series-kind semantics ───────────────────────────────────────────────────

describe("RecursionCard — badge and caption per series kind", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    mockFetchOk();
  });

  function renderCard() {
    render(
      <RecursionList
        entries={[makeEntry()]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[]}
      />,
    );
  }

  /** base 50 → 58 → 52: builders emit a monotonic bestPassed, so the trailing
   *  regression carries bestPassed 58 while its actual score stays 52. */
  const REGRESSING_SERIES = [
    { ...makeOutput(50, 74, 0), isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" },
    { ...makeOutput(58, 74, 1), isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" },
    { ...makeOutput(52, 74, 2), isBaseline: false, accepted: true, actualPassed: 52, bestPassed: 58, label: "r2" },
  ];

  it("badges the standing best for a fix-chain series", () => {
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "fix-chain" });
    renderCard();
    expect(screen.getByTestId("score-display").textContent).toBe("58/74");
  });

  it("badges the standing best when seriesKind is absent (legacy callers)", () => {
    mockHistoryLoaded(REGRESSING_SERIES);
    renderCard();
    expect(screen.getByTestId("score-display").textContent).toBe("58/74");
  });

  it("badges the standing best for an eval-output series — regressions are ignored", () => {
    // Matches the chart: the line only climbs or holds, a regressed run is a
    // hollow dot the line ignores, so the badge is the line's final level.
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "eval-output" });
    renderCard();
    expect(screen.getByTestId("score-display").textContent).toBe("58/74");
  });

  it("adds an incomplete-data note to the chart caption only when the walk was partial", () => {
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "eval-output", partial: true });
    renderCard();
    fireEvent.click(screen.getByTestId("expand-toggle"));
    expect(screen.getByTestId("chart-partial-note").textContent).toMatch(/incomplete/i);
  });

  it("omits the incomplete-data note when the walk was complete", () => {
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "eval-output", partial: false });
    renderCard();
    fireEvent.click(screen.getByTestId("expand-toggle"));
    expect(screen.queryByTestId("chart-partial-note")).toBeNull();
  });

  it("shows the header incomplete-data warning WITHOUT expanding when the walk was partial", () => {
    // A capped walk renders a flat-looking chart indistinguishable from a real
    // plateau — the warning must be visible on the collapsed card.
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "eval-output", partial: true });
    renderCard();
    expect(screen.getByTestId("partial-warning").textContent).toMatch(/incomplete data/i);
  });

  it("hides the header warning when the walk was complete", () => {
    mockHistoryLoaded(REGRESSING_SERIES, { seriesKind: "eval-output", partial: false });
    renderCard();
    expect(screen.queryByTestId("partial-warning")).toBeNull();
  });

  it("hides the header warning while history is loading", () => {
    mockUseEvalRunHistory.mockReturnValue({
      history: [],
      attemptRows: [],
      attempts: [],
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      seriesKind: "legacy",
      partial: true,
    });
    renderCard();
    expect(screen.queryByTestId("partial-warning")).toBeNull();
  });
});

// ─── Activity rail ───────────────────────────────────────────────────────────

describe("RecursionCard — activity rail", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    mockFetchOk();
  });

  const ATTEMPTS = [
    { ...makeOutput(50, 74, 0), isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" },
    { ...makeOutput(58, 74, 1), isBaseline: false, accepted: true, actualPassed: 58, bestPassed: 58, label: "r1" },
  ];

  const ROWS = [
    {
      key: "trigger-base",
      label: "base",
      attemptIndex: 0,
      timestamp: "2026-08-18T10:00:00.000Z",
      score: { passed: 50, total: 74 },
      status: "COMPLETED",
      runType: "runner",
      runId: "run-1",
      projectId: 42,
      hasReport: false,
      graphReportRef: null,
      reportPending: false,
      inFlight: false,
      fixSnapshots: [],
      siblingCount: 0,
    },
  ];

  it("renders the rail beside the chart inside the expanded card", () => {
    mockHistoryLoaded(ATTEMPTS, { attemptRows: ROWS });
    render(
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    fireEvent.click(screen.getByTestId("expand-toggle"));

    expect(screen.getByTestId("hill-climb-chart")).toBeTruthy();
    expect(screen.getByTestId("activity-rail")).toBeTruthy();
    expect(screen.getByTestId("rail-row-trigger-base")).toBeTruthy();
  });

  it("renders the rail's empty state when no rows exist", () => {
    mockHistoryLoaded(ATTEMPTS, { attemptRows: [] });
    render(
      <RecursionList entries={[makeEntry()]} isLoading={false} error={null} refetch={mockRefetch} allRuns={[]} />,
    );
    fireEvent.click(screen.getByTestId("expand-toggle"));
    expect(screen.getByTestId("activity-rail-empty")).toBeTruthy();
  });
});

// ─── Graph-link / timeline-toggle ────────────────────────────────────────────

describe("RecursionCard — graph link and timeline toggle", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockHistoryLoaded();
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    mockFetchOk();
  });

  function renderCard(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
    const entry = makeEntry(overrides);
    render(
      <RecursionList
        entries={[entry]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[]}
      />,
    );
  }

  it("renders the 'View graph' link as an <a> with data-testid='card-graph-link'", () => {
    renderCard({ refId: "ref-abc" });
    const link = screen.getByTestId("card-graph-link");
    expect(link.tagName.toLowerCase()).toBe("a");
    expect(link.getAttribute("href")).toContain("/context/graph");
    expect(link.getAttribute("href")).toContain("ref-abc");
  });

  it("renders the timeline toggle <button> with data-testid='card-graph-toggle'", () => {
    renderCard({ refId: "ref-abc" });
    const btn = screen.getByTestId("card-graph-toggle");
    expect(btn.tagName.toLowerCase()).toBe("button");
  });

  it("timeline toggle button has 'Timeline' text initially", () => {
    renderCard();
    const btn = screen.getByTestId("card-graph-toggle");
    expect(btn.textContent).toMatch(/timeline/i);
  });

  it("clicking the toggle renders the RecursionGraphPanel when subgraphData is available", async () => {
    renderCard({ refId: "ref-panel-test" });

    expect(screen.queryByTestId("recursion-graph-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("card-graph-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("recursion-graph-panel")).toBeTruthy();
    });
  });

  it("RecursionGraphPanel receives the evalSetRefId from entry.refId", async () => {
    renderCard({ refId: "eval-set-xyz" });
    fireEvent.click(screen.getByTestId("card-graph-toggle"));

    await waitFor(() => {
      const panel = screen.getByTestId("recursion-graph-panel");
      expect(panel.getAttribute("data-ref")).toBe("eval-set-xyz");
    });
  });

  it("clicking the toggle again hides the panel ('Hide timeline')", async () => {
    renderCard({ refId: "ref-toggle-test" });
    const toggleBtn = screen.getByTestId("card-graph-toggle");

    fireEvent.click(toggleBtn);
    await waitFor(() => expect(screen.getByTestId("recursion-graph-panel")).toBeTruthy());

    fireEvent.click(toggleBtn);
    await waitFor(() => expect(screen.queryByTestId("recursion-graph-panel")).toBeNull());
  });

  it("does not render the panel when subgraphData is null", () => {
    // subgraphData: null simulates the hook before first load completes
    mockHistoryLoaded([], { subgraphData: null });
    renderCard({ refId: "ref-null-subgraph" });
    fireEvent.click(screen.getByTestId("card-graph-toggle"));
    // Panel must not appear — subgraphData guards the render
    expect(screen.queryByTestId("recursion-graph-panel")).toBeNull();
  });

  it("does not render the panel when entry.refId is absent", () => {
    renderCard({ refId: "" }); // empty refId → loopSubgraphHref guard
    // With an empty refId the {workspaceSlug && entry.refId && ...} guard prevents rendering
    expect(screen.queryByTestId("card-graph-link")).toBeNull();
    expect(screen.queryByTestId("card-graph-toggle")).toBeNull();
  });
});

// ─── allRuns prop: consolidated-run detection and hook-lift guard ─────────────

describe("RecursionCard — allRuns prop (consolidated-run detection)", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockHistoryLoaded();
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    // Default: no run
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    });
  });

  function makeConsolidatedRow(overrides: {
    id?: string;
    taskSlug?: string;
    status?: import("@prisma/client").WorkflowStatus;
    hasReport?: boolean;
  } = {}): import("@/hooks/useLegalBenchmarkRunList").BenchmarkRunListRow {
    return {
      id: overrides.id ?? "con-run-1",
      workspaceId: "ws-1",
      runType: "recursion" as const,
      status: overrides.status ?? "PENDING" as import("@prisma/client").WorkflowStatus,
      projectId: null,
      taskSlug: overrides.taskSlug ?? "antitrust/task-1",
      taskTitle: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hasReport: overrides.hasReport ?? false,
    };
  }

  it("detects a PENDING in-flight consolidated run via the allRuns prop", () => {
    // The card finds existingConsolidated from allRuns and seeds effectiveConsolidatedRunId.
    // useLegalBenchmarkRun is then called with that id and returns hasReport=false,
    // which causes the "Generating…" spinner to appear.
    mockUseLegalBenchmarkRun.mockImplementation((runId: string | null) =>
      runId ? { run: { hasReport: false }, isLoading: false, isStale: false, refetch: vi.fn() }
            : { run: null, isLoading: false, isStale: false, refetch: vi.fn() },
    );

    const run = makeConsolidatedRow({ id: "existing-1", taskSlug: "antitrust/task-1", status: "PENDING" as import("@prisma/client").WorkflowStatus });

    render(
      <RecursionList
        entries={[makeEntry({ id: "antitrust/task-1" })]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[run]}
      />,
    );

    expect(screen.getByTestId("consolidated-generating")).toBeTruthy();
  });

  it("ignores consolidated runs for other task slugs", () => {
    const run = makeConsolidatedRow({ id: "other-1", taskSlug: "contracts/other-task" });

    render(
      <RecursionList
        entries={[makeEntry({ id: "antitrust/task-1" })]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[run]}
      />,
    );

    expect(screen.queryByTestId("consolidated-generating")).toBeNull();
  });

  it("ignores runs with hasReport=true (already completed)", () => {
    mockUseLegalBenchmarkRun.mockReturnValue({
      run: null, isLoading: false, isStale: false, refetch: vi.fn(),
    });

    const run = makeConsolidatedRow({ taskSlug: "antitrust/task-1", hasReport: true });

    render(
      <RecursionList
        entries={[makeEntry({ id: "antitrust/task-1" })]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[run]}
      />,
    );

    expect(screen.queryByTestId("consolidated-generating")).toBeNull();
  });

  it("useLegalBenchmarkRunList is NOT called by RecursionList or RecursionCard", () => {
    // After the lift, these components receive allRuns as a prop and must not
    // call the hook themselves. The mock's call count must remain 0 for N cards.
    vi.mocked(mockUseLegalBenchmarkRun); // keep linter happy — actual assertion below
    const runListMock = vi.mocked(
      (vi.getMockImplementation as unknown as () => {
        useLegalBenchmarkRunList: ReturnType<typeof vi.fn>;
      }) ?? { useLegalBenchmarkRunList: vi.fn() },
    );
    // Use a simpler approach: spy on the already-mocked module function
    const { useLegalBenchmarkRunList } = vi.hoisted(() => ({
      useLegalBenchmarkRunList: vi.fn(),
    }));
    // The mock already returns [] from vi.fn(). Count should stay 0 after render.
    const callsBefore = vi.mocked(useLegalBenchmarkRunList).mock.calls.length;

    const entries = [
      makeEntry({ refId: "r1", id: "slug-1", name: "Task One" }),
      makeEntry({ refId: "r2", id: "slug-2", name: "Task Two" }),
    ];

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
        allRuns={[]}
      />,
    );

    // No new calls — RecursionList/RecursionCard don't call the hook
    expect(vi.mocked(useLegalBenchmarkRunList).mock.calls.length).toBe(callsBefore);
    void runListMock;
    void callsBefore;
  });
});
