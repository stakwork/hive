/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Tasks tab's link to a task's runs:
 * - a task with a run (settled or in flight) or a climb on the Runs tab has
 *   its id as a link to the Runs tab with that task in the filter;
 * - a task with nothing on the Runs tab has its id as plain text.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OpenHealthClimb, OpenHealthRun, OpenHealthTask, OpenHealthTaskList } from "@/types/openhealth";

globalThis.React = React;

const mockUseRuns = vi.hoisted(() => vi.fn());
const mockUseClimbs = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/w/hive/openhealth/benchmarks",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("@/hooks/useOpenHealthRuns", () => ({ useOpenHealthRuns: mockUseRuns }));
vi.mock("@/hooks/useOpenHealthClimbs", () => ({ useOpenHealthClimbs: mockUseClimbs }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/openhealth/ClimbStartPopover", () => ({
  ClimbStartPopover: () => <button data-testid="openhealth-climb-open">Climb</button>,
}));

const { OpenHealthTasksPanel } = await import("@/components/openhealth/OpenHealthTasksPanel");

function task(gtId: number): OpenHealthTask {
  return { gtId, patientId: gtId * 10, difficulty: "medium", split: "public", age: 40, sex: "F", numEncounters: 3 };
}

function run(gtId: number, outcome: OpenHealthRun["outcome"]): OpenHealthRun {
  const scored = outcome === "succeeded";
  return {
    id: `run-${gtId}-${outcome}`,
    strutRunId: "1",
    status: scored ? "SUCCESS" : "PENDING",
    outcome,
    gtId,
    patientId: gtId * 10,
    difficulty: "medium",
    scores: scored
      ? { f1: 0.5, official: null, contested: 0, recall: 0.5, precision: 0.5, tier: "B", nMatched: 1, nGt: 2, nPred: 2 }
      : null,
    costUsd: scored ? 1 : null,
    durationMs: scored ? 1 : null,
    error: null,
    createdAt: "2026-09-28T00:00:00.000Z",
    settledAt: scored ? "2026-09-28T00:01:00.000Z" : null,
  };
}

/** A climb that has not started its first run. */
function climb(gtId: number): OpenHealthClimb {
  return {
    id: `climb-${gtId}`,
    strutRunId: "2",
    gtId,
    difficulty: "medium",
    status: "running",
    stopReason: null,
    targetF1: 1,
    maxRuns: 5,
    attempts: 0,
    startF1: null,
    bestF1: null,
    bestF1Official: null,
    contested: [],
    bestRecall: null,
    bestPrecision: null,
    latestF1: null,
    bestIteration: null,
    costUsd: null,
    steps: [],
    durationMs: null,
    error: null,
    createdAt: "2026-09-28T00:00:00.000Z",
    settledAt: null,
  };
}

const TASKS: OpenHealthTaskList = {
  split: "public",
  total: 4,
  byDifficulty: { easy: 0, medium: 4, hard: 0 },
  tasks: [task(7039), task(7040), task(7041), task(7042)],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(TASKS), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  mockUseRuns.mockReturnValue({
    runs: [run(7039, "succeeded"), run(7041, "running")],
    loading: false,
    error: null,
    reload: vi.fn(),
  });
  mockUseClimbs.mockReturnValue({ climbs: [climb(7042)], loading: false, error: null, reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The row of a task, once the list has loaded. */
async function row(gtId: number) {
  const rows = await screen.findAllByTestId("openhealth-task-row");
  const match = rows.find((r) => within(r).queryByText(String(gtId)) !== null);
  if (!match) throw new Error(`no row for task ${gtId}`);
  return within(match);
}

describe("OpenHealthTasksPanel task links", () => {
  it("links a task with a scored run to the Runs tab with the task in the filter", async () => {
    render(<OpenHealthTasksPanel />);

    const link = (await row(7039)).getByTestId("openhealth-task-link");
    expect(link).toHaveTextContent("7039");
    expect(link).toHaveAttribute("href", "/w/hive/openhealth/benchmarks?tab=runs&task=7039");
  });

  it("shows a task with nothing on the Runs tab as plain text", async () => {
    render(<OpenHealthTasksPanel />);

    const r = await row(7040);
    expect(r.getByText("7040")).toBeInTheDocument();
    expect(r.queryByTestId("openhealth-task-link")).not.toBeInTheDocument();
  });

  it("links a task whose only run is in flight", async () => {
    render(<OpenHealthTasksPanel />);

    expect((await row(7041)).getByTestId("openhealth-task-link")).toHaveAttribute(
      "href",
      "/w/hive/openhealth/benchmarks?tab=runs&task=7041",
    );
  });

  it("links a task whose climb has not run yet", async () => {
    render(<OpenHealthTasksPanel />);

    expect((await row(7042)).getByTestId("openhealth-task-link")).toHaveAttribute(
      "href",
      "/w/hive/openhealth/benchmarks?tab=runs&task=7042",
    );
  });
});
