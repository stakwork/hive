import { describe, it, expect } from "vitest";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";

describe("computeUnifiedDiff", () => {
  it("reports no change when before === after", () => {
    const d = computeUnifiedDiff("same\ntext", "same\ntext");
    expect(d.unchanged).toBe(true);
    expect(d.hunks).toHaveLength(0);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("shows only the changed region, collapsing far-away context", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    // Change only line 20.
    const afterLines = before.split("\n");
    afterLines[20] = "line 20 CHANGED";
    const after = afterLines.join("\n");

    const d = computeUnifiedDiff(before, after, 3);
    expect(d.unchanged).toBe(false);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    // Single hunk, with the far-away lines collapsed into a gap.
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].gapBefore).toBeGreaterThan(0);

    const rows = d.hunks[0].rows;
    // 3 context above + del + add + 3 context below = 8 rows.
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.type === "del").map((r) => r.text)).toEqual([
      "line 20",
    ]);
    expect(rows.filter((r) => r.type === "add").map((r) => r.text)).toEqual([
      "line 20 CHANGED",
    ]);
    // The full document is NOT dumped — only ~8 rows shown.
    expect(rows.length).toBeLessThan(before.split("\n").length);
  });

  it("handles a pure insertion (added lines only)", () => {
    const before = "a\nb\nc";
    const after = "a\nb\nNEW\nc";
    const d = computeUnifiedDiff(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    const addRows = d.hunks.flatMap((h) => h.rows).filter((r) => r.type === "add");
    expect(addRows.map((r) => r.text)).toEqual(["NEW"]);
  });

  it("keeps separate changes as separate hunks when far apart", () => {
    const before = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n");
    const lines = before.split("\n");
    lines[5] = "l5-x";
    lines[50] = "l50-x";
    const after = lines.join("\n");
    const d = computeUnifiedDiff(before, after, 2);
    expect(d.hunks.length).toBe(2);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
  });

  it("carries line numbers for context/del/add rows", () => {
    const d = computeUnifiedDiff("a\nb\nc", "a\nB\nc", 3);
    const del = d.hunks[0].rows.find((r) => r.type === "del");
    const add = d.hunks[0].rows.find((r) => r.type === "add");
    expect(del?.oldLine).toBe(2);
    expect(add?.newLine).toBe(2);
  });
});
