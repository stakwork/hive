/**
 * Unit tests for `lib/openhealth-benchmarks/runs.ts`: a `StrutRun` row →
 * what the page shows, and the metrics over a list of runs — and over the
 * benchmark runs inside climbs, which count as attempts too.
 */

import { describe, it, expect } from "vitest";
import { StrutRunStatus } from "@prisma/client";
import {
  openHealthClimbSeries,
  openHealthRunTasks,
  openHealthTaskStats,
  outcomeOf,
  summarizeByDifficulty,
  summarizeOpenHealthRuns,
  toOpenHealthRun,
  toOpenHealthRunDetail,
  type OpenHealthRunSource,
} from "@/lib/openhealth-benchmarks/runs";
import type { OpenHealthClimb, OpenHealthClimbStep, OpenHealthRun } from "@/types/openhealth";

const OUTPUT = {
  task: "patient_diagnosis",
  split: "public",
  gtId: 7532,
  patientId: 2201,
  difficulty: "hard",
  title: "patient_diagnosis gt 7532 patient 2201",
  namespace: "oh-patient-diagnosis-public-7532",
  weighted_problem_list_f1_neutral: 0.82,
  problem_list_recall: 1,
  problem_list_precision_neutral: 0.7,
  tier: "A",
  n_matched: 7,
  n_gt: 7,
  n_pred: 10,
  matched: [
    { pred: "N179", gt: "N179" },
    { pred: "", gt: "I10" },
  ],
  missed: [],
  extra: ["E876", "R197", 12],
  chartChars: 41000,
  sectionCount: 37,
  sectionsIngested: 36,
  sectionsFailed: ["enc-2-labs.md"],
  encounterCount: 3,
  withheldSections: ["assessment", "plan"],
  ingested: [
    { file: "enc-0-hpi.md", ref_id: "r1", needed: true, cost: 0.07, steps: 4 },
    { file: "enc-2-labs.md", error: "timed out" },
    { needed: true },
  ],
  produceCost: 1.5,
  produceSteps: 61,
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc",
  outputDir: "/data/artifacts/1790614605308/gt-7532",
  problemList: "/artifacts/1790614605308/gt-7532/output/problem-list.json",
};

function row(overrides: Partial<OpenHealthRunSource> = {}): OpenHealthRunSource {
  return {
    id: "run-1",
    strutRunId: "1790614605308",
    status: StrutRunStatus.SUCCESS,
    input: { gtId: 7532, workdir: "gt-7532" },
    output: OUTPUT,
    error: null,
    durationMs: 1_569_998,
    createdAt: new Date("2026-09-28T16:56:45Z"),
    settledAt: new Date("2026-09-28T17:22:55Z"),
    ...overrides,
  };
}

describe("outcomeOf", () => {
  it.each([
    [StrutRunStatus.PENDING, null, "running"],
    [StrutRunStatus.CANCELLED, null, "cancelled"],
    [StrutRunStatus.ERROR, null, "failed"],
    [StrutRunStatus.LOST, null, "failed"],
    [StrutRunStatus.SUCCESS, OUTPUT, "succeeded"],
  ])("%s → %s", (status, output, outcome) => {
    expect(outcomeOf(status, output)).toBe(outcome);
  });

  it("counts an unscored success as a failure", () => {
    // Older workflow versions: success, a score of 0, and a gradeError.
    expect(
      outcomeOf(StrutRunStatus.SUCCESS, { weighted_problem_list_f1_neutral: 0, gradeError: "no problem list" }),
    ).toBe("failed");
    expect(outcomeOf(StrutRunStatus.SUCCESS, { gtId: 1 })).toBe("failed");
    expect(outcomeOf(StrutRunStatus.SUCCESS, null)).toBe("failed");
  });
});

