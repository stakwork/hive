/**
 * @vitest-environment jsdom
 *
 * Tests for the consolidated-report additions to RecursionCard.
 *
 * Covers:
 * - "Consolidated Report" button renders in the card header
 * - Clicking dispatches POST to the correct endpoint with { taskSlug, runIds }
 *   assembled from attemptRows (hasReport=true, runId non-null, latest-first)
 * - After POST returns { run_id }, consolidatedRunId state is set and button disabled
 * - Spinner + "Generating…" label visible while run has no report
 * - "View Consolidated Report" link visible when run has hasReport=true
 *   with correct href, target="_blank", rel, and aria-label
 * - null runId rows in attemptRows are silently excluded (console.warn)
 * - triggerError displayed when POST fails
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    return React.createElement("div", null, children);
  },
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: () => React.createElement("div", { "data-testid": "hill-climb-chart" }),
}));

vi.mock("@/components/legal/RecursionActivityRail", () => ({
  RecursionActivityRail: () =>
    React.createElement("div", { "data-testid": "activity-rail" }),
  attemptReportHref: () => null,
}));

// ─── useLegalBenchmarkRun mock ─────────────────────────────────────────────────

const mockUseLegalBenchmarkRun = vi.fn();

vi.mock("@/hooks/useLegalBenchmarkRun", () => ({
  useLegalBenchmarkRun: (runId: string | null, type: string) =>
    mockUseLegalBenchmarkRun(runId, type),
}));

// ─── Other hooks mocks ─────────────────────────────────────────────────────────

const mockUseEvalRunHistory = vi.fn();
vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: (input: unknown) => mockUseEvalRunHistory(input),
}));

const mockUseBenchmarkRubrics = vi.fn();
vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  useBenchmarkRubrics: () => mockUseBenchmarkRubrics(),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { slug: "openlaw", id: "ws-1" },
    role: "DEVELOPER",
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  PopoverContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/run-report/NodePeek", () => ({
  graphExplorerHref: () => "/graph",
}));

global.fetch = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
  return {
    refId: "ref-abc",
    id: "antitrust/task-1",
    name: "Antitrust Task 1",
    ...overrides,
  };
}

function makeAttemptRow(overrides: {
  runId?: string | null;
  hasReport?: boolean;
  timestamp?: string;
  runType?: string;
} = {}) {
  return {
    key: overrides.runId ?? "graph-key",
    label: "r1",
    attemptIndex: 0,
    timestamp: overrides.timestamp ?? "2026-08-18T10:00:00.000Z",
    score: { passed: 50, total: 74 },
    status: "COMPLETED",
    runType: overrides.runType ?? "runner",
    runId: overrides.runId ?? "run-abc",
    projectId: null,
    hasReport: overrides.hasReport ?? true,
    graphReportRef: null,
    reportPending: false,
    inFlight: false,
    fixSnapshot: null,
  };
}

function setupEvalHistory(attemptRows: ReturnType<typeof makeAttemptRow>[] = []) {
  mockUseEvalRunHistory.mockReturnValue({
    history: [],
    attemptRows,
    attempts: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function setupConsolidatedRun(overrides: { hasReport?: boolean } = {}) {
  mockUseLegalBenchmarkRun.mockReturnValue({
    run: { hasReport: overrides.hasReport ?? false },
    isLoading: false,
    isStale: false,
    refetch: vi.fn(),
  });
}

function setupNoConsolidatedRun() {
  // null runId → no-op state
  mockUseLegalBenchmarkRun.mockReturnValue({
    run: null,
    isLoading: false,
    isStale: false,
    refetch: vi.fn(),
  });
}

function mockFetchConsolidated(runId = "consolidated-xyz") {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ run_id: runId }),
  } as Response);
}

function mockFetchConsolidatedFail(status = 500, error = "Server error") {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error }),
  } as Response);
}

function mockFetchToggleOk() {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  } as Response);
}

import { RecursionList } from "@/components/legal/RecursionBox";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RecursionCard — consolidated report trigger", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });
    setupEvalHistory();
    setupNoConsolidatedRun();
    mockFetchToggleOk(); // default: toggle fetch ok
  });

  function renderCard(
    overrides: Partial<{ refId: string; id: string; name: string }> = {},
  ) {
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

  it("renders the 'Consolidated Report' button in the card header", () => {
    renderCard();
    const btn = screen.getByTestId("consolidated-report-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Consolidated Report");
  });

  it("button is enabled when no run is in-flight", () => {
    renderCard();
    const btn = screen.getByTestId("consolidated-report-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("dispatches POST to correct endpoint with taskSlug and runIds on click", async () => {
    const rows = [
      makeAttemptRow({ runId: "run-001", hasReport: true, timestamp: "2026-08-18T10:00:00Z" }),
      makeAttemptRow({ runId: "run-002", hasReport: true, timestamp: "2026-08-17T10:00:00Z" }),
    ];
    setupEvalHistory(rows);
    mockFetchConsolidated("consolidated-xyz");
    // After the consolidated dispatch, useLegalBenchmarkRun is called with the run_id.
    // The mock returns run=null for null runId (initial) and run with hasReport=false for the new id.
    mockUseLegalBenchmarkRun.mockImplementation((runId) => ({
      run: runId ? { hasReport: false } : null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    }));

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        "/api/workspaces/openlaw/legal/benchmarks/consolidated-report",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const call = vi.mocked(global.fetch).mock.calls.find((c) =>
      String(c[0]).includes("consolidated-report"),
    );
    const body = JSON.parse((call![1] as RequestInit).body as string) as {
      taskSlug: string;
      runIds: string[];
    };
    expect(body.taskSlug).toBe("antitrust/task-1");
    // Latest-first: run-001 (Aug 18) before run-002 (Aug 17)
    expect(body.runIds).toEqual(["run-001", "run-002"]);
  });

  it("shows spinner and disables button while run is in-flight (hasReport=false)", async () => {
    setupEvalHistory([makeAttemptRow({ runId: "run-001", hasReport: true })]);
    mockFetchConsolidated("consolidated-xyz");
    // Simulate: after POST, the run exists but hasReport=false
    mockUseLegalBenchmarkRun.mockImplementation((runId) => ({
      run: runId ? { hasReport: false } : null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    }));

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("consolidated-report-generating")).toBeTruthy();
    });

    const btn = screen.getByTestId("consolidated-report-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows 'View Consolidated Report' link when hasReport=true", async () => {
    setupEvalHistory([makeAttemptRow({ runId: "run-001", hasReport: true })]);
    mockFetchConsolidated("consolidated-xyz");
    // After POST, useLegalBenchmarkRun returns hasReport=true
    mockUseLegalBenchmarkRun.mockImplementation((runId) => ({
      run: runId ? { hasReport: true } : null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    }));

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("view-consolidated-report-link")).toBeTruthy();
    });

    const link = screen.getByTestId("view-consolidated-report-link") as HTMLAnchorElement;
    expect(link.href).toContain("/w/openlaw/legal/benchmarks/consolidated/consolidated-xyz/report");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.getAttribute("aria-label")).toContain("consolidated report");
  });

  it("excludes rows where hasReport=false from runIds payload", async () => {
    const rows = [
      makeAttemptRow({ runId: "run-001", hasReport: true }),
      makeAttemptRow({ runId: "run-002", hasReport: false }),
    ];
    setupEvalHistory(rows);
    mockFetchConsolidated("consolidated-xyz");

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      const call = vi.mocked(global.fetch).mock.calls.find((c) =>
        String(c[0]).includes("consolidated-report"),
      );
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        taskSlug: string;
        runIds: string[];
      };
      expect(body.runIds).toEqual(["run-001"]);
      expect(body.runIds).not.toContain("run-002");
    });
  });

  it("excludes rows where runId is null from runIds payload (and warns)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Two rows: one with runId=null (should be excluded), one with a real runId.
    // Use distinct keys to avoid dedup collisions.
    const nullRow = { ...makeAttemptRow({ hasReport: true }), runId: null as null, key: "null-row" };
    const realRow = { ...makeAttemptRow({ hasReport: true }), runId: "run-001", key: "real-row" };
    setupEvalHistory([nullRow, realRow]);
    mockFetchConsolidated("consolidated-xyz");

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      const call = vi.mocked(global.fetch).mock.calls.find((c) =>
        String(c[0]).includes("consolidated-report"),
      );
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        taskSlug: string;
        runIds: string[];
      };
      // null runId row excluded; only the real one ships
      expect(body.runIds).toContain("run-001");
      expect(body.runIds).not.toContain(null);
    });

    // console.warn called for the null runId row
    expect(warnSpy).toHaveBeenCalledWith(
      "[RecursionCard] Excluded null runId from consolidated report payload",
      expect.any(Object),
    );
    warnSpy.mockRestore();
  });

  it("shows triggerError inline when POST fails", async () => {
    setupEvalHistory([makeAttemptRow({ runId: "run-001", hasReport: true })]);
    mockFetchConsolidatedFail(500, "Workflow dispatch failed");

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("trigger-error")).toBeTruthy();
      expect(screen.getByTestId("trigger-error").textContent).toContain("Workflow dispatch failed");
    });
  });

  it("does not dispatch a second POST if a run is already in-flight", async () => {
    setupEvalHistory([makeAttemptRow({ runId: "run-001", hasReport: true })]);
    mockFetchConsolidated("consolidated-xyz");
    // After POST, run has hasReport=false (in-flight)
    mockUseLegalBenchmarkRun.mockImplementation((runId) => ({
      run: runId ? { hasReport: false } : null,
      isLoading: false,
      isStale: false,
      refetch: vi.fn(),
    }));

    renderCard();
    fireEvent.click(screen.getByTestId("consolidated-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("consolidated-report-generating")).toBeTruthy();
    });

    const callsBefore = vi.mocked(global.fetch).mock.calls.filter((c) =>
      String(c[0]).includes("consolidated-report"),
    ).length;

    // Try clicking again — should be disabled
    const btn = screen.getByTestId("consolidated-report-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // No second dispatch
    const callsAfter = vi.mocked(global.fetch).mock.calls.filter((c) =>
      String(c[0]).includes("consolidated-report"),
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });
});
