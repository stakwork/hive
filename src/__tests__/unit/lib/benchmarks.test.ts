import { describe, it, expect } from "vitest";
import { BENCHMARKS, benchmarkKind, benchmarkVisibleIn, getBenchmark } from "@/lib/benchmarks/registry";
import { buildExtra, buildLaunchInput, parseHeadline, parseTaskList, stripDenyKeys, MAX_EXTRA_BYTES } from "@/lib/benchmarks/render";

describe("benchmark registry", () => {
  it("registers openhealth with its workflows", () => {
    const b = getBenchmark("openhealth");
    expect(b).toMatchObject({ name: "OpenHealth", listWorkflow: "openhealth-list-tasks", runWorkflow: "openhealth-run" });
    expect(getBenchmark("nope")).toBeNull();
  });
  it("has unique slugs and encodes the slug in the kind", () => {
    expect(new Set(BENCHMARKS.map((b) => b.slug)).size).toBe(BENCHMARKS.length);
    expect(benchmarkKind("openhealth")).toBe("benchmark:openhealth");
  });
  it("gates by workspace slug when listed", () => {
    const b = getBenchmark("openhealth")!;
    expect(benchmarkVisibleIn(b, "hive")).toBe(true);
    expect(benchmarkVisibleIn(b, "other")).toBe(false);
    expect(benchmarkVisibleIn({ slug: "x", name: "x", runWorkflow: "x" }, "any")).toBe(true);
  });
});

describe("harvey-lab", () => {
  it("is registered for the strut legal workspaces only", () => {
    const b = getBenchmark("harvey-lab")!;
    expect(b).toMatchObject({ runWorkflow: "harvey-lab-run", taskIdKey: "task_slug" });
    expect(benchmarkVisibleIn(b, "openlaw-1")).toBe(true);
    expect(benchmarkVisibleIn(b, "openlaw")).toBe(false);
  });
  it("names the task by its declared key", () => {
    const b = getBenchmark("harvey-lab")!;
    expect(buildLaunchInput(b, "banking/x", null, { task_goal: "g" })).toEqual({ task_goal: "g", task_slug: "banking/x" });
  });
});

describe("buildLaunchInput", () => {
  it("free-form fallback (no task) skips templated defaults and keeps params", () => {
    const oh = getBenchmark("openhealth")!;
    expect(buildLaunchInput(oh, undefined, null, { gtId: 7532 })).toEqual({ task: "patient_diagnosis", gtId: 7532 });
  });
});

describe("render helpers", () => {
  it("parses the headline and ignores bad fields", () => {
    const h = parseHeadline({
      score: 0.5,
      metric: "f1",
      officialScore: 0.4,
      summary: "# hi",
      artifacts: [{ name: "a", url: "https://x/y", kind: "log" }, { url: "javascript:alert(1)" }, { name: "n" }],
      parentRunId: "p1",
    });
    expect(h).toMatchObject({ score: 0.5, metric: "f1", officialScore: 0.4, summary: "# hi", parentRunId: "p1" });
    expect(h.artifacts).toEqual([{ name: "a", url: "https://x/y", kind: "log" }]);
    expect(parseHeadline(null)).toMatchObject({ score: null, artifacts: [] });
  });
  it("strips deny keys at any depth", () => {
    expect(stripDenyKeys({ a: 1, secret: 2, n: { secret: 3, k: [{ secret: 4, z: 5 }] } }, ["secret"])).toEqual({
      a: 1,
      n: { k: [{ z: 5 }] },
    });
  });
  it("builds extra without headline keys or denied keys", () => {
    const e = buildExtra({ score: 1, summary: "s", answerKey: "x", detail: { v: 1 } }, ["answerKey"]);
    expect(e).toEqual({ value: { detail: { v: 1 } }, truncated: false });
    expect(buildExtra({ score: 1 }).value).toBeNull();
    expect(buildExtra(null).value).toBeNull();
  });
  it("truncates beyond the size cap", () => {
    const e = buildExtra({ blob: "x".repeat(MAX_EXTRA_BYTES + 10) });
    expect(e.truncated).toBe(true);
    expect(e.value).toBeNull();
    expect(e.bytes).toBeGreaterThan(MAX_EXTRA_BYTES);
  });
  it("parses task lists from arrays or { tasks }", () => {
    expect(parseTaskList([{ id: 1, title: "A" }, { id: "b" }, { title: "no id" }, 3])).toEqual([
      { id: 1, title: "A" },
      { id: "b", title: "b" },
    ]);
    expect(parseTaskList({ tasks: [{ gtId: 7 }] })).toEqual([{ gtId: 7, id: 7, title: "7" }]);
    expect(parseTaskList("x")).toEqual([]);
  });
});