describe("toOpenHealthRun", () => {
  it("reads a scored run", () => {
    expect(toOpenHealthRun(row())).toEqual({
      id: "run-1",
      strutRunId: "1790614605308",
      status: "SUCCESS",
      outcome: "succeeded",
      gtId: 7532,
      patientId: 2201,
      difficulty: "hard",
      scores: { f1: 0.82, recall: 1, precision: 0.7, tier: "A", nMatched: 7, nGt: 7, nPred: 10 },
      // The produce agent plus every ingested section.
      costUsd: 1.57,
      durationMs: 1_569_998,
      error: null,
      createdAt: "2026-09-28T16:56:45.000Z",
      settledAt: "2026-09-28T17:22:55.000Z",
    });
  });

  it("takes a failed run's task from its input and its difficulty from the catalogue", () => {
    const run = toOpenHealthRun(
      row({ status: StrutRunStatus.ERROR, output: null, error: "no problem list produced" }),
      (gtId) => (gtId === 7532 ? "hard" : null),
    );
    expect(run).toMatchObject({
      outcome: "failed",
      gtId: 7532,
      difficulty: "hard",
      scores: null,
      costUsd: null,
      error: "no problem list produced",
    });
  });

  it("shows the grade error of an unscored success and no score", () => {
    const run = toOpenHealthRun(
      row({ output: { ...OUTPUT, weighted_problem_list_f1_neutral: 0, gradeError: "no problem list" } }),
    );
    expect(run).toMatchObject({ outcome: "failed", scores: null, error: "no problem list" });
  });

  it("has nothing to report for a run in flight", () => {
    const run = toOpenHealthRun(
      row({ status: StrutRunStatus.PENDING, output: null, durationMs: null, settledAt: null }),
    );
    expect(run).toMatchObject({ outcome: "running", scores: null, error: null, difficulty: null, settledAt: null });
  });
});

describe("toOpenHealthRunDetail", () => {
  it("reads the diagnoses, the chart and the ingest, and drops what is malformed", () => {
    const detail = toOpenHealthRunDetail(row());
    expect(detail.matched).toEqual([{ pred: "N179", gt: "N179" }]);
    expect(detail.extra).toEqual(["E876", "R197"]);
    expect(detail.missed).toEqual([]);
    expect(detail.chart).toEqual({
      chartChars: 41000,
      sectionCount: 37,
      sectionsIngested: 36,
      sectionsFailed: ["enc-2-labs.md"],
      encounterCount: 3,
      withheldSections: ["assessment", "plan"],
    });
    expect(detail.ingested).toEqual([
      { file: "enc-0-hpi.md", needed: true, cost: 0.07, steps: 4, error: null },
      { file: "enc-2-labs.md", needed: null, cost: null, steps: null, error: "timed out" },
    ]);
    expect(detail.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/abc");
  });

  it("never carries a server path", () => {
    const text = JSON.stringify(toOpenHealthRunDetail(row()));
    expect(text).not.toContain("/data/artifacts");
    expect(text).not.toContain("problem-list.json");
  });

  it("only links a sheet over https", () => {
    expect(
      toOpenHealthRunDetail(row({ output: { ...OUTPUT, spreadsheetUrl: "javascript:alert(1)" } })).spreadsheetUrl,
    ).toBeNull();
    expect(toOpenHealthRunDetail(row({ output: { ...OUTPUT, spreadsheetUrl: "" } })).spreadsheetUrl).toBeNull();
  });

  it("has no chart for a run without output", () => {
    const detail = toOpenHealthRunDetail(row({ status: StrutRunStatus.ERROR, output: null, error: "boom" }));
    expect(detail).toMatchObject({ chart: null, matched: [], missed: [], extra: [], ingested: [] });
  });
});

function run(overrides: Partial<OpenHealthRun>): OpenHealthRun {
  return {
    id: "r",
    strutRunId: "1",
    status: "SUCCESS",
    outcome: "succeeded",
    gtId: 1,
    patientId: 1,
    difficulty: "easy",
    scores: { f1: 0.5, recall: 0.5, precision: 0.5, tier: "B", nMatched: 1, nGt: 2, nPred: 2 },
    costUsd: 1,
    durationMs: 1,
    error: null,
    createdAt: "2026-09-28T00:00:00.000Z",
    settledAt: null,
    ...overrides,
  };
}

const scored = (f1: number, overrides: Partial<OpenHealthRun> = {}) =>
  run({ scores: { f1, recall: f1, precision: f1, tier: "B", nMatched: 1, nGt: 2, nPred: 2 }, ...overrides });
const failed = (overrides: Partial<OpenHealthRun> = {}) =>
  run({ status: "ERROR", outcome: "failed", scores: null, error: "boom", ...overrides });

describe("summarizeOpenHealthRuns", () => {
  it("leaves running and cancelled runs out of the success rate", () => {
    const summary = summarizeOpenHealthRuns([
      scored(0.8),
      scored(0.4),
      failed(),
      run({ status: "PENDING", outcome: "running", scores: null }),
      run({ status: "CANCELLED", outcome: "cancelled", scores: null }),
    ]);
    expect(summary.attempts).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.successRate).toBeCloseTo(2 / 3);
    expect(summary.meanF1).toBeCloseTo(0.6);
  });

  it("has no rate and no mean without a finished run", () => {
    expect(summarizeOpenHealthRuns([])).toEqual({
      attempts: 0,
      succeeded: 0,
      successRate: null,
      meanF1: null,
      meanRecall: null,
      meanPrecision: null,
    });
  });

  it("splits by difficulty", () => {
    const byDifficulty = summarizeByDifficulty([
      scored(0.9, { difficulty: "easy" }),
      failed({ difficulty: "hard" }),
      scored(0.3, { difficulty: null }),
    ]);
    expect(byDifficulty.easy).toMatchObject({ attempts: 1, meanF1: 0.9 });
    expect(byDifficulty.medium).toMatchObject({ attempts: 0, successRate: null });
    expect(byDifficulty.hard).toMatchObject({ attempts: 1, succeeded: 0, successRate: 0 });
  });
});

