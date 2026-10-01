/**
 * @vitest-environment jsdom
 *
 * Unit tests for the climb strip:
 * - a running climb shows where it stands, its steps, and Stop;
 * - a step opens the run it stands for (an improve step, the attempt before it);
 * - Stop posts to the climb's stop route;
 * - an ended climb shows the outcome, the reason, and "Climb again" from the best run;
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
  ClimbStartPopover: (props: { label?: string; seed?: { runId: string } }) => {
    mockPopover(props);
    return <button data-testid="openhealth-climb-open">{props.label}</button>;
  },
}));

const { OpenHealthClimbStrip } = await import("@/components/openhealth/OpenHealthClimbStrip");

function step(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    runId: "run-1",
    kind: "benchmark",
    attempt: 1,
    outcome: "succeeded",
    f1: 0.71,
    newBest: true,
    created: null,
    amended: null,
    costUsd: 2.1,
    error: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    settledAt: "2026-09-30T10:20:00.000Z",
    ...overrides,
  };
}

const STEPS: OpenHealthClimbStep[] = [
  step({ runId: "run-1", attempt: 1, f1: 0.71 }),
  step({
    runId: "imp-1",
    kind: "improve",
    attempt: 1,
    f1: null,
    newBest: false,
    created: 4,
    amended: 0,
    costUsd: null,
  }),
  step({ runId: "run-2", attempt: 2, f1: 0.82 }),
  step({
    runId: "imp-2",
    kind: "improve",
    attempt: 2,
    f1: null,
    newBest: false,
    created: 2,
    amended: 1,
    costUsd: null,
  }),
  step({ runId: "run-3", attempt: 3, f1: null, newBest: false, outcome: "running", costUsd: null, settledAt: null }),
];

function climb(overrides: Partial<OpenHealthClimb> = {}): OpenHealthClimb {
  return {
    id: "climb-1",
    gtId: 7532,
    status: "running",
    stopReason: null,
    targetF1: 1,
    maxAttempts: 5,
    attempts: 3,
    startF1: 0.71,
    bestF1: 0.82,
    latestF1: 0.82,
    bestRunId: "run-2",
    currentRunId: "run-3",
    costUsd: 4.2,
    steps: STEPS,
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
    if (url.endsWith("/progress")) {
      return new Response(
        JSON.stringify({
          stages: [
            { key: "task", label: "Load chart", status: "done" },
            { key: "ingest", label: "Ingest sections", status: "running", done: 5, total: 9 },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/stop") && init?.method === "POST") {
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
  it("shows a running climb: where it stands, its steps, the stage in flight, and Stop", async () => {
    render(<OpenHealthClimbStrip climb={climb()} />);

    expect(screen.getByTestId("openhealth-climb").getAttribute("data-status")).toBe("running");
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Climbing task 7532");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe("attempt 3 of 5 · best 0.82 · target 1.00");

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
    await waitFor(() => expect(steps[4].textContent).toContain("ingest sections 5/9"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/hive/openhealth/benchmarks/runs/run-3/progress",
      expect.anything(),
    );

    expect(screen.getByTestId("openhealth-climb-stop")).toBeTruthy();
    expect(screen.queryByTestId("openhealth-climb-open")).toBeNull();
    expect(screen.getByText("$4.20 so far")).toBeTruthy();
  });

  it("opens the run a step stands for; an improve step opens the attempt before it", async () => {
    const onOpenRun = vi.fn();
    render(<OpenHealthClimbStrip climb={climb()} onOpenRun={onOpenRun} />);
    const steps = screen.getAllByTestId("openhealth-climb-step");
    await waitFor(() => expect(steps[4].textContent).toContain("ingest sections 5/9"));

    fireEvent.click(steps[2]);
    expect(onOpenRun).toHaveBeenLastCalledWith("run-2");
    fireEvent.click(steps[1]);
    expect(onOpenRun).toHaveBeenLastCalledWith("run-1");
  });

  it("stops the climb through its stop route", async () => {
    const onChanged = vi.fn();
    render(<OpenHealthClimbStrip climb={climb()} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId("openhealth-climb-stop"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/hive/openhealth/benchmarks/climbs/climb-1/stop", {
      method: "POST",
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("shows a reached climb with its reason and Climb again from the best run", () => {
    const reached = climb({
      status: "reached",
      stopReason: "Attempt 3 scored 1.00.",
      attempts: 3,
      bestF1: 1,
      latestF1: 1,
      bestRunId: "run-3",
      currentRunId: null,
      costUsd: 6.3,
      steps: [...STEPS.slice(0, 4), step({ runId: "run-3", attempt: 3, f1: 1 })],
      settledAt: "2026-09-30T11:00:00.000Z",
    });
    render(<OpenHealthClimbStrip climb={reached} />);

    expect(screen.getByTestId("openhealth-climb").getAttribute("data-status")).toBe("reached");
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Reached 1.00 on task 7532");
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toBe(
      "3 attempts · 0.71 → 1.00 · 6 Concepts added, 1 amended · $6.30",
    );
    expect(screen.getByTestId("openhealth-climb-reason").textContent).toBe("Attempt 3 scored 1.00.");
    expect(screen.queryByTestId("openhealth-climb-stop")).toBeNull();
    expect(within(screen.getByTestId("openhealth-climb")).getByTestId("openhealth-climb-open").textContent).toBe(
      "Climb again",
    );
    expect(mockPopover).toHaveBeenCalledWith(expect.objectContaining({ gtId: 7532, seed: { runId: "run-3", f1: 1 } }));
  });

  it("shows a failed climb's reason in red", () => {
    render(
      <OpenHealthClimbStrip
        climb={climb({
          status: "failed",
          stopReason: "Attempt 3 failed: no problem list produced",
          currentRunId: null,
        })}
      />,
    );
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Climb failed on task 7532");
    expect(screen.getByTestId("openhealth-climb-reason").className).toContain("text-destructive");
  });

  it("disables Stop for a member who cannot launch", async () => {
    mockAccess.mockReturnValue({ canWrite: false });
    render(<OpenHealthClimbStrip climb={climb()} />);
    expect((screen.getByTestId("openhealth-climb-stop") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() =>
      expect(screen.getAllByTestId("openhealth-climb-step")[4].textContent).toContain("ingest sections 5/9"),
    );
  });
});
