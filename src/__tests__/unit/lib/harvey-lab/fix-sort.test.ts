import { describe, it, expect } from "vitest";
import { compareFixRows } from "@/lib/harvey-lab/fix-sort";

describe("compareFixRows", () => {
  it("orders by target_name ascending, nulls last", () => {
    const a = { target_name: "Alpha", criterion_id: null, ref_id: "1" };
    const b = { target_name: "Beta", criterion_id: null, ref_id: "2" };
    expect(compareFixRows(a, b)).toBeLessThan(0);
    expect(compareFixRows(b, a)).toBeGreaterThan(0);
  });

  it("falls through to criterion_id when target_name is equal (or null)", () => {
    const a = { target_name: null, criterion_id: "AAA", ref_id: "1" };
    const b = { target_name: null, criterion_id: "BBB", ref_id: "2" };
    expect(compareFixRows(a, b)).toBeLessThan(0);
  });

  it("falls through to ref_id when target_name and criterion_id are both null", () => {
    const a = { target_name: null, criterion_id: null, ref_id: "aaa" };
    const b = { target_name: null, criterion_id: null, ref_id: "bbb" };
    expect(compareFixRows(a, b)).toBeLessThan(0);
  });

  it("puts nulls last at every tier", () => {
    type Row = { target_name: string | null; criterion_id: string | null; ref_id: string };
    const withName: Row = { target_name: "Alpha", criterion_id: null, ref_id: "1" };
    const noName: Row = { target_name: null, criterion_id: "ZZZ", ref_id: "2" };
    expect(compareFixRows(withName, noName)).toBeLessThan(0); // Alpha before null
    expect(compareFixRows(noName, withName)).toBeGreaterThan(0);
  });

  it("handles prompt fixes (no target_name) ordering by criterion_id", () => {
    const a = { target_name: null, criterion_id: "crit-001", ref_id: "1" };
    const b = { target_name: null, criterion_id: "crit-002", ref_id: "2" };
    expect(compareFixRows(a, b)).toBeLessThan(0);
  });

  it("produces identical ordering for an all-criterion_id-null concept group", () => {
    const fixes = [
      { target_name: "Limitation", criterion_id: null, ref_id: "z3" },
      { target_name: "Arbitration", criterion_id: null, ref_id: "z1" },
      { target_name: "Indemnification", criterion_id: null, ref_id: "z2" },
    ];
    const sorted = [...fixes].sort(compareFixRows);
    expect(sorted.map(f => f.target_name)).toEqual(["Arbitration", "Indemnification", "Limitation"]);
  });

  it("is stable on equal inputs", () => {
    const a = { target_name: "Same", criterion_id: "same", ref_id: "same" };
    const b = { target_name: "Same", criterion_id: "same", ref_id: "same" };
    expect(compareFixRows(a, b)).toBe(0);
  });

  it("trims whitespace before comparing", () => {
    const a = { target_name: "  Alpha  ", criterion_id: null, ref_id: "same" };
    const b = { target_name: "Alpha", criterion_id: null, ref_id: "same" };
    expect(compareFixRows(a, b)).toBe(0);
  });
});
