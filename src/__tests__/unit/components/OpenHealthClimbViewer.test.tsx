/**
 * @vitest-environment jsdom
 *
 * Unit tests for the climb viewer:
 * - it reads the climb and shows its newest step in full;
 * - a benchmark step shows its score, what it missed and added, and its
 *   files pills addressed by iteration; an improve step shows its Concepts;
 * - `selected` opens with that step; with `onSelectStep` the caller owns
 *   the selection, a chip reports to it, and a change to it shows;
 * - the graph opens on the selected step's own subflow, and follows a pick;
 * - a climb that cannot be read says so.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OpenHealthClimb, OpenHealthClimbStep } from "@/types/openhealth";

globalThis.React = React;

const mockArtifact = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/openhealth/ClimbStartPopover", () => ({
  ClimbStartPopover: ({ label }: { label?: string }) => <button data-testid="openhealth-climb-open">{label}</button>,
}));
vi.mock("@/components/strut-run-graph", () => ({
  StrutRunGraph: ({ endpoint, scope }: { endpoint: string; scope?: string | null }) => (
    <div data-testid="run-graph" data-scope={scope ?? ""}>
      {endpoint}
    </div>
  ),
}));
vi.mock("@/components/openhealth/OpenHealthRunViewer/ArtifactPanel", () => ({
  ArtifactPanel: (props: { endpoint: string; kind: string }) => {
    mockArtifact(props);
    return <div data-testid="artifact-panel">{props.endpoint}</div>;
  },
}));

const { OpenHealthClimbViewer } = await import("@/components/openhealth/OpenHealthClimbViewer");

function step(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    kind: "benchmark",
    iteration: 0,
    outcome: "succeeded",
    f1: 0.6,
    metric: null,
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

const CLIMB: OpenHealthClimb = {
  id: "climb-1",
  strutRunId: "1790830428092",
  gtId: 7013,
  difficulty: "medium",
  task: "patient_diagnosis",
  variant: null,
  specialty: null,
  status: "reached",
  stopReason: "Run 2 scored 1.00.",
  targetF1: 1,
  maxRuns: 3,
  attempts: 2,
  startF1: 0.6,
  bestF1: 1,
  bestF1Official: null,
  contested: [],
  bestRecall: null,
  bestPrecision: null,
  latestF1: 1,
  bestIteration: 1,
  costUsd: 3,
  steps: [
    step({ iteration: 0, f1: 0.6 }),
    step({
      kind: "improve",
      iteration: 0,
      f1: null,
      newBest: false,
      applied: true,
      created: ["Diabetes Follow-up"],
      amended: ["Hypertension"],
      rejected: ["Too Broad"],
      summary: "One Concept and an amend.",
      costUsd: null,
    }),
    step({ iteration: 1, f1: 1, missed: [], extra: [] }),
  ],
  durationMs: 1_800_000,
  error: null,
  createdAt: "2026-10-01T04:53:48.000Z",
  settledAt: "2026-10-01T05:23:48.000Z",
};

const ENDPOINT = "/api/workspaces/hive/openhealth/benchmarks/climbs/climb-1";
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(CLIMB), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenHealthClimbViewer", () => {
  it("reads the climb and shows its newest run in full, with its files by iteration", async () => {
    render(<OpenHealthClimbViewer climbId="climb-1" />);

    await waitFor(() => expect(screen.getByTestId("openhealth-climb-viewer")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, { cache: "no-store" });
    expect(screen.getByTestId("openhealth-climb-title").textContent).toBe("Reached 1.00 on task 7013");

    const detail = screen.getByTestId("openhealth-climb-step-detail");
    expect(detail.getAttribute("data-kind")).toBe("benchmark");
    expect(detail.textContent).toContain("Run 2");
    expect(screen.getByTestId("openhealth-climb-step-scores").textContent).toContain("1.00");
    expect(screen.getByTestId("openhealth-climb-step-missed").textContent).toContain("None");
    expect(screen.getAllByTestId("openhealth-climb-step")[2].getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("openhealth-climb-problem-list-pill"));
    await waitFor(() => expect(screen.getByTestId("artifact-panel")).toBeTruthy());
    expect(mockArtifact).toHaveBeenCalledWith({
      endpoint: `${ENDPOINT}/artifacts/problem-list?iteration=1`,
      kind: "problem-list",
    });

    fireEvent.click(screen.getByTestId("openhealth-climb-graph-pill"));
    // The graph is a strut run surface: the climb is read by its run id, not through the climb routes.
    await waitFor(() =>
      expect(screen.getByTestId("run-graph").textContent).toBe("/api/workspaces/hive/strut/runs/climb-1/graph"),
    );
    // Opened on the selected step's own subflow: Run 2 is the loop's second iteration.
    expect(screen.getByTestId("run-graph").getAttribute("data-scope")).toBe("loop#1/run");
  });

  it("shows an improve step's Concepts when its chip is picked", async () => {
    render(<OpenHealthClimbViewer climbId="climb-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-viewer")).toBeTruthy());

    fireEvent.click(screen.getAllByTestId("openhealth-climb-step")[1]);

    const detail = screen.getByTestId("openhealth-climb-step-detail");
    expect(detail.getAttribute("data-kind")).toBe("improve");
    expect(detail.textContent).toContain("Improve after run 1");
    expect(screen.getByTestId("openhealth-climb-step-improve").textContent).toContain("Written to the graph");
    expect(screen.getByTestId("openhealth-climb-step-created").textContent).toContain("Diabetes Follow-up");
    expect(screen.getByTestId("openhealth-climb-step-amended").textContent).toContain("Hypertension");
    expect(screen.getByTestId("openhealth-climb-step-rejected").textContent).toContain("Too Broad");
    // An improve step has no run files.
    expect(screen.queryByTestId("openhealth-climb-problem-list-pill")).toBeNull();
    // The graph follows the pick, to the improve subflow.
    fireEvent.click(screen.getByTestId("openhealth-climb-graph-pill"));
    await waitFor(() => expect(screen.getByTestId("run-graph").getAttribute("data-scope")).toBe("loop#0/improve"));
  });

  it("opens with the step it is given, and shows the run that step missed", async () => {
    render(<OpenHealthClimbViewer climbId="climb-1" selected={0} />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-step-detail")).toBeTruthy());

    expect(screen.getByTestId("openhealth-climb-step-detail").textContent).toContain("Run 1");
    expect(screen.getByTestId("openhealth-climb-step-missed").textContent).toContain("E119");
    expect(screen.getByTestId("openhealth-climb-step-extra").textContent).toContain("R51");
  });

  it("leaves the selection to the caller that owns it, and follows it when it changes", async () => {
    const onSelectStep = vi.fn();
    const view = render(<OpenHealthClimbViewer climbId="climb-1" selected={null} onSelectStep={onSelectStep} />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-step-detail")).toBeTruthy());
    expect(screen.getByTestId("openhealth-climb-step-detail").textContent).toContain("Run 2");

    // A chip reports the pick; the detail waits for the caller.
    fireEvent.click(screen.getAllByTestId("openhealth-climb-step")[1]);
    expect(onSelectStep).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("openhealth-climb-step-detail").getAttribute("data-kind")).toBe("benchmark");

    view.rerender(<OpenHealthClimbViewer climbId="climb-1" selected={0} onSelectStep={onSelectStep} />);
    expect(screen.getByTestId("openhealth-climb-step-detail").textContent).toContain("Run 1");
    expect(screen.getAllByTestId("openhealth-climb-step")[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the stages of a run in flight", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...CLIMB,
          status: "running",
          stopReason: null,
          steps: [
            CLIMB.steps[0],
            CLIMB.steps[1],
            step({
              iteration: 1,
              f1: null,
              outcome: "running",
              newBest: false,
              costUsd: null,
              stages: [
                { key: "task", label: "Load chart", status: "done" },
                { key: "ingest", label: "Ingest sections", status: "running", done: 2, total: 9 },
              ],
            }),
          ],
        }),
        { status: 200 },
      ),
    );
    render(<OpenHealthClimbViewer climbId="climb-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-step-running")).toBeTruthy());
    expect(screen.getByTestId("openhealth-run-stages").textContent).toContain("Ingest sections2/9");
    expect(screen.queryByTestId("openhealth-climb-problem-list-pill")).toBeNull();
  });

  it("says when the climb cannot be read", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }));
    render(<OpenHealthClimbViewer climbId="climb-9" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-error").textContent).toBe("Not found"));
  });
});
