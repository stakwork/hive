import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  isOpenHealthSplit,
  isOpenHealthTaskName,
  bodyHasGoldKey,
  projectOpenHealthInstanceSummary,
  projectOpenHealthWebhookFields,
  projectOpenHealthProbeOutput,
  projectOpenHealthRunResponse,
  resolveOpenHealthStrutWorkflowName,
  OPENHEALTH_STRUT_WORKFLOW_NAME_RE,
  OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME,
} from "@/lib/openhealth-benchmarks/constants";

describe("isOpenHealthSplit", () => {
  test("accepts public and heldout", () => {
    expect(isOpenHealthSplit("public")).toBe(true);
    expect(isOpenHealthSplit("heldout")).toBe(true);
  });

  test("rejects train and any other value including empty string", () => {
    expect(isOpenHealthSplit("train")).toBe(false);
    expect(isOpenHealthSplit("")).toBe(false);
    expect(isOpenHealthSplit("Public")).toBe(false);
    expect(isOpenHealthSplit(undefined)).toBe(false);
    expect(isOpenHealthSplit(null)).toBe(false);
    expect(isOpenHealthSplit(123)).toBe(false);
  });
});

describe("isOpenHealthTaskName", () => {
  test("accepts the four known task names", () => {
    expect(isOpenHealthTaskName("patient_diagnosis")).toBe(true);
    expect(isOpenHealthTaskName("context_summarization")).toBe(true);
    expect(isOpenHealthTaskName("evidence_retrieval")).toBe(true);
    expect(isOpenHealthTaskName("imaging_indication")).toBe(true);
  });

  test("rejects an unknown task name", () => {
    expect(isOpenHealthTaskName("unknown_task")).toBe(false);
    expect(isOpenHealthTaskName("")).toBe(false);
    expect(isOpenHealthTaskName(undefined)).toBe(false);
  });
});

describe("bodyHasGoldKey", () => {
  test("detects each gold-shaped key even when the rest of the body is valid", () => {
    expect(bodyHasGoldKey({ task: "x", ground_truth: {} })).toBe("ground_truth");
    expect(bodyHasGoldKey({ task: "x", groundTruth: {} })).toBe("groundTruth");
    expect(bodyHasGoldKey({ task: "x", gold: {} })).toBe("gold");
    expect(bodyHasGoldKey({ task: "x", problemList: [] })).toBe("problemList");
  });

  test("returns null when no gold key is present", () => {
    expect(bodyHasGoldKey({ task: "x", split: "public" })).toBeNull();
  });
});

describe("projectOpenHealthInstanceSummary", () => {
  test("drops ground_truth/groundTruth/gold and any other unknown key", () => {
    const row = {
      gt_id: "gt-1",
      task: "patient_diagnosis",
      granularity: "note",
      split: "public",
      patient_id: "p-1",
      encounter_id: "e-1",
      difficulty: "easy",
      ground_truth: { secret: true },
      groundTruth: { secret: true },
      gold: "leak",
      unexpected_extra_field: "leak",
    };
    const projected = projectOpenHealthInstanceSummary(row);
    expect(projected).not.toHaveProperty("ground_truth");
    expect(projected).not.toHaveProperty("groundTruth");
    expect(projected).not.toHaveProperty("gold");
    expect(projected).not.toHaveProperty("unexpected_extra_field");
    expect(projected.gt_id).toBe("gt-1");
    expect(projected.task).toBe("patient_diagnosis");
  });

  test("renders a null/missing field as null rather than inventing it", () => {
    const projected = projectOpenHealthInstanceSummary({ gt_id: "gt-1", task: "patient_diagnosis" });
    expect(projected.variant).toBeNull();
    expect(projected.clinical_question).toBeNull();
    expect(projected.specialty).toBeNull();
  });
});

