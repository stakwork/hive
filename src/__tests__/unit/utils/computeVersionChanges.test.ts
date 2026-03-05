import { describe, it, expect } from "vitest";
import { computeVersionChanges } from "@/lib/whiteboard/version-utils";

describe("computeVersionChanges", () => {
  it("returns 0 when both sets are identical", () => {
    const current = new Set(["a", "b", "c"]);
    const last = new Set(["a", "b", "c"]);
    expect(computeVersionChanges(current, last)).toBe(0);
  });

  it("returns 0 when both sets are empty", () => {
    expect(computeVersionChanges(new Set(), new Set())).toBe(0);
  });

  it("returns 2 for two added elements", () => {
    const current = new Set(["a", "b", "c", "d", "e"]);
    const last = new Set(["a", "b", "c"]);
    expect(computeVersionChanges(current, last)).toBe(2);
  });

  it("returns 2 for two removed elements", () => {
    const current = new Set(["a"]);
    const last = new Set(["a", "b", "c"]);
    expect(computeVersionChanges(current, last)).toBe(2);
  });

  it("returns 5 for a mix of additions and removals (symmetric diff)", () => {
    // 3 removed + 2 added = 5
    const current = new Set(["d", "e", "f"]);
    const last = new Set(["a", "b", "c", "d"]);
    // added: e, f (2); removed: a, b, c (3) → total 5
    expect(computeVersionChanges(current, last)).toBe(5);
  });

  it("returns correct count when current set is empty", () => {
    const current = new Set<string>();
    const last = new Set(["a", "b"]);
    expect(computeVersionChanges(current, last)).toBe(2);
  });

  it("returns correct count when last snapshot is empty", () => {
    const current = new Set(["x", "y", "z"]);
    const last = new Set<string>();
    expect(computeVersionChanges(current, last)).toBe(3);
  });
});
