import { describe, it, expect } from "vitest";
import { BENCHMARKS, benchmarkKind, benchmarkVisibleIn, getBenchmark, taskIdKey } from "@/lib/benchmarks/registry";

describe("benchmark registry", () => {
  it("has unique slugs and encodes the slug in the kind", () => {
    expect(new Set(BENCHMARKS.map((b) => b.slug)).size).toBe(BENCHMARKS.length);
    expect(benchmarkKind("harvey-lab")).toBe("benchmark:harvey-lab");
    expect(getBenchmark("nope")).toBeNull();
  });
  it("gates by workspace slug when listed", () => {
    expect(benchmarkVisibleIn({ slug: "x", name: "x", runWorkflow: "x" }, "any")).toBe(true);
    expect(benchmarkVisibleIn({ slug: "x", name: "x", runWorkflow: "x", workspaceSlugs: ["a"] }, "b")).toBe(false);
  });
  it("names the task by the declared key, else taskId", () => {
    expect(taskIdKey({ taskIdKey: "task_slug" })).toBe("task_slug");
    expect(taskIdKey({})).toBe("taskId");
  });
});

describe("harvey-lab", () => {
  it("is registered for the strut legal workspaces only", () => {
    const b = getBenchmark("harvey-lab")!;
    expect(b).toMatchObject({ runWorkflow: "harvey-lab-run", taskIdKey: "task_slug" });
    expect(benchmarkVisibleIn(b, "openlaw-1")).toBe(true);
    expect(benchmarkVisibleIn(b, "openlaw")).toBe(false);
  });
  it("is the only benchmark: OpenHealth's UI is the app its workspace pins", () => {
    expect(getBenchmark("openhealth")).toBeNull();
  });
});
