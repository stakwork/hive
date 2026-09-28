/**
 * Unit tests for `lib/openhealth-benchmarks/constants.ts`.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  isOpenHealthArtifactName,
  isOpenHealthSplit,
  OPENHEALTH_ARTIFACTS,
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
    expect(Object.keys(OPENHEALTH_ARTIFACTS).sort()).toEqual(["checklist", "problem-list", "timeline"]);
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
});
