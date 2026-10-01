/**
 * Unit tests for `lib/openhealth-benchmarks/climb.ts`: a climb row and its
 * step rows → what the page shows, and the decision after a step settles.
 */

import { describe, it, expect } from "vitest";
import { OpenHealthClimbStatus, StrutRunStatus } from "@prisma/client";
import {
  decideClimbStep,
  improveWrites,
  isAtTarget,
  isClimbAttempts,
  isClimbTarget,
  toOpenHealthClimb,
  type OpenHealthClimbSource,
  type OpenHealthClimbStepRow,
} from "@/lib/openhealth-benchmarks/climb";
import { toOpenHealthImprovement } from "@/lib/openhealth-benchmarks/improve";

const T0 = new Date("2026-09-30T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function benchmark(
  id: string,
  minutes: number,
  overrides: Partial<OpenHealthClimbStepRow> = {},
): OpenHealthClimbStepRow {
  return {
    id,
    kind: "openhealth_benchmark",
    strutRunId: `strut-${id}`,
    status: StrutRunStatus.SUCCESS,
    input: { gtId: 7532 },
    output: { weighted_problem_list_f1_neutral: 0.7, produceCost: 1.5 },
    error: null,
    durationMs: 60_000,
    createdAt: at(minutes),
    settledAt: at(minutes + 1),
    ...overrides,
  };
}

function improve(id: string, minutes: number, overrides: Partial<OpenHealthClimbStepRow> = {}): OpenHealthClimbStepRow {
  return {
    id,
    kind: "openhealth_improve",
    strutRunId: `strut-${id}`,
    status: StrutRunStatus.SUCCESS,
    input: { runIds: "strut-run-1", apply: true },
    output: {
      applied: true,
      proposals: [
        { action: "create", name: "A", parent: "Medicine" },
        { action: "create", name: "B", parent: "Medicine" },
        { action: "amend", name: "C" },
      ],
      created: [{ status: "Success" }, { status: "Warning" }],
    },
    error: null,
    durationMs: 30_000,
    createdAt: at(minutes),
    settledAt: at(minutes + 1),
    ...overrides,
  };
}

function climb(overrides: Partial<OpenHealthClimbSource> = {}): OpenHealthClimbSource {
  return {
    id: "climb-1",
    gtId: 7532,
    status: OpenHealthClimbStatus.RUNNING,
    stopReason: null,
    targetF1: 1,
    maxAttempts: 5,
    attempts: 2,
    startF1: null,
    bestF1: null,
    seedRunId: null,
    currentRunId: null,
    createdAt: T0,
    settledAt: null,
    ...overrides,
  };
}

describe("validation", () => {
  it("accepts a target in (0, 1] and attempts in 1..10", () => {
    expect(isClimbTarget(1)).toBe(true);
    expect(isClimbTarget(0.5)).toBe(true);
    expect(isClimbTarget(0)).toBe(false);
    expect(isClimbTarget(1.01)).toBe(false);
    expect(isClimbTarget("1")).toBe(false);
    expect(isClimbAttempts(1)).toBe(true);
    expect(isClimbAttempts(10)).toBe(true);
    expect(isClimbAttempts(11)).toBe(false);
    expect(isClimbAttempts(2.5)).toBe(false);
  });

  it("counts a score a hair under the target as at it", () => {
    expect(isAtTarget(1, 1)).toBe(true);
    expect(isAtTarget(0.9999999999, 1)).toBe(true);
    expect(isAtTarget(0.99, 1)).toBe(false);
  });
});

describe("improveWrites", () => {
  it("counts Concepts the graph created and amendments, not edges that already existed", () => {
    expect(improveWrites(toOpenHealthImprovement(improve("i", 0)))).toEqual({ created: 1, amended: 1 });
  });

  it("is nothing when the run did not apply", () => {
    const row = improve("i", 0, { output: { applied: false, proposals: [{ action: "create", name: "A" }] } });
    expect(improveWrites(toOpenHealthImprovement(row))).toEqual({ created: 0, amended: 0 });
  });
});

describe("toOpenHealthClimb", () => {
  it("orders the steps, numbers the attempts, and tracks the best", () => {
    const rows = [
      improve("imp-1", 2),
      benchmark("run-2", 3, { output: { weighted_problem_list_f1_neutral: 0.82, produceCost: 2 } }),
      benchmark("run-1", 0),
      improve("imp-2", 4, { status: StrutRunStatus.PENDING, output: null, settledAt: null }),
    ];
    const shown = toOpenHealthClimb(climb({ bestF1: 0.82, startF1: 0.7, currentRunId: "imp-2" }), rows);

    expect(shown.steps.map((s) => [s.kind, s.attempt, s.runId])).toEqual([
      ["benchmark", 1, "run-1"],
      ["improve", 1, "imp-1"],
      ["benchmark", 2, "run-2"],
      ["improve", 2, "imp-2"],
    ]);
    expect(shown.steps[0]).toMatchObject({ f1: 0.7, newBest: true, outcome: "succeeded" });
    expect(shown.steps[1]).toMatchObject({ created: 1, amended: 1, f1: null });
    expect(shown.steps[2]).toMatchObject({ f1: 0.82, newBest: true });
    expect(shown.steps[3]).toMatchObject({ outcome: "running", created: null });
    expect(shown).toMatchObject({
      status: "running",
      attempts: 2,
      startF1: 0.7,
      bestF1: 0.82,
      latestF1: 0.82,
      bestRunId: "run-2",
      currentRunId: "imp-2",
      costUsd: 3.5,
    });
  });

  it("puts the seed first whatever its date, and marks a dip as below best", () => {
    const seed = benchmark("seed", 10, { output: { weighted_problem_list_f1_neutral: 0.8 } });
    const rows = [
      benchmark("run-2", 30, { output: { weighted_problem_list_f1_neutral: 0.75 } }),
      improve("imp-1", 20),
      seed,
    ];
    const shown = toOpenHealthClimb(climb({ seedRunId: "seed", attempts: 2 }), rows);

    expect(shown.steps.map((s) => s.runId)).toEqual(["seed", "imp-1", "run-2"]);
    expect(shown.steps[2]).toMatchObject({ attempt: 2, newBest: false });
    expect(shown.bestRunId).toBe("seed");
    expect(shown.latestF1).toBe(0.75);
  });

  it("skips rows of another kind and lower-cases the status", () => {
    const shown = toOpenHealthClimb(
      climb({ status: OpenHealthClimbStatus.REACHED, stopReason: "Attempt 2 scored 1.00.", settledAt: at(9) }),
      [benchmark("run-1", 0, { kind: "code_change_propose" })],
    );
    expect(shown.steps).toEqual([]);
    expect(shown).toMatchObject({
      status: "reached",
      stopReason: "Attempt 2 scored 1.00.",
      settledAt: at(9).toISOString(),
    });
  });
});

