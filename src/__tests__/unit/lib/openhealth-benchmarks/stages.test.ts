/**
 * Unit tests for `lib/openhealth-benchmarks/stages.ts`: strut run events →
 * the stages of an `openhealth-run`.
 */

import { describe, it, expect } from "vitest";
import { projectOpenHealthStages } from "@/lib/openhealth-benchmarks/stages";

const ev = (type: string, path: string, extra: Record<string, unknown> = {}) => ({ type, path, ...extra });
const done = (step: string, extra: Record<string, unknown> = {}) => [
  ev("step.start", `openhealth-run/${step}`),
  ev("step.end", `openhealth-run/${step}`, extra),
];

const status = (events: unknown) =>
  Object.fromEntries(projectOpenHealthStages(events).map((stage) => [stage.key, stage.status]));

describe("projectOpenHealthStages", () => {
  it("has every stage pending before the first event", () => {
    expect(status(null)).toEqual({
      task: "pending",
      ingest: "pending",
      plan: "pending",
      produce: "pending",
      score: "pending",
      result: "pending",
    });
  });

  it("follows a run in flight", () => {
    const stages = projectOpenHealthStages([
      ev("run.start", "openhealth-run"),
      ...done("task", { output: { sectionCount: 37, groundTruth: ["I10"] } }),
      ev("step.start", "openhealth-run/ingest"),
      ...done("ingest#0"),
      ...done("ingest#1"),
      ev("step.start", "openhealth-run/ingest#2"),
      // Steps under an iteration, and an agent's tool calls, are not stages.
      ev("step.end", "openhealth-run/ingest#2/state"),
      ev("step.end", "openhealth-run/ingest#2/ingest/001-graph_graph_get"),
      ...done("seed_checklist"),
      ev("step.start", "openhealth-run/write_checklist"),
    ]);

    expect(stages).toEqual([
      { key: "task", label: "Load chart", status: "done" },
      { key: "ingest", label: "Ingest sections", status: "running", done: 2, total: 37 },
      { key: "plan", label: "Plan", status: "running" },
      { key: "produce", label: "Produce problem list", status: "pending" },
      { key: "score", label: "Score", status: "pending" },
      { key: "result", label: "Result", status: "pending" },
    ]);
  });

  it("counts the sections it has seen start when the chart's count is unknown", () => {
    const [, ingest] = projectOpenHealthStages([
      ev("step.start", "openhealth-run/ingest"),
      ...done("ingest#0"),
      ev("step.start", "openhealth-run/ingest#1"),
    ]);
    expect(ingest).toMatchObject({ done: 1, total: 2 });
  });

  it("marks the stage whose step failed", () => {
    expect(
      status([
        ...done("task"),
        ...done("ingest"),
        ...done("seed_checklist"),
        ...done("write_checklist"),
        ev("step.start", "openhealth-run/produce"),
        ev("step.error", "openhealth-run/produce", { error: { message: "model error" } }),
      ]),
    ).toMatchObject({ plan: "done", produce: "failed", score: "pending" });
  });

  it("reads a replayed step as done", () => {
    expect(status([ev("step.replayed", "openhealth-run/task")])).toMatchObject({ task: "done" });
  });
});
