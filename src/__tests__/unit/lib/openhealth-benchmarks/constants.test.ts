/**
 * Unit tests for `lib/openhealth-benchmarks/constants.ts`.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  isOpenHealthArtifactName,
  isOpenHealthSplit,
  OPENHEALTH_ARTIFACTS,
  OPENHEALTH_BENCHMARKS,
  openHealthBenchmarkFrom,
  openHealthBenchmarkKey,
  openHealthBenchmarkLabel,
  openHealthDeliverable,
  openHealthMetricLabel,
  openHealthWorkdir,
  resolveOpenHealthStrutWorkflowName,
} from "@/lib/openhealth-benchmarks/constants";

describe("splits", () => {
  it("offers public and heldout, never train", () => {
    expect(isOpenHealthSplit("public")).toBe(true);
    expect(isOpenHealthSplit("heldout")).toBe(true);
    expect(isOpenHealthSplit("train")).toBe(false);
    expect(isOpenHealthSplit("")).toBe(false);
    expect(isOpenHealthSplit(null)).toBe(false);
  });
});

describe("resolveOpenHealthStrutWorkflowName", () => {
  const original = process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
    else process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = original;
  });

  it("defaults to openhealth-run when unset or blank", () => {
    delete process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
    expect(resolveOpenHealthStrutWorkflowName()).toBe("openhealth-run");
    process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = "  ";
    expect(resolveOpenHealthStrutWorkflowName()).toBe("openhealth-run");
  });

  it("takes the configured name", () => {
    process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = "openhealth-run-v2";
    expect(resolveOpenHealthStrutWorkflowName()).toBe("openhealth-run-v2");
  });

  it.each(["Openhealth-Run", "openhealth run", "../runs", "a/b"])("falls back to the default for %s", (name) => {
    process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = name;
    expect(resolveOpenHealthStrutWorkflowName()).toBe("openhealth-run");
  });
});

describe("artifacts", () => {
  it("serves a closed list of files, none of them the answer key", () => {
    expect(Object.keys(OPENHEALTH_ARTIFACTS).sort()).toEqual(["checklist", "problem-list", "summary", "timeline"]);
    for (const { file } of Object.values(OPENHEALTH_ARTIFACTS)) {
      expect(file).not.toMatch(/gold|task\.json|\.\./);
    }
  });

  it.each(["gold", "gold.json", "task", "../gold.json", "problem-list/../gold.json", "toString", "__proto__", "", 7])(
    "refuses %s",
    (name) => {
      expect(isOpenHealthArtifactName(name)).toBe(false);
    },
  );

  it("keeps a run's files under its task's folder", () => {
    expect(openHealthWorkdir(7532)).toBe("gt-7532");
  });

  it("opens the task's deliverable: a problem list, or a summary", () => {
    expect(openHealthDeliverable("patient_diagnosis")).toBe("problem-list");
    expect(openHealthDeliverable("context_summarization")).toBe("summary");
  });
});

describe("benchmarks", () => {
  it("offers diagnosis and the two summarization variants, diagnosis first", () => {
    expect(OPENHEALTH_BENCHMARKS.map((b) => [b.key, b.task, b.variant])).toEqual([
      ["diagnosis", "patient_diagnosis", null],
      ["summary", "context_summarization", "unconditioned"],
      ["specialty-summary", "context_summarization", "specialty_conditioned"],
    ]);
  });

  it("reads a request's task and variant, with the defaults", () => {
    expect(openHealthBenchmarkFrom(undefined, undefined)).toEqual({ task: "patient_diagnosis", variant: null });
    expect(openHealthBenchmarkFrom(null, "")).toEqual({ task: "patient_diagnosis", variant: null });
    expect(openHealthBenchmarkFrom("context_summarization", undefined)).toEqual({
      task: "context_summarization",
      variant: "unconditioned",
    });
    expect(openHealthBenchmarkFrom("context_summarization", "specialty_conditioned")).toEqual({
      task: "context_summarization",
      variant: "specialty_conditioned",
    });
    // A variant on a task that has none is ignored.
    expect(openHealthBenchmarkFrom("patient_diagnosis", "specialty_conditioned")).toEqual({
      task: "patient_diagnosis",
      variant: null,
    });
  });

  it.each([
    ["evidence_retrieval", undefined],
    ["imaging_indication", undefined],
    ["context_summarization", "encounter"],
    [7, undefined],
    ["patient_diagnosis", "whole"],
  ])("refuses %s / %s", (task, variant) => {
    expect(openHealthBenchmarkFrom(task, variant)).toBeNull();
  });

  it("names each benchmark, the specialty when it has one", () => {
    expect(openHealthBenchmarkLabel({ task: "patient_diagnosis", variant: null })).toBe("Diagnosis");
    expect(openHealthBenchmarkLabel({ task: "context_summarization", variant: "unconditioned" })).toBe("Summary");
    expect(openHealthBenchmarkLabel({ task: "context_summarization", variant: "specialty_conditioned" })).toBe(
      "Specialty summary",
    );
    expect(
      openHealthBenchmarkLabel({ task: "context_summarization", variant: "specialty_conditioned" }, "Obstetrics_Gynecology"),
    ).toBe("Obstetrics/Gynecology summary");
    expect(openHealthBenchmarkKey({ task: "context_summarization", variant: "specialty_conditioned" })).toBe(
      "specialty-summary",
    );
    // A summarization row of no known variant is listed as a summary.
    expect(openHealthBenchmarkKey({ task: "context_summarization", variant: null })).toBe("summary");
  });

  it("names the paper's metrics, and falls back to the metric's own name", () => {
    expect(openHealthMetricLabel("weighted_problem_list_f1_neutral")).toBe("Weighted F1");
    expect(openHealthMetricLabel("clinical_f1")).toBe("Clinical F1");
    expect(openHealthMetricLabel("conditioned_f1")).toBe("Conditioned F1");
    expect(openHealthMetricLabel("abstention_accuracy")).toBe("Abstention");
    expect(openHealthMetricLabel("ndcg_10")).toBe("ndcg_10");
    expect(openHealthMetricLabel(null)).toBe("Score");
  });
});
