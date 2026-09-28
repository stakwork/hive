import { describe, test, expect } from "vitest";
import {
  normalizeGtId,
  deriveOutcome,
  runCost,
  runDuration,
  summarizeRuns,
  taskStats,
  stageFromSteps,
  stageFromPath,
  projectRunSummary,
  projectTaskRow,
} from "@/lib/openhealth-benchmarks/run-summary";

describe("normalizeGtId", () => {
  test("reads input.gtId when present", () => {
    expect(normalizeGtId({ input: { gtId: "gt-1" } })).toBe("gt-1");
  });

  test("falls back to output.gtId for legacy input: {} runs", () => {
    expect(normalizeGtId({ input: {}, output: { gtId: "gt-2" } })).toBe("gt-2");
  });

  test("normalizes a numeric gtId to a string", () => {
    expect(normalizeGtId({ input: { gtId: 7013 } })).toBe("7013");
  });

  test("normalizes a string gtId unchanged", () => {
    expect(normalizeGtId({ input: { gtId: "7013" } })).toBe("7013");
  });

  test("numeric and string gtId normalize to the SAME key", () => {
    expect(normalizeGtId({ input: { gtId: 7013 } })).toBe(normalizeGtId({ input: { gtId: "7013" } }));
  });

  test("returns null when neither input nor output carries gtId", () => {
    expect(normalizeGtId({})).toBeNull();
    expect(normalizeGtId({ input: {}, output: {} })).toBeNull();
  });
});

describe("deriveOutcome", () => {
  test("terminal error/stale status is failed", () => {
    expect(deriveOutcome({ status: "error" })).toBe("failed");
    expect(deriveOutcome({ status: "stale" })).toBe("failed");
  });

  test("a success status with gradeError is still failed", () => {
    expect(deriveOutcome({ status: "success", output: { gradeError: "bad grade" } })).toBe("failed");
  });

  test("a success status with legacy produceError is failed", () => {
    expect(deriveOutcome({ status: "success", output: { produceError: "boom" } })).toBe("failed");
  });

  test("cancelled status is cancelled", () => {
    expect(deriveOutcome({ status: "cancelled" })).toBe("cancelled");
  });

  test("live statuses and missing status are running", () => {
    for (const status of ["running", "pausing", "paused", "cancelling", undefined]) {
      expect(deriveOutcome({ status })).toBe("running");
    }
  });

  test("a bare success status is success", () => {
    expect(deriveOutcome({ status: "success" })).toBe("success");
  });
});

describe("runCost", () => {
  test("sums produceCost and every ingested[].cost", () => {
    const cost = runCost({
      output: { produceCost: 1.5, ingested: [{ cost: 0.25 }, { cost: 0.75 }] },
    });
    expect(cost).toBeCloseTo(2.5);
  });

  test("missing fields count as 0", () => {
    expect(runCost({})).toBe(0);
    expect(runCost({ output: {} })).toBe(0);
  });
});

describe("runDuration", () => {
  test("computes finishedAt - startedAt in ms", () => {
    const ms = runDuration({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:10.000Z" });
    expect(ms).toBe(10_000);
  });

  test("returns null when either timestamp is missing or unparseable", () => {
    expect(runDuration({ startedAt: null, finishedAt: "2026-01-01T00:00:10.000Z" })).toBeNull();
    expect(runDuration({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null })).toBeNull();
    expect(runDuration({ startedAt: "not-a-date", finishedAt: "2026-01-01T00:00:10.000Z" })).toBeNull();
  });
});

describe("summarizeRuns", () => {
  test("success rate = succeeded / (succeeded + failed); running/cancelled excluded", () => {
    const runs = [
      { status: "success", output: { weighted_problem_list_f1_neutral: 0.8 } },
      { status: "error" },
      { status: "cancelled" },
      { status: "running" },
    ];
    const summary = summarizeRuns(runs);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.running).toBe(1);
    expect(summary.successRate).toBeCloseTo(0.5);
  });

  test("gradeError on an otherwise-success run counts toward failed, not succeeded", () => {
    const runs = [
      { status: "success", output: { gradeError: "bad" } },
      { status: "success", output: { weighted_problem_list_f1_neutral: 1 } },
    ];
    const summary = summarizeRuns(runs);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.successRate).toBeCloseTo(0.5);
  });

  test("mean F1 is computed over successful runs only, with a legacy fallback field", () => {
    const runs = [
      { status: "success", output: { weighted_problem_list_f1_neutral: 0.6 } },
      { status: "success", output: { f1: 0.4 } }, // legacy field name
      { status: "error", output: { weighted_problem_list_f1_neutral: 1.0 } }, // must not count
    ];
    const summary = summarizeRuns(runs);
    expect(summary.meanF1).toBeCloseTo(0.5);
  });

  test("successRate and meanF1 are null with no denominator / no successes", () => {
    const summary = summarizeRuns([{ status: "running" }, { status: "cancelled" }]);
    expect(summary.successRate).toBeNull();
    expect(summary.meanF1).toBeNull();
  });
});