describe("decideClimbStep", () => {
  const rules = { targetF1: 1, maxAttempts: 3, attempts: 2 };

  it("improves over a scored run below the target", () => {
    expect(decideClimbStep(rules, benchmark("run-2", 0))).toEqual({ next: "improve", f1: 0.7 });
  });

  it("ends as REACHED at the target", () => {
    const row = benchmark("run-2", 0, { output: { weighted_problem_list_f1_neutral: 1 } });
    expect(decideClimbStep(rules, row)).toMatchObject({ next: "end", status: "REACHED", f1: 1 });
  });

  it("ends as EXHAUSTED when the attempts are spent", () => {
    expect(decideClimbStep({ ...rules, attempts: 3 }, benchmark("run-3", 0))).toMatchObject({
      next: "end",
      status: "EXHAUSTED",
      f1: 0.7,
      reason: "All 3 attempts used; attempt 3 scored 0.70.",
    });
  });

  it("ends as FAILED on a failed or lost run, STOPPED on a cancelled one", () => {
    expect(
      decideClimbStep(rules, benchmark("r", 0, { status: StrutRunStatus.ERROR, output: null, error: "no list" })),
    ).toMatchObject({
      next: "end",
      status: "FAILED",
      reason: "Attempt 2 failed: no list",
    });
    expect(
      decideClimbStep(rules, benchmark("r", 0, { status: StrutRunStatus.LOST, output: null, error: "gone" })),
    ).toMatchObject({
      status: "FAILED",
    });
    expect(decideClimbStep(rules, benchmark("r", 0, { status: StrutRunStatus.CANCELLED, output: null }))).toMatchObject(
      {
        next: "end",
        status: "STOPPED",
        reason: "Attempt 2 was cancelled.",
      },
    );
  });

  it("treats a SUCCESS row without a score as failed", () => {
    const row = benchmark("r", 0, { output: { gradeError: "scorer down" } });
    expect(decideClimbStep(rules, row)).toMatchObject({ status: "FAILED", reason: "Attempt 2 failed: scorer down" });
  });

  it("waits on a row that is still pending", () => {
    expect(decideClimbStep(rules, benchmark("r", 0, { status: StrutRunStatus.PENDING, output: null }))).toEqual({
      next: "wait",
    });
    expect(decideClimbStep(rules, improve("i", 0, { status: StrutRunStatus.PENDING, output: null }))).toEqual({
      next: "wait",
    });
  });

  it("runs the next attempt after an improve run that wrote", () => {
    expect(decideClimbStep(rules, improve("i", 0))).toEqual({ next: "benchmark" });
  });

  it("ends as STALLED after an improve run that wrote nothing", () => {
    const nothing = improve("i", 0, { output: { applied: true, proposals: [], created: [] } });
    expect(decideClimbStep(rules, nothing)).toMatchObject({
      next: "end",
      status: "STALLED",
      reason: "The improve run after attempt 2 wrote nothing to the graph.",
    });
    const existed = improve("i", 0, {
      output: { applied: true, proposals: [{ action: "create", name: "A" }], created: [{ status: "Warning" }] },
    });
    expect(decideClimbStep(rules, existed)).toMatchObject({ status: "STALLED" });
    const notApplied = improve("i", 0, { output: { applied: false, proposals: [{ action: "create", name: "A" }] } });
    expect(decideClimbStep(rules, notApplied)).toMatchObject({
      status: "STALLED",
      reason: "The improve run after attempt 2 did not apply its proposals.",
    });
  });

  it("does not launch an attempt past the budget after an improve run", () => {
    expect(decideClimbStep({ ...rules, attempts: 3 }, improve("i", 0))).toMatchObject({
      next: "end",
      status: "EXHAUSTED",
    });
  });

  it("ends on a failed or cancelled improve run", () => {
    expect(
      decideClimbStep(rules, improve("i", 0, { status: StrutRunStatus.ERROR, output: null, error: "boom" })),
    ).toMatchObject({
      status: "FAILED",
      reason: "The improve run after attempt 2 failed: boom",
    });
    expect(decideClimbStep(rules, improve("i", 0, { status: StrutRunStatus.CANCELLED, output: null }))).toMatchObject({
      status: "STOPPED",
    });
  });

  it("fails a step of another kind", () => {
    expect(decideClimbStep(rules, benchmark("r", 0, { kind: "job_turn" }))).toMatchObject({
      next: "end",
      status: "FAILED",
    });
  });
});
