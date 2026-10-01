/**
 * Unit tests for `lib/openhealth-benchmarks/climb.ts`: the loop's event log
 * → its iterations, and a climb's `StrutRun` row (plus what the log knows)
 * → what the page shows.
 */

import { describe, it, expect } from "vitest";
import { StrutRunStatus } from "@prisma/client";
import {
  isAtTarget,
  isClimbIteration,
  isClimbRuns,
  isClimbTarget,
  projectOpenHealthClimbEvents,
  toOpenHealthClimb,
  type OpenHealthClimbEvents,
  type OpenHealthClimbSource,
} from "@/lib/openhealth-benchmarks/climb";

const ROOT = "openhealth-improve-loop";
const ev = (type: string, path: string, extra: Record<string, unknown> = {}) => ({ type, path, ...extra });

/** The benchmark subflow's output, as `loop#N/run` ends with it. */
const runOutput = (f1: number, extra: Record<string, unknown> = {}) => ({
  gtId: 7013,
  difficulty: "medium",
  weighted_problem_list_f1_neutral: f1,
  matched: [{ pred: "I10", gt: "I10" }],
  missed: ["E119"],
  extra: ["R51"],
  produceCost: 0.5,
  ingested: [
    { file: "a.md", cost: 0.25 },
    { file: "b.md", cost: 0.25 },
  ],
  problemList: "/artifacts/1790830428092/iter-0/output/problem-list.json",
  groundTruth: ["I10", "E119"],
  ...extra,
});

/** A history entry, as the loop's `record` step writes it. */
const entry = (iteration: number, score: number, improved: boolean, extra: Record<string, unknown> = {}) => ({
  iteration,
  score,
  missed: improved ? ["E119"] : [],
  extra: improved ? ["R51"] : [],
  problemList: `/artifacts/1790830428092/iter-${iteration}/output/problem-list.json`,
  improved,
  applied: improved,
  amends: improved ? ["Hypertension"] : [],
  creates: improved ? ["Diabetes Follow-up", "Headache Red Flags"] : [],
  rejected: improved ? ["Too Broad"] : [],
  summary: improved ? "Two Concepts and an amend." : "",
  report: improved ? `/artifacts/1790830428092/improve-${iteration}/report.md` : null,
  analysis: improved ? `/artifacts/1790830428092/improve-${iteration}/analysis.md` : null,
  backup: improved ? `/artifacts/1790830428092/improve-${iteration}/backup.json` : null,
  ...extra,
});

/** One recorded iteration's events: the run, the improve (or its skip), the record. */
function iteration(n: number, f1: number, improved: boolean, history: unknown[]) {
  const at = `${ROOT}/loop#${n}`;
  return [
    ev("step.start", at, { ts: `2026-10-01T0${n}:00:00.000Z`, iteration: n }),
    ev("step.start", `${at}/run`),
    ev("step.start", `${at}/run/task`),
    ev("step.end", `${at}/run/task`, { output: { sectionCount: 4, groundTruth: ["I10"] } }),
    ev("step.end", `${at}/run`, { output: runOutput(f1) }),
    ev(improved ? "step.start" : "step.skipped", `${at}/improve`),
    ...(improved ? [ev("step.end", `${at}/improve`, { output: { applied: true } })] : []),
    ev("step.end", at, { output: { iteration: n, score: f1, history } }),
  ];
}

const T0 = new Date("2026-10-01T00:00:00Z");

function row(overrides: Partial<OpenHealthClimbSource> = {}): OpenHealthClimbSource {
  return {
    id: "climb-1",
    strutRunId: "1790830428092",
    status: StrutRunStatus.SUCCESS,
    input: { gtId: 7013, target: 1, maxRuns: 3 },
    output: null,
    error: null,
    durationMs: 1_800_000,
    createdAt: T0,
    settledAt: new Date(T0.getTime() + 1_800_000),
    ...overrides,
  };
}