describe("openHealthTaskStats", () => {
  it("counts attempts per task, with the best and the newest score", () => {
    // Newest first, as the list returns them.
    const stats = openHealthTaskStats([
      run({ gtId: 7, status: "PENDING", outcome: "running", scores: null }),
      scored(0.4, { gtId: 7 }),
      failed({ gtId: 7 }),
      scored(0.9, { gtId: 7 }),
      scored(0.2, { gtId: 8 }),
      scored(1, { gtId: null }),
    ]);
    expect(stats.get(7)).toEqual({ attempts: 3, succeeded: 2, bestF1: 0.9, latestF1: 0.4, running: true });
    expect(stats.get(8)).toEqual({ attempts: 1, succeeded: 1, bestF1: 0.2, latestF1: 0.2, running: false });
    expect(stats.size).toBe(2);
  });
});

describe("openHealthClimbSeries", () => {
  // Newest first, as the list returns them.
  const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const runs = [
    scored(0.5, { id: "d", createdAt: at(4) }),
    failed({ id: "x", createdAt: at(3) }),
    scored(0.9, { id: "c", createdAt: at(3) }),
    scored(0.4, { id: "b", createdAt: at(2) }),
    scored(0.6, { id: "a", createdAt: at(1) }),
  ];

  it("orders scored runs oldest first under a best-so-far line", () => {
    const series = openHealthClimbSeries(runs);
    expect(series.map((p) => p.runId)).toEqual(["a", "b", "c", "d"]);
    expect(series.map((p) => p.best)).toEqual([0.6, 0.6, 0.9, 0.9]);
    expect(series.map((p) => p.newBest)).toEqual([true, false, true, false]);
  });
});

describe("openHealthRunTasks", () => {
  it("lists tasks most recently run first, with their run counts", () => {
    expect(
      openHealthRunTasks([
        scored(0.4, { gtId: 8, difficulty: null }),
        failed({ gtId: 7, difficulty: "easy" }),
        scored(0.9, { gtId: 8, difficulty: "hard" }),
        scored(1, { gtId: null }),
      ]),
    ).toEqual([
      { gtId: 8, difficulty: "hard", runs: 2 },
      { gtId: 7, difficulty: "easy", runs: 1 },
    ]);
  });
});

// ─── With climbs ─────────────────────────────────────────────────────────

function climbStep(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    kind: "benchmark",
    iteration: 0,
    outcome: "succeeded",
    f1: 0.5,
    newBest: true,
    missed: [],
    extra: [],
    costUsd: 1,
    stages: null,
    applied: false,
    created: [],
    amended: [],
    rejected: [],
    summary: null,
    startedAt: null,
    error: null,
    ...overrides,
  };
}

function climb(overrides: Partial<OpenHealthClimb> = {}): OpenHealthClimb {
  return {
    id: "climb-1",
    strutRunId: "1790830428092",
    gtId: 7,
    difficulty: "medium",
    status: "reached",
    stopReason: "Run 3 scored 1.00.",
    targetF1: 1,
    maxRuns: 5,
    attempts: 3,
    startF1: 0.3,
    bestF1: 1,
    latestF1: 1,
    bestIteration: 2,
    costUsd: 3,
    steps: [
      climbStep({ iteration: 0, f1: 0.3 }),
      climbStep({ kind: "improve", iteration: 0, f1: null, newBest: false, created: ["A"], applied: true }),
      climbStep({ iteration: 1, f1: 0.7 }),
      climbStep({ kind: "improve", iteration: 1, f1: null, newBest: false, amended: ["B"], applied: true }),
      climbStep({ iteration: 2, f1: 1 }),
    ],
    durationMs: 1,
    error: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    settledAt: "2026-09-29T01:00:00.000Z",
    ...overrides,
  };
}

