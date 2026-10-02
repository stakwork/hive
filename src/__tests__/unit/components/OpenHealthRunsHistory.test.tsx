/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Runs tab with a climb on it:
 * - a climb's strip shows once: in its open row, or above the chart while
 *   the row is closed — never both;
 * - a chip on the strip above the chart opens the row at that step, and
 *   the strip moves into the row;
 * - a point on the chart picks a step in the row that is already open, as
 *   does a chip in the row's own strip, in any order.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OpenHealthClimbPoint } from "@/lib/openhealth-benchmarks/runs";
import type { OpenHealthClimb, OpenHealthClimbStep } from "@/types/openhealth";

globalThis.React = React;

const mockSearchParams = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockUseClimbs = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/w/hive/openhealth/benchmarks",
  useSearchParams: mockSearchParams,
}));
vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("@/hooks/useOpenHealthRuns", () => ({
  useOpenHealthRuns: () => ({ runs: [], loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("@/hooks/useOpenHealthClimbs", () => ({ useOpenHealthClimbs: mockUseClimbs }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/openhealth/ClimbStartPopover", () => ({
  ClimbStartPopover: ({ label }: { label?: string }) => <button data-testid="openhealth-climb-open">{label}</button>,
}));
vi.mock("@/components/openhealth/OpenHealthRunViewer", () => ({
  OpenHealthRunViewer: () => <div data-testid="openhealth-run-viewer" />,
}));
vi.mock("@/components/strut-run-graph", () => ({ StrutRunGraph: () => <div data-testid="run-graph" /> }));
vi.mock("@/components/openhealth/OpenHealthRunViewer/ArtifactPanel", () => ({
  ArtifactPanel: () => <div data-testid="artifact-panel" />,
}));
// The chart as one button per point, so a click needs no layout.
vi.mock("@/components/openhealth/OpenHealthClimbChart", () => ({
  OpenHealthClimbChart: ({
    points,
    onSelect,
  }: {
    points: OpenHealthClimbPoint[];
    onSelect?: (point: OpenHealthClimbPoint) => void;
  }) => (
    <div data-testid="openhealth-climb-chart">
      {points.map((point) => (
        <button key={point.key} data-testid="chart-point" data-key={point.key} onClick={() => onSelect?.(point)}>
          {point.key}
        </button>
      ))}
    </div>
  ),
}));

const { OpenHealthRunsHistory } = await import("@/components/openhealth/OpenHealthRunsHistory");

function step(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    kind: "benchmark",
    iteration: 0,
    outcome: "succeeded",
    f1: 0.6,
    f1Official: null,
    contested: [],
    recall: null,
    precision: null,
    newBest: true,
    missed: ["E119"],
    extra: ["R51"],
    costUsd: 1.5,
    stages: null,
    applied: false,
    created: [],
    amended: [],
    rejected: [],
    contestsAccepted: [],
    contestsRejected: [],
    summary: null,
    startedAt: "2026-10-01T04:53:48.000Z",
    error: null,
    ...overrides,
  };
}

/** A climb in flight: two runs scored, an improve between them, the improve after the second running. */
const CLIMB: OpenHealthClimb = {
  id: "climb-1",
  strutRunId: "1790830428092",
  gtId: 7013,
  difficulty: "medium",
  status: "running",
  stopReason: null,
  targetF1: 1,
  maxRuns: 5,
  attempts: 2,
  startF1: 0.6,
  bestF1: 0.8,
  bestF1Official: null,
  contested: [],
  bestRecall: 0.9,
  bestPrecision: 0.75,
  latestF1: 0.8,
  bestIteration: 1,
  costUsd: 3,
  steps: [
    step({ iteration: 0, f1: 0.6, recall: 0.5, precision: 0.4 }),
    step({
      kind: "improve",
      iteration: 0,
      f1: null,
      newBest: false,
      applied: true,
      created: ["Diabetes Follow-up"],
      summary: "One Concept.",
      costUsd: null,
    }),
    step({ iteration: 1, f1: 0.8, recall: 0.9, precision: 0.75, startedAt: "2026-10-01T05:10:00.000Z" }),
    step({ kind: "improve", iteration: 1, f1: null, newBest: false, outcome: "running", costUsd: null }),
  ],
  durationMs: null,
  error: null,
  createdAt: "2026-10-01T04:53:48.000Z",
  settledAt: null,
};

const strips = () => screen.getAllByTestId("openhealth-climb");
const detail = () => screen.getByTestId("openhealth-climb-step-detail");
const chartPoint = (key: string) =>
  screen.getAllByTestId("chart-point").find((button) => button.getAttribute("data-key") === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseClimbs.mockReturnValue({ climbs: [CLIMB], loading: false, error: null, reload: vi.fn() });
  // A fresh Response per call: the viewer reads the climb again each time its row opens.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(CLIMB), { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenHealthRunsHistory with a climb", () => {
  it("shows the climb's strip once: in its open row, or above the chart while the row is closed", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&task=7013&climb=climb-1"));
    render(<OpenHealthRunsHistory />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-viewer")).toBeTruthy());

    expect(strips()).toHaveLength(1);
    expect(within(screen.getByTestId("openhealth-climb-viewer")).getByTestId("openhealth-climb")).toBeTruthy();

    // Closing the row brings the strip back above the chart — still one.
    fireEvent.click(screen.getByTestId("openhealth-climb-row"));
    expect(screen.queryByTestId("openhealth-climb-viewer")).toBeNull();
    expect(strips()).toHaveLength(1);
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Climbing task 7013");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe("run 2 of 5 · best 0.80 · target 1.00");

    fireEvent.click(screen.getByTestId("openhealth-climb-row"));
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-viewer")).toBeTruthy());
    expect(strips()).toHaveLength(1);
  });

  it("shows the best run's recall and precision on the climb row", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&task=7013"));
    render(<OpenHealthRunsHistory />);
    const cells = within(screen.getByTestId("openhealth-climb-row")).getAllByRole("cell");
    // F1 span, tier, recall, precision.
    expect(cells.slice(5, 9).map((cell) => cell.textContent)).toEqual(["0.60 → 0.80", "—", "0.90", "0.75"]);
  });

  it("shows a running climb's strip once in the all-tasks view too", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&climb=climb-1"));
    render(<OpenHealthRunsHistory />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-viewer")).toBeTruthy());

    expect(screen.getByTestId("openhealth-summary-easy")).toBeTruthy();
    expect(strips()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("openhealth-climb-row"));
    expect(screen.queryByTestId("openhealth-climb-viewer")).toBeNull();
    expect(strips()).toHaveLength(1);
  });

  it("a chip above the chart opens the row at that step, and the strip moves into the row", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&task=7013"));
    render(<OpenHealthRunsHistory />);
    expect(screen.queryByTestId("openhealth-climb-viewer")).toBeNull();
    expect(strips()).toHaveLength(1);

    fireEvent.click(screen.getAllByTestId("openhealth-climb-step")[0]);
    await waitFor(() => expect(detail().textContent).toContain("Run 1"));
    expect(strips()).toHaveLength(1);
    expect(within(screen.getByTestId("openhealth-climb-viewer")).getByTestId("openhealth-climb")).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith("/w/hive/openhealth/benchmarks?tab=runs&task=7013&climb=climb-1", {
      scroll: false,
    });
  });

  it("a point on the chart picks the step in the row that is open, before and after a chip does", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=runs&task=7013&climb=climb-1"));
    render(<OpenHealthRunsHistory />);
    await waitFor(() => expect(detail().textContent).toContain("Improve after run 2"));

    fireEvent.click(chartPoint("climb-1#0"));
    expect(detail().getAttribute("data-kind")).toBe("benchmark");
    expect(detail().textContent).toContain("Run 1");

    // A chip in the row's own strip picks too…
    fireEvent.click(screen.getAllByTestId("openhealth-climb-step")[2]);
    expect(detail().textContent).toContain("Run 2");
    expect(screen.getAllByTestId("openhealth-climb-step")[2].getAttribute("aria-pressed")).toBe("true");

    // …and the chart still can afterwards.
    fireEvent.click(chartPoint("climb-1#0"));
    expect(detail().textContent).toContain("Run 1");
    expect(screen.getAllByTestId("openhealth-climb-step")[0].getAttribute("aria-pressed")).toBe("true");
  });
});
