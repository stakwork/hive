import { describe, test, expect, afterEach } from "vitest";
import {
  isOpenHealthSplit,
  bodyHasGoldKey,
  resolveOpenHealthStrutWorkflowName,
  OPENHEALTH_STRUT_WORKFLOW_NAME_RE,
  OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME,
  OPENHEALTH_LIST_TASKS_WORKFLOW,
  OPENHEALTH_READ_RATE_LIMIT,
  OPENHEALTH_RUN_RATE_LIMIT,
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

describe("bodyHasGoldKey", () => {
  test("detects each gold-shaped key even when the rest of the body is valid", () => {
    expect(bodyHasGoldKey({ split: "public", ground_truth: {} })).toBe("ground_truth");
    expect(bodyHasGoldKey({ split: "public", groundTruth: {} })).toBe("groundTruth");
    expect(bodyHasGoldKey({ split: "public", gold: {} })).toBe("gold");
    expect(bodyHasGoldKey({ split: "public", problemList: [] })).toBe("problemList");
  });

  test("returns null when no gold key is present", () => {
    expect(bodyHasGoldKey({ gtId: "gt-1", split: "public" })).toBeNull();
  });

  test("detects a gold key nested inside a sub-object", () => {
    expect(bodyHasGoldKey({ input: { split: "public", gold: "leak" } })).toBe("gold");
  });

  test("detects a gold key nested inside an array element", () => {
    expect(bodyHasGoldKey({ items: [{ ok: true }, { groundTruth: "leak" }] })).toBe("groundTruth");
  });

  test("returns null for non-object bodies", () => {
    expect(bodyHasGoldKey("just a string")).toBeNull();
    expect(bodyHasGoldKey(null)).toBeNull();
    expect(bodyHasGoldKey(42)).toBeNull();
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

describe("OPENHEALTH_LIST_TASKS_WORKFLOW", () => {
  test("is a fixed name with no env override", () => {
    expect(OPENHEALTH_LIST_TASKS_WORKFLOW).toBe("openhealth-list-tasks");
  });
});

describe("rate limit constants", () => {
  test("read routes are 60/min, run/dispatch routes are 10/min", () => {
    expect(OPENHEALTH_READ_RATE_LIMIT).toEqual({ limit: 60, windowSecs: 60 });
    expect(OPENHEALTH_RUN_RATE_LIMIT).toEqual({ limit: 10, windowSecs: 60 });
  });
});