describe("the rules", () => {
  it("accepts a target in (0, 1] and a run count in [1, 10]", () => {
    expect(isClimbTarget(1)).toBe(true);
    expect(isClimbTarget(0.05)).toBe(true);
    expect(isClimbTarget(0)).toBe(false);
    expect(isClimbTarget(1.2)).toBe(false);
    expect(isClimbTarget("1")).toBe(false);
    expect(isClimbRuns(1)).toBe(true);
    expect(isClimbRuns(10)).toBe(true);
    expect(isClimbRuns(11)).toBe(false);
    expect(isClimbRuns(2.5)).toBe(false);
    expect(isClimbIteration(0)).toBe(true);
    expect(isClimbIteration(49)).toBe(true);
    expect(isClimbIteration(50)).toBe(false);
    expect(isClimbIteration(-1)).toBe(false);
  });

  it("counts a hair under the target as reached", () => {
    expect(isAtTarget(0.9999999999, 1)).toBe(true);
    expect(isAtTarget(0.99, 1)).toBe(false);
  });
});

describe("projectOpenHealthClimbEvents", () => {
  it("has nothing before the first iteration", () => {
    expect(projectOpenHealthClimbEvents(null)).toEqual({ history: [], iterations: [] });
    expect(projectOpenHealthClimbEvents([ev("run.start", ROOT), ev("step.start", `${ROOT}/loop`)])).toEqual({
      history: [],
      iterations: [],
    });
  });

  it("follows a loop in flight: the recorded iterations, then the one running with its stages", () => {
    const h0 = [entry(0, 0.6, true)];
    const at1 = `${ROOT}/loop#1`;
    const { history, iterations } = projectOpenHealthClimbEvents([
      ev("run.start", ROOT),
      ev("step.start", `${ROOT}/loop`),
      ...iteration(0, 0.6, true, h0),
      ev("step.start", at1, { ts: "2026-10-01T01:00:00.000Z", iteration: 1 }),
      ev("step.start", `${at1}/run`),
      ev("step.start", `${at1}/run/task`),
      ev("step.end", `${at1}/run/task`, { output: { sectionCount: 3 } }),
      ev("step.start", `${at1}/run/ingest`),
      ev("step.start", `${at1}/run/ingest#0`),
      ev("step.end", `${at1}/run/ingest#0`),
      ev("step.start", `${at1}/run/ingest#1`),
    ]);

    expect(history).toEqual(h0);
    expect(iterations).toHaveLength(2);
    expect(iterations[0]).toMatchObject({
      iteration: 0,
      startedAt: "2026-10-01T00:00:00.000Z",
      run: "done",
      improve: "done",
      f1: 0.6,
      missed: ["E119"],
      extra: ["R51"],
      costUsd: 1,
      stages: null,
      recorded: true,
    });
    expect(iterations[1]).toMatchObject({
      iteration: 1,
      startedAt: "2026-10-01T01:00:00.000Z",
      run: "running",
      improve: "pending",
      f1: null,
      costUsd: null,
      recorded: false,
    });
    expect(iterations[1].stages?.map((s) => [s.key, s.status])).toEqual([
      ["task", "done"],
      ["ingest", "running"],
      ["plan", "pending"],
      ["produce", "pending"],
      ["score", "pending"],
      ["result", "pending"],
    ]);
    expect(iterations[1].stages?.[1]).toMatchObject({ done: 1, total: 3 });
  });

  it("reads a skipped improve, a failed run, and the newest history", () => {
    const h0 = [entry(0, 0.6, true)];
    const h1 = [...h0, entry(1, 0.7, false)];
    const at2 = `${ROOT}/loop#2`;
    const { history, iterations } = projectOpenHealthClimbEvents([
      ...iteration(0, 0.6, true, h0),
      ...iteration(1, 0.7, false, h1),
      ev("step.start", at2, { ts: "2026-10-01T02:00:00.000Z" }),
      ev("step.start", `${at2}/run`),
      ev("step.error", `${at2}/run`, { error: { message: "no problem list produced" } }),
    ]);

    expect(history).toEqual(h1);
    expect(iterations.map((it) => [it.iteration, it.run, it.improve])).toEqual([
      [0, "done", "done"],
      [1, "done", "skipped"],
      [2, "failed", "pending"],
    ]);
  });
});