describe("taskStats", () => {
  test("attempts count every run for a normalized gtId; bestF1 only from successes", () => {
    const runs = [
      { input: { gtId: "gt-1" }, status: "success", output: { weighted_problem_list_f1_neutral: 0.5 } },
      { input: { gtId: "gt-1" }, status: "success", output: { weighted_problem_list_f1_neutral: 0.8 } },
      { input: { gtId: "gt-1" }, status: "error" },
      { input: { gtId: 1 }, status: "success", output: { weighted_problem_list_f1_neutral: 0.9 } }, // numeric gtId "1" same as string "1"
    ];
    const stats = taskStats(runs);
    expect(stats.get("gt-1")).toEqual({ attempts: 3, bestF1: 0.8 });
    expect(stats.get("1")).toEqual({ attempts: 1, bestF1: 0.9 });
  });

  test("runs with no resolvable gtId are skipped", () => {
    const stats = taskStats([{ status: "success" }]);
    expect(stats.size).toBe(0);
  });
});

describe("stageFromSteps", () => {
  test("returns the furthest stage present", () => {
    expect(stageFromSteps(["task", "ingest"])).toBe("ingest");
    expect(stageFromSteps(["task", "ingest", "produce", "scored"])).toBe("scored");
  });

  test("defaults to the first stage when nothing matches", () => {
    expect(stageFromSteps([])).toBe("task");
  });
});

describe("stageFromPath", () => {
  test("matches a step id as a path segment", () => {
    expect(stageFromPath("/steps/ingest/step.end")).toBe("ingest");
    expect(stageFromPath("/steps/produce/step.start")).toBe("produce");
  });

  test("returns null when no segment matches a known step id", () => {
    expect(stageFromPath("/unknown/path")).toBeNull();
  });
});

