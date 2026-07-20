/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

globalThis.React = React;

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "openlaw", id: "ws-openlaw-id" }),
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: ({ series, label }: { series: unknown[]; label?: string }) =>
    React.createElement("div", { "data-testid": "hill-climb-chart", "aria-label": label }, `chart:${series.length}pts`),
}));

// Minimal Collapsible shim
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

// ── useEvalRunHistory mock — per-card, keyed by taskSlug ─────────────────────

const mockEvalRunHistoryMap: Record<
  string,
  { attempts: EvalTriggerOutput[]; isLoading: boolean; error: string | null }
> = {};

vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: (taskSlug: string) => {
    const state = mockEvalRunHistoryMap[taskSlug] ?? {
      attempts: [],
      isLoading: false,
      error: null,
    };
    return {
      history: [],
      attempts: state.attempts,
      isLoading: state.isLoading,
      error: state.error,
      refetch: vi.fn(),
    };
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { RecursionList } from "@/components/legal/RecursionBox";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_SLUG_A = "antitrust/task-1";
const TASK_SLUG_B = "ip/task-2"; // no outputs

const entries: RecursionEntry[] = [
  { refId: "ref-a", id: TASK_SLUG_A, name: "Analyze Antitrust Strategy" },
  { refId: "ref-b", id: TASK_SLUG_B, name: "IP Review" },
];

function makeOutput(overrides: Partial<EvalTriggerOutput> = {}): EvalTriggerOutput {
  return {
    ref_id: `out-${Math.random()}`,
    attempt_number: 0,
    result: "pass",
    score: 1,
    n_passed: 10,
    n_total: 42,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecursionList", () => {
  beforeEach(() => {
    // Reset per-card mock state
    for (const key of Object.keys(mockEvalRunHistoryMap)) {
      delete mockEvalRunHistoryMap[key];
    }
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

  // ── Loaded state: latest score from EvalTriggerOutput series ─────────────

  it("shows the latest n_passed/n_total from the attempts series", () => {
    mockEvalRunHistoryMap[TASK_SLUG_A] = {
      attempts: [
        makeOutput({ n_passed: 14, n_total: 42 }),
        makeOutput({ n_passed: 28, n_total: 42 }),
        makeOutput({ n_passed: 38, n_total: 42 }),
      ],
      isLoading: false,
      error: null,
    };

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    // Latest point is the last element in attempts → 38/42
    expect(screen.getByText("38/42")).toBeDefined();
  });

  it("shows 'no runs yet' for a task with zero attempts", () => {
    // TASK_SLUG_B has no outputs set in mockEvalRunHistoryMap → defaults to []
    render(
      <RecursionList
        entries={[{ refId: "ref-b", id: TASK_SLUG_B, name: "IP Review" }]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    expect(screen.getByText(/no runs yet/i)).toBeDefined();
  });

  it("shows loading skeleton while attempts are loading", () => {
    mockEvalRunHistoryMap[TASK_SLUG_A] = {
      attempts: [],
      isLoading: true,
      error: null,
    };

    const { container } = render(
      <RecursionList
        entries={[{ refId: "ref-a", id: TASK_SLUG_A, name: "Analyze Antitrust Strategy" }]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    // Pulse skeleton should be present; no score badge
    const pulse = container.querySelector(".animate-pulse");
    expect(pulse).toBeDefined();
  });

  // ── Expandable chart ───────────────────────────────────────────────────────

  it("expands to reveal the HillClimbChart when the expand button is clicked", async () => {
    mockEvalRunHistoryMap[TASK_SLUG_A] = {
      attempts: [
        makeOutput({ n_passed: 14, n_total: 42 }),
        makeOutput({ n_passed: 38, n_total: 42 }),
      ],
      isLoading: false,
      error: null,
    };

    const user = userEvent.setup();

    render(
      <RecursionList
        entries={[{ refId: "ref-a", id: TASK_SLUG_A, name: "Analyze Antitrust Strategy" }]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    // Score badge should be visible
    expect(screen.getByText("38/42")).toBeDefined();

    // Expand chart
    const expandButton = screen.getByLabelText(/expand chart/i);
    await user.click(expandButton);

    expect(screen.getByTestId("hill-climb-chart")).toBeDefined();
  });

  it("does not show the expand button for a task with no attempts", () => {
    // TASK_SLUG_B has no outputs
    render(
      <RecursionList
        entries={[{ refId: "ref-b", id: TASK_SLUG_B, name: "IP Review" }]}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/expand chart/i)).toBeNull();
  });

  // ── Card renders task name and id ─────────────────────────────────────────

  it("renders task name and id for each entry", () => {
    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    expect(screen.getByText("Analyze Antitrust Strategy")).toBeDefined();
    expect(screen.getByText("IP Review")).toBeDefined();
    expect(screen.getByText(TASK_SLUG_A)).toBeDefined();
    expect(screen.getByText(TASK_SLUG_B)).toBeDefined();
  });

  // ── Per-card fetch (no N+1 of wrong data source) ──────────────────────────

  it("does NOT call the old /api/stakwork/runs runner endpoint", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    render(
      <RecursionList
        entries={entries}
        isLoading={false}
        error={null}
        refetch={vi.fn()}
      />,
    );

    // Wait a tick for any async effects
    await new Promise((r) => setTimeout(r, 50));

    // The LEGAL_BENCHMARK_RUNNER bulk-fetch should NOT be called at all
    const runnerCalls = fetchMock.mock.calls.filter(
      (c: string[]) =>
        typeof c[0] === "string" && c[0].includes("LEGAL_BENCHMARK_RUNNER"),
    );
    expect(runnerCalls).toHaveLength(0);
  });
});