describe("projectOpenHealthWebhookFields (thin webhook allowlist)", () => {
  test("keeps only task/gtId/weighted_problem_list_f1_neutral/gradeError", () => {
    const incoming = {
      task: "patient_diagnosis",
      gtId: "gt-1",
      weighted_problem_list_f1_neutral: 0.8,
      gradeError: null,
      problemList: ["leak"],
      ground_truth: { secret: true },
      groundTruth: { secret: true },
      gold: "leak",
      matched: ["leak"],
      report_url: "https://s3.example/leak",
    };
    const projected = projectOpenHealthWebhookFields(incoming);
    expect(Object.keys(projected).sort()).toEqual(
      ["gradeError", "gtId", "task", "weighted_problem_list_f1_neutral"].sort(),
    );
    expect(projected).not.toHaveProperty("problemList");
    expect(projected).not.toHaveProperty("ground_truth");
    expect(projected).not.toHaveProperty("groundTruth");
    expect(projected).not.toHaveProperty("gold");
    expect(projected).not.toHaveProperty("matched");
    expect(projected).not.toHaveProperty("report_url");
  });
});

describe("projectOpenHealthProbeOutput", () => {
  test("keeps missed/extra (for count computation) alongside the score fields", () => {
    const output = {
      task: "patient_diagnosis",
      split: "public",
      gtId: "gt-1",
      weighted_problem_list_f1_neutral: 0.75,
      n_matched: 3,
      n_gt: 4,
      missed: ["a"],
      extra: ["b", "c"],
      problemList: ["leak"],
      ground_truth: "leak",
    };
    const projected = projectOpenHealthProbeOutput(output);
    expect(projected.missed).toEqual(["a"]);
    expect(projected.extra).toEqual(["b", "c"]);
    expect(projected).not.toHaveProperty("problemList");
    expect(projected).not.toHaveProperty("ground_truth");
  });
});

describe("projectOpenHealthRunResponse", () => {
  test("omits gold keys and reduces missed/extra to counts, never the raw arrays", () => {
    const result = {
      runner: "strut",
      task: "patient_diagnosis",
      gtId: "gt-1",
      weighted_problem_list_f1_neutral: 0.5,
      n_matched: 2,
      n_gt: 4,
      tier: "bronze",
      missed: ["a", "b"],
      extra: ["c"],
      problemList: ["leak"],
      ground_truth: "leak",
      groundTruth: "leak",
      gold: "leak",
      matched: ["leak-pair"],
    };
    const projected = projectOpenHealthRunResponse(result);
    expect(projected.missedCount).toBe(2);
    expect(projected.extraCount).toBe(1);
    expect(projected).not.toHaveProperty("missed");
    expect(projected).not.toHaveProperty("extra");
    expect(projected).not.toHaveProperty("problemList");
    expect(projected).not.toHaveProperty("ground_truth");
    expect(projected).not.toHaveProperty("groundTruth");
    expect(projected).not.toHaveProperty("gold");
    expect(projected).not.toHaveProperty("matched");
  });

  test("missedCount/extraCount are null when missed/extra are absent, not zero", () => {
    const projected = projectOpenHealthRunResponse({ task: "patient_diagnosis" });
    expect(projected.missedCount).toBeNull();
    expect(projected.extraCount).toBeNull();
  });
});

describe("resolveOpenHealthStrutWorkflowName", () => {
  const ORIGINAL = process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
    else process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = ORIGINAL;
  });

  test("defaults to openhealth-run when unset", () => {
    delete process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
    expect(resolveOpenHealthStrutWorkflowName()).toBe(OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME);
  });

  test("uses the env var when set", () => {
    process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = "custom-run";
    expect(resolveOpenHealthStrutWorkflowName()).toBe("custom-run");
  });

  test("workflow name regex rejects uppercase and overly long names", () => {
    expect(OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test("openhealth-run")).toBe(true);
    expect(OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test("Openhealth-Run")).toBe(false);
    expect(OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test("-leading-dash")).toBe(false);
    expect(OPENHEALTH_STRUT_WORKFLOW_NAME_RE.test("a".repeat(65))).toBe(false);
  });
});
