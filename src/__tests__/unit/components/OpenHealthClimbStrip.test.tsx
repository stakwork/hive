/**
 * @vitest-environment jsdom
 *
 * Unit tests for the climb strip:
 * - a running climb shows where it stands, its steps, the stage of the run in flight, and Stop;
 * - a step chip selects that step;
 * - Stop posts to the climb's cancel route;
 * - an ended climb shows the outcome, the reason, and "Climb again";
 * - a member who cannot launch gets a disabled Stop.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OpenHealthClimb, OpenHealthClimbStep } from "@/types/openhealth";

globalThis.React = React;

const mockAccess = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const mockPopover = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: mockAccess }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/components/openhealth/ClimbStartPopover", () => ({
  ClimbStartPopover: (props: { label?: string; gtId: number; meanRunCost?: number | null }) => {
    mockPopover(props);
    return <button data-testid="openhealth-climb-open">{props.label}</button>;
  },
}));

const { OpenHealthClimbStrip } = await import("@/components/openhealth/OpenHealthClimbStrip");

function step(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    kind: "benchmark",
    iteration: 0,
    outcome: "succeeded",
    f1: 0.71,
    metric: null,
    f1Official: null,
    contested: [],
    recall: null,
    precision: null,
    newBest: true,
    missed: [],
    extra: [],
    costUsd: 2.1,
    stages: null,
    applied: false,
    created: [],
    amended: [],
    rejected: [],
    contestsAccepted: [],
    contestsRejected: [],
    summary: null,
    startedAt: "2026-09-30T10:00:00.000Z",
    error: null,
    ...overrides,
  };
}

const STEPS: OpenHealthClimbStep[] = [
  step({ iteration: 0, f1: 0.71 }),
  step({
    kind: "improve",
    iteration: 0,
    f1: null,
    newBest: false,
    applied: true,
    created: ["A", "B", "C", "D"],
    costUsd: null,
  }),
  step({ iteration: 1, f1: 0.82 }),
  step({
    kind: "improve",
    iteration: 1,
    f1: null,
    newBest: false,
    applied: true,
    created: ["E", "F"],
    amended: ["G"],
    costUsd: null,
  }),
  step({
    iteration: 2,
    f1: null,
    newBest: false,
    outcome: "running",
    costUsd: null,
    stages: [
      { key: "task", label: "Load chart", status: "done" },
      { key: "ingest", label: "Ingest sections", status: "running", done: 5, total: 9 },
      { key: "plan", label: "Plan", status: "pending" },
    ],
  }),
];

function climb(overrides: Partial<OpenHealthClimb> = {}): OpenHealthClimb {
  return {
    id: "climb-1",
    strutRunId: "1790830428092",
    gtId: 7013,
    difficulty: "medium",
    task: "patient_diagnosis",
    variant: null,
    specialty: null,
    status: "running",
    stopReason: null,
    targetF1: 1,
    maxRuns: 5,
    attempts: 3,
    startF1: 0.71,
    bestF1: 0.82,
    bestF1Official: null,
    contested: [],
    bestRecall: null,
    bestPrecision: null,
    latestF1: 0.82,
    bestIteration: 1,
    costUsd: 4.2,
    steps: STEPS,
    durationMs: null,
    error: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    settledAt: null,
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockReturnValue({ canWrite: true });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/cancel") && init?.method === "POST") {
      return new Response(JSON.stringify({ success: true }), { status: 202 });
    }
    return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenHealthClimbStrip", () => {
  it("shows a running climb: where it stands, its steps, the stage in flight, and Stop", () => {
    render(<OpenHealthClimbStrip climb={climb()} />);

    expect(screen.getByTestId("openhealth-climb").getAttribute("data-status")).toBe("running");
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Climbing task 7013");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe("run 3 of 5 · best 0.82 · target 1.00");

    const steps = screen.getAllByTestId("openhealth-climb-step");
    expect(steps.map((s) => s.getAttribute("data-kind"))).toEqual([
      "benchmark",
      "improve",
      "benchmark",
      "improve",
      "benchmark",
    ]);
    expect(steps[0].textContent).toContain("Run 10.71new best");
    expect(steps[1].textContent).toContain("Improve+4");
    expect(steps[3].textContent).toContain("+2, 1 amended");
    expect(steps[4].textContent).toContain("Run 3ingest sections 5/9");
    expect(screen.getByText("up to run 5")).toBeTruthy();

    expect(screen.getByTestId("openhealth-climb-stop")).toBeTruthy();
    expect(screen.queryByTestId("openhealth-climb-open")).toBeNull();
    expect(screen.getByText("$4.20 so far")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a climb that has not started its first run yet", () => {
    render(
      <OpenHealthClimbStrip climb={climb({ steps: [], attempts: 0, startF1: null, bestF1: null, costUsd: null })} />,
    );
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe("starting · target 1.00");
    expect(screen.getByText("starting")).toBeTruthy();
  });

  it("selects the step a chip stands for, and marks the selected one", () => {
    const onSelectStep = vi.fn();
    render(<OpenHealthClimbStrip climb={climb()} selected={2} onSelectStep={onSelectStep} />);
    const steps = screen.getAllByTestId("openhealth-climb-step");

    expect(steps[2].getAttribute("aria-pressed")).toBe("true");
    expect(steps[0].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(steps[1]);
    expect(onSelectStep).toHaveBeenLastCalledWith(1);
    fireEvent.click(steps[4]);
    expect(onSelectStep).toHaveBeenLastCalledWith(4);
  });

  it("stops the climb through its cancel route", async () => {
    const onChanged = vi.fn();
    render(<OpenHealthClimbStrip climb={climb()} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId("openhealth-climb-stop"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/hive/openhealth/benchmarks/climbs/climb-1/cancel", {
      method: "POST",
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("shows a reached climb with its reason and Climb again", () => {
    const reached = climb({
      status: "reached",
      stopReason: "Run 3 scored 1.00.",
      attempts: 3,
      bestF1: 1,
      latestF1: 1,
      bestIteration: 2,
      costUsd: 6.3,
      steps: [...STEPS.slice(0, 4), step({ iteration: 2, f1: 1 })],
      settledAt: "2026-09-30T11:00:00.000Z",
    });
    render(<OpenHealthClimbStrip climb={reached} />);

    expect(screen.getByTestId("openhealth-climb").getAttribute("data-status")).toBe("reached");
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Reached 1.00 on task 7013");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe(
      "3 runs · 0.71 → 1.00 · 6 Concepts added, 1 amended · $6.30",
    );
    expect(screen.getByTestId("openhealth-climb-reason").textContent).toBe("Run 3 scored 1.00.");
    expect(screen.queryByTestId("openhealth-climb-stop")).toBeNull();
    expect(screen.queryByText("up to run 5")).toBeNull();
    expect(within(screen.getByTestId("openhealth-climb")).getByTestId("openhealth-climb-open").textContent).toBe(
      "Climb again",
    );
    expect(mockPopover).toHaveBeenCalledWith(expect.objectContaining({ gtId: 7013, meanRunCost: 2.1 }));
  });

  it("shows a climb that spent its runs, and one that failed in red", () => {
    const { unmount } = render(
      <OpenHealthClimbStrip
        climb={climb({ status: "exhausted", stopReason: "All 5 runs used; the best scored 0.82.", attempts: 5 })}
      />,
    );
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Stopped after 5 runs on task 7013");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toContain("target 1.00 not reached · 5 runs");
    unmount();

    render(<OpenHealthClimbStrip climb={climb({ status: "failed", stopReason: "iteration 2: no score" })} />);
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Climb failed on task 7013");
    expect(screen.getByTestId("openhealth-climb-reason").className).toContain("text-destructive");
  });

  it("disables Stop for a member who cannot launch", () => {
    mockAccess.mockReturnValue({ canWrite: false });
    render(<OpenHealthClimbStrip climb={climb()} />);
    expect((screen.getByTestId("openhealth-climb-stop") as HTMLButtonElement).disabled).toBe(true);
  });
});