describe("toOpenHealthClimb", () => {
  const difficultyFor = (gtId: number) => (gtId === 7013 ? ("medium" as const) : null);

  it("reads a climb that reached its target from the loop's output", () => {
    const climb = toOpenHealthClimb(
      row({
        output: {
          gtId: 7013,
          stopReason: "target_reached",
          runs: 2,
          firstScore: 0.6,
          finalScore: 1,
          bestScore: 1,
          history: [entry(0, 0.6, true), entry(1, 1, false)],
        },
      }),
      difficultyFor,
    );

    expect(climb).toMatchObject({
      id: "climb-1",
      strutRunId: "1790830428092",
      gtId: 7013,
      difficulty: "medium",
      status: "reached",
      stopReason: "Run 2 scored 1.00.",
      targetF1: 1,
      maxRuns: 3,
      attempts: 2,
      startF1: 0.6,
      bestF1: 1,
      latestF1: 1,
      bestIteration: 1,
      costUsd: null,
      durationMs: 1_800_000,
      error: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      settledAt: "2026-10-01T00:30:00.000Z",
    });
    expect(climb.steps.map((s) => [s.kind, s.iteration, s.outcome, s.f1, s.newBest])).toEqual([
      ["benchmark", 0, "succeeded", 0.6, true],
      ["improve", 0, "succeeded", null, false],
      ["benchmark", 1, "succeeded", 1, true],
    ]);
    expect(climb.steps[0]).toMatchObject({ missed: ["E119"], extra: ["R51"], costUsd: null, startedAt: null });
    expect(climb.steps[1]).toMatchObject({
      applied: true,
      created: ["Diabetes Follow-up", "Headache Red Flags"],
      amended: ["Hypertension"],
      rejected: ["Too Broad"],
      summary: "Two Concepts and an amend.",
    });
    // The improve files and the problem list are paths on the lab: not carried.
    expect(JSON.stringify(climb)).not.toContain("/artifacts/");
  });

  it("reads a climb that spent its runs, with a dip below the best", () => {
    const climb = toOpenHealthClimb(
      row({
        output: { stopReason: "max_runs", history: [entry(0, 0.6, true), entry(1, 0.8, true), entry(2, 0.7, false)] },
      }),
    );
    expect(climb).toMatchObject({
      status: "exhausted",
      stopReason: "All 3 runs used; the best scored 0.80.",
      attempts: 3,
      startF1: 0.6,
      bestF1: 0.8,
      latestF1: 0.7,
      bestIteration: 1,
      difficulty: null,
    });
    expect(climb.steps.filter((s) => s.kind === "benchmark").map((s) => s.newBest)).toEqual([true, true, false]);
  });

  it("takes the rules the workflow assumed when the launch named none", () => {
    const climb = toOpenHealthClimb(row({ input: { gtId: 7013 }, output: { history: [entry(0, 1, false)] } }));
    expect(climb).toMatchObject({ targetF1: 1, maxRuns: 3, status: "reached" });
  });

  it("calls a success without a history a failure", () => {
    expect(toOpenHealthClimb(row({ output: { stopReason: "target_reached" } }))).toMatchObject({
      status: "failed",
      stopReason: "The loop finished without recording a run.",
      error: "The loop finished without recording a run.",
      steps: [],
    });
  });

  it("shows a climb in flight from its event log: the iterations so far and the run running", () => {
    const events: OpenHealthClimbEvents = projectOpenHealthClimbEvents([
      ...iteration(0, 0.6, true, [entry(0, 0.6, true)]),
      ev("step.start", `${ROOT}/loop#1`, { ts: "2026-10-01T01:00:00.000Z" }),
      ev("step.start", `${ROOT}/loop#1/run`),
      ev("step.start", `${ROOT}/loop#1/run/task`),
    ]);
    const climb = toOpenHealthClimb(
      row({ status: StrutRunStatus.PENDING, output: null, settledAt: null }),
      undefined,
      events,
    );

    expect(climb).toMatchObject({
      status: "running",
      stopReason: null,
      attempts: 2,
      startF1: 0.6,
      bestF1: 0.6,
      latestF1: 0.6,
      costUsd: 1,
      error: null,
      settledAt: null,
    });
    expect(climb.steps.map((s) => [s.kind, s.iteration, s.outcome])).toEqual([
      ["benchmark", 0, "succeeded"],
      ["improve", 0, "succeeded"],
      ["benchmark", 1, "running"],
    ]);
    // What the log knows and the output does not: the run's cost and start.
    expect(climb.steps[0]).toMatchObject({ costUsd: 1, startedAt: "2026-10-01T00:00:00.000Z" });
    expect(climb.steps[2]).toMatchObject({ f1: null, startedAt: "2026-10-01T01:00:00.000Z" });
    expect(climb.steps[2].stages?.[0]).toMatchObject({ key: "task", status: "running" });
  });

  it("shows the improve run in flight after a scored run", () => {
    const events = projectOpenHealthClimbEvents([
      ev("step.start", `${ROOT}/loop#0`, { ts: "2026-10-01T00:00:00.000Z" }),
      ev("step.start", `${ROOT}/loop#0/run`),
      ev("step.end", `${ROOT}/loop#0/run`, { output: runOutput(0.5) }),
      ev("step.start", `${ROOT}/loop#0/improve`),
    ]);
    const climb = toOpenHealthClimb(row({ status: StrutRunStatus.PENDING }), undefined, events);
    expect(climb.steps.map((s) => [s.kind, s.outcome, s.f1])).toEqual([
      ["benchmark", "succeeded", 0.5],
      ["improve", "running", null],
    ]);
    expect(climb.steps[0].stages).toBeNull();
  });

  it("shows a failed loop's iterations from its log, the one that failed in red", () => {
    const events = projectOpenHealthClimbEvents([
      ...iteration(0, 0.6, true, [entry(0, 0.6, true)]),
      ev("step.start", `${ROOT}/loop#1`, { ts: "2026-10-01T01:00:00.000Z" }),
      ev("step.start", `${ROOT}/loop#1/run`),
      ev("step.error", `${ROOT}/loop#1/run`, { error: { message: "boom" } }),
    ]);
    const climb = toOpenHealthClimb(
      row({
        status: StrutRunStatus.ERROR,
        output: null,
        error: "iteration 1: openhealth-run returned no numeric score",
      }),
      undefined,
      events,
    );
    expect(climb).toMatchObject({
      status: "failed",
      stopReason: "iteration 1: openhealth-run returned no numeric score",
      error: "iteration 1: openhealth-run returned no numeric score",
      attempts: 2,
      bestF1: 0.6,
    });
    expect(climb.steps[2]).toMatchObject({
      kind: "benchmark",
      outcome: "failed",
      error: "iteration 1: openhealth-run returned no numeric score",
    });
  });

  it("shows a stopped climb's run in flight as cancelled", () => {
    const events = projectOpenHealthClimbEvents([
      ev("step.start", `${ROOT}/loop#0`),
      ev("step.start", `${ROOT}/loop#0/run`),
    ]);
    const climb = toOpenHealthClimb(row({ status: StrutRunStatus.CANCELLED, output: null }), undefined, events);
    expect(climb).toMatchObject({ status: "stopped", stopReason: "Stopped by a member.", attempts: 1 });
    expect(climb.steps[0]).toMatchObject({ outcome: "cancelled", error: null });
  });

  it("adds the log's cost and timing to a settled climb's recorded runs", () => {
    const history = [entry(0, 0.6, true), entry(1, 1, false)];
    const events = projectOpenHealthClimbEvents([
      ...iteration(0, 0.6, true, history.slice(0, 1)),
      ...iteration(1, 1, false, history),
    ]);
    const climb = toOpenHealthClimb(row({ output: { stopReason: "target_reached", history } }), undefined, events);
    expect(climb.costUsd).toBe(2);
    expect(climb.steps.filter((s) => s.kind === "benchmark").map((s) => s.startedAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T01:00:00.000Z",
    ]);
  });

  it("has no task for a row launched without one", () => {
    expect(toOpenHealthClimb(row({ input: {}, output: { history: [] } }), difficultyFor)).toMatchObject({
      gtId: null,
      difficulty: null,
    });
  });
});