describe("projectRunSummary", () => {
  const BASE = {
    runId: "1700000000000",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    input: { gtId: "gt-1", workdir: "gt-gt-1" },
    output: {
      weighted_problem_list_f1_neutral: 0.9,
      problem_list_recall: 0.95,
      problem_list_precision_neutral: 0.85,
      tier: "gold",
      matched: ["a"],
      missed: ["b"],
      extra: ["c"],
      problemList: ["p1"],
      produceCost: 1,
      ingested: [{ cost: 0.5 }],
    },
  };

  test("keeps the score fields, tables, and counts", () => {
    const projected = projectRunSummary(BASE);
    expect(projected.runId).toBe("1700000000000");
    expect(projected.gtId).toBe("gt-1");
    expect(projected.f1).toBe(0.9);
    expect(projected.tier).toBe("gold");
    expect(projected.matched).toEqual(["a"]);
    expect(projected.missedCount).toBe(1);
    expect(projected.extraCount).toBe(1);
    expect(projected.cost).toBeCloseTo(1.5);
  });

  test("drops callback/run_token, actor, outputDir, transcript, and steps", () => {
    const leaky = {
      ...BASE,
      callback: { url: "https://example.com/webhook?run_token=SECRET" },
      actor: "user-actor-123",
      outputDir: "/tmp/gt-1",
      transcript: [{ role: "assistant", content: "leak" }],
      steps: { task: { output: { groundTruth: "leak" } } },
    };
    const projected = projectRunSummary(leaky) as unknown as Record<string, unknown>;
    expect(projected).not.toHaveProperty("callback");
    expect(projected).not.toHaveProperty("actor");
    expect(projected).not.toHaveProperty("outputDir");
    expect(projected).not.toHaveProperty("transcript");
    expect(projected).not.toHaveProperty("steps");
    expect(JSON.stringify(projected)).not.toContain("SECRET");
  });

  test("drops the raw input object — only the derived gtId is exposed", () => {
    const projected = projectRunSummary(BASE) as unknown as Record<string, unknown>;
    expect(projected).not.toHaveProperty("input");
  });

  test("a partial summary's stage comes from steps KEYS only, never their values", () => {
    const partial = {
      runId: "1700000000001",
      partial: true,
      status: undefined,
      steps: {
        task: { output: { groundTruth: "leak-value" } },
        ingest: {},
      },
      input: { gtId: "gt-2" },
      output: {},
    };
    const projected = projectRunSummary(partial);
    expect(projected.stage).toBe("ingest");
    expect(JSON.stringify(projected)).not.toContain("leak-value");
  });

  test("extracts a string error message", () => {
    const withError = { ...BASE, status: "error", error: "boom" };
    const projected = projectRunSummary(withError);
    expect(projected.error).toEqual({ message: "boom" });
  });

  test("extracts an object error's .message", () => {
    const withError = { ...BASE, status: "error", error: { message: "boom", stack: "leak-stack" } };
    const projected = projectRunSummary(withError);
    expect(projected.error).toEqual({ message: "boom" });
    expect(JSON.stringify(projected)).not.toContain("leak-stack");
  });

  test("hasSheet is true for both an artifact-form and a url-form sheet, but only the url form gets a sheetUrl", () => {
    const withArtifact = { ...BASE, output: { ...BASE.output, sheet: { path: "gt-1/spreadsheet.md" } } };
    const projectedArtifact = projectRunSummary(withArtifact);
    expect(projectedArtifact.hasSheet).toBe(true);
    expect(projectedArtifact.sheetUrl).toBeNull();

    const withUrl = { ...BASE, output: { ...BASE.output, sheet: { url: "https://sheets.example.com/x" } } };
    const projectedUrl = projectRunSummary(withUrl);
    expect(projectedUrl.hasSheet).toBe(true);
    expect(projectedUrl.sheetUrl).toBe("https://sheets.example.com/x");
  });

  test("gold.json-adjacent path fields never appear in the output even if present upstream", () => {
    const leaky = { ...BASE, output: { ...BASE.output, goldPath: "gt-1/gold.json" } };
    const projected = projectRunSummary(leaky);
    expect(JSON.stringify(projected)).not.toContain("gold.json");
  });
});

describe("projectTaskRow", () => {
  test("keeps the allowlisted shape for a public/heldout row", () => {
    const row = projectTaskRow({ gtId: "gt-1", split: "public", difficulty: "easy", patientId: "p-1" });
    expect(row).toEqual({ gtId: "gt-1", split: "public", difficulty: "easy", patientId: "p-1" });
  });

  test("drops a train row entirely", () => {
    expect(projectTaskRow({ gtId: "gt-1", split: "train" })).toBeNull();
  });

  test("strips gold-shaped keys even if present on the raw row", () => {
    const row = projectTaskRow({
      gtId: "gt-1",
      split: "public",
      ground_truth: "leak",
      groundTruth: "leak",
      gold: "leak",
    } as never);
    expect(row).not.toHaveProperty("ground_truth");
    expect(row).not.toHaveProperty("groundTruth");
    expect(row).not.toHaveProperty("gold");
  });

  test("accepts a numeric gt_id and normalizes it to a string gtId", () => {
    const row = projectTaskRow({ gt_id: 7013, split: "heldout" });
    expect(row?.gtId).toBe("7013");
  });

  test("drops a row with no gtId at all", () => {
    expect(projectTaskRow({ split: "public" })).toBeNull();
  });
});