describe("metrics over runs and climbs", () => {
  it("counts a climb's benchmark runs as attempts, not its improve runs", () => {
    const summary = summarizeOpenHealthRuns([scored(0.5, { gtId: 7 })], [climb()]);
    expect(summary).toMatchObject({ attempts: 4, succeeded: 4 });
    expect(summary.meanF1).toBeCloseTo((0.5 + 0.3 + 0.7 + 1) / 4);
    // Only runs of their own report recall and precision.
    expect(summary.meanRecall).toBeCloseTo(0.5);
  });

  it("leaves a climb's run in flight out, and counts one that failed", () => {
    const running = climb({
      status: "running",
      steps: [climbStep({ iteration: 0, f1: 0.3 }), climbStep({ iteration: 1, f1: null, outcome: "running" })],
    });
    const broken = climb({
      id: "climb-2",
      status: "failed",
      steps: [climbStep({ iteration: 0, f1: null, outcome: "failed", error: "boom" })],
    });
    expect(summarizeOpenHealthRuns([], [running, broken])).toMatchObject({
      attempts: 2,
      succeeded: 1,
      successRate: 0.5,
    });
    expect(summarizeByDifficulty([], [running]).medium).toMatchObject({ attempts: 1, succeeded: 1 });
  });

  it("gives the Tasks tab a task's best over its climbs, and marks a climb in flight", () => {
    const stats = openHealthTaskStats(
      [scored(0.4, { gtId: 7, createdAt: "2026-09-30T00:00:00.000Z" }), scored(0.2, { gtId: 8 })],
      [climb(), climb({ id: "climb-2", gtId: 9, status: "running", steps: [], attempts: 0, bestF1: null })],
    );
    // The run of its own is newer than the climb, so it is the latest; the climb holds the best.
    expect(stats.get(7)).toEqual({ attempts: 4, succeeded: 4, bestF1: 1, latestF1: 0.4, running: false });
    expect(stats.get(8)).toMatchObject({ attempts: 1, bestF1: 0.2 });
    expect(stats.get(9)).toEqual({ attempts: 0, succeeded: 0, bestF1: null, latestF1: null, running: true });
  });

  it("draws a climb's runs on the hill climb, in order, keyed by iteration", () => {
    const series = openHealthClimbSeries(
      [scored(0.5, { id: "own", gtId: 7, createdAt: "2026-09-28T00:00:00.000Z" })],
      [climb()],
    );
    expect(series.map((p) => p.key)).toEqual(["own", "climb-1#0", "climb-1#1", "climb-1#2"]);
    expect(series.map((p) => p.best)).toEqual([0.5, 0.5, 0.7, 1]);
    expect(series.map((p) => p.newBest)).toEqual([true, false, true, true]);
    expect(series[1]).toMatchObject({ runId: null, climb: { id: "climb-1", iteration: 0 }, gtId: 7, f1: 0.3 });
    expect(series[0]).toMatchObject({ runId: "own", climb: null });
  });

  it("orders a climb's runs by when each started, when the log says", () => {
    const timed = climb({
      createdAt: "2026-09-29T00:00:00.000Z",
      steps: [
        climbStep({ iteration: 0, f1: 0.3, startedAt: "2026-09-29T00:01:00.000Z" }),
        climbStep({ iteration: 1, f1: 0.7, startedAt: "2026-09-29T00:20:00.000Z" }),
      ],
    });
    const series = openHealthClimbSeries(
      [scored(0.5, { id: "mid", gtId: 7, createdAt: "2026-09-29T00:10:00.000Z" })],
      [timed],
    );
    expect(series.map((p) => p.key)).toEqual(["climb-1#0", "mid", "climb-1#1"]);
  });

  it("lists a task that only a climb has tried, with the climb's runs counted", () => {
    expect(
      openHealthRunTasks(
        [scored(0.4, { gtId: 8, difficulty: "hard", createdAt: "2026-09-30T00:00:00.000Z" })],
        [climb(), climb({ id: "climb-2", gtId: 9, difficulty: null, status: "running", steps: [], attempts: 0 })],
      ),
    ).toEqual([
      { gtId: 8, difficulty: "hard", runs: 1 },
      { gtId: 7, difficulty: "medium", runs: 3 },
      { gtId: 9, difficulty: null, runs: 0 },
    ]);
  });
});
