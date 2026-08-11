import { describe, it, expect } from "vitest";
import {
  toEpochMs,
  scaleDurations,
  formatDuration,
  phaseColor,
  groupRubrics,
  aggregateFixes,
  computeStats,
  flattenText,
  findHighlightRanges,
  isPassVerdict,
  MAX_HIGHLIGHT_TOKENS,
} from "@/lib/run-report/derive";
import type { SanitizedNode } from "@/lib/run-report/types";

describe("toEpochMs", () => {
  it("parses the generator's space-separated form as UTC", () => {
    // No zone in this form; guessing the server's local zone would shift every
    // timestamp by the deployment region's offset.
    expect(toEpochMs("2026-08-10 14:32:07.418")).toBe(Date.parse("2026-08-10T14:32:07.418Z"));
  });

  it("parses true ISO8601 with an offset", () => {
    expect(toEpochMs("2026-08-10T14:32:07.418+00:00")).toBe(
      Date.parse("2026-08-10T14:32:07.418Z"),
    );
  });

  it("agrees across both forms for the same instant", () => {
    expect(toEpochMs("2026-08-10 14:32:07.418")).toBe(toEpochMs("2026-08-10T14:32:07.418+00:00"));
  });

  it("accepts epoch seconds and milliseconds", () => {
    expect(toEpochMs(1_776_000_000)).toBe(1_776_000_000_000);
    expect(toEpochMs(1_776_000_000_000)).toBe(1_776_000_000_000);
  });

  it("returns null rather than NaN for junk", () => {
    expect(toEpochMs("not a date")).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("")).toBeNull();
  });
});

describe("scaleDurations / formatDuration / phaseColor", () => {
  it("scales widths proportionally to the longest phase", () => {
    const phases = scaleDurations([
      { name: "a", startMs: 0, endMs: 1000 },
      { name: "b", startMs: 0, endMs: 500 },
      { name: "c", startMs: 0, endMs: 250 },
    ]);
    expect(phases[0].widthPct).toBe(100);
    expect(phases[1].widthPct).toBe(50);
    expect(phases[2].widthPct).toBe(25);
  });

  it("gives unknown-duration phases width 0 but still lists them", () => {
    const phases = scaleDurations([
      { name: "known", startMs: 0, endMs: 1000 },
      { name: "unknown", startMs: null, endMs: null },
    ]);
    expect(phases).toHaveLength(2);
    expect(phases[1].widthPct).toBe(0);
    expect(phases[1].durationMs).toBeNull();
  });

  it("does not divide by zero when every duration is unknown", () => {
    const phases = scaleDurations([{ name: "x", startMs: null, endMs: null }]);
    expect(phases[0].widthPct).toBe(0);
  });

  it("formats durations across unit boundaries", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
  });

  it("cycles phase colours deterministically", () => {
    expect(phaseColor(0)).toBe(phaseColor(6));
    expect(phaseColor(0)).not.toBe(phaseColor(1));
  });
});

describe("groupRubrics / isPassVerdict", () => {
  it("treats verdict casing as unverified and matches case-insensitively", () => {
    expect(isPassVerdict("pass")).toBe(true);
    expect(isPassVerdict("PASS")).toBe(true);
    expect(isPassVerdict("Passed")).toBe(true);
    expect(isPassVerdict("fail")).toBe(false);
    expect(isPassVerdict(undefined)).toBe(false);
  });

  it("groups summaries into rubric rows", () => {
    const rows = groupRubrics({
      summaries: [
        { id: "R1", title: "One", verdict: "pass", reasoning: "ok" },
        { id: "R2", title: "Two", verdict: "fail", reasoning: "no", cause_type: "retrieval_miss" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].passed).toBe(true);
    expect(rows[1].causeType).toBe("retrieval_miss");
  });

  it("skips entries with no id and tolerates a missing analysis", () => {
    expect(groupRubrics({ summaries: [{ title: "no id" }] })).toHaveLength(0);
    expect(groupRubrics(undefined)).toHaveLength(0);
    expect(groupRubrics({})).toHaveLength(0);
  });
});

describe("aggregateFixes", () => {
  it("collapses repeated root causes and dedupes identical suggestions", () => {
    const fixes = aggregateFixes([
      { id: "R1", title: "a", passed: false, reasoning: "", causeType: "retrieval_miss", suggestedFix: "Increase overlap" },
      { id: "R2", title: "b", passed: false, reasoning: "", causeType: "retrieval_miss", suggestedFix: "Increase overlap" },
      { id: "R3", title: "c", passed: true, reasoning: "" },
    ]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].count).toBe(2);
    expect(fixes[0].rubricIds).toEqual(["R1", "R2"]);
    expect(fixes[0].suggestions).toEqual(["Increase overlap"]);
  });

  it("buckets missing cause types as uncategorized and sorts by count", () => {
    const fixes = aggregateFixes([
      { id: "R1", title: "a", passed: false, reasoning: "" },
      { id: "R2", title: "b", passed: false, reasoning: "", causeType: "x" },
      { id: "R3", title: "c", passed: false, reasoning: "" },
    ]);
    expect(fixes[0].causeType).toBe("uncategorized");
    expect(fixes[0].count).toBe(2);
  });
});

describe("computeStats", () => {
  const base = { sourceDocs: [1, 2], workfiles: [1], traces: [1, 2, 3], branches: [1] };

  it("counts rubric pass/fail", () => {
    const stats = computeStats({
      ...base,
      rubricRows: [
        { id: "R1", title: "", passed: true, reasoning: "" },
        { id: "R2", title: "", passed: false, reasoning: "" },
      ],
    });
    expect(stats).toMatchObject({
      sourceDocCount: 2,
      workfileCount: 1,
      traceCount: 3,
      branchCount: 1,
      rubricCount: 2,
      passCount: 1,
      failCount: 1,
    });
  });

  it("returns null (not 0) when no rubrics ran at all", () => {
    // "no analysis ran" must be distinguishable from "everything failed".
    const stats = computeStats({ ...base, rubricRows: [] });
    expect(stats.passCount).toBeNull();
    expect(stats.failCount).toBeNull();
  });
});

describe("flattenText / findHighlightRanges", () => {
  // "terminate for convenience" split across three text nodes by inline tags.
  const SPLIT: SanitizedNode[] = [
    {
      t: "p",
      c: [
        "may ",
        { t: "em", c: ["terminate"] },
        " for ",
        { t: "strong", c: ["convenience"] },
        " on notice.",
      ],
    },
  ];

  it("flattens to a single concatenated string with per-node offsets", () => {
    const index = flattenText(SPLIT);
    expect(index.text).toBe("may terminate for convenience on notice.");
    expect(index.spans.length).toBe(5);
    expect(index.text.slice(index.spans[1].start, index.spans[1].end)).toBe("terminate");
  });

  it("matches a token that straddles inline-tag boundaries", () => {
    const index = flattenText(SPLIT);
    const ranges = findHighlightRanges(index, ["terminate for convenience"]);
    expect(ranges).toHaveLength(1);
    expect(index.text.slice(ranges[0].start, ranges[0].end)).toBe("terminate for convenience");
  });

  it("returns empty for an unmatchable token rather than throwing", () => {
    const index = flattenText(SPLIT);
    expect(findHighlightRanges(index, ["nowhere in this document"])).toEqual([]);
  });

  it("does not construct a RegExp from bundle tokens", () => {
    // Regex metacharacters would be injection + a backtracking DoS if compiled.
    const index = flattenText(SPLIT);
    expect(() =>
      findHighlightRanges(index, ["(a+)+$", "[[[", "\\", "*.*", "(?<x>y)"]),
    ).not.toThrow();
  });

  it("caps token count", () => {
    const index = flattenText(SPLIT);
    const filler = Array.from({ length: MAX_HIGHLIGHT_TOKENS + 10 }, (_, i) => `zz${i}`);
    // "terminate" sits past the cap, so it must not be matched.
    expect(findHighlightRanges(index, [...filler, "terminate"])).toEqual([]);
  });

  it("ignores over-long and too-short tokens", () => {
    const index = flattenText(SPLIT);
    expect(findHighlightRanges(index, ["x".repeat(5000)])).toEqual([]);
    expect(findHighlightRanges(index, ["ma"])).toEqual([]);
  });

  it("merges overlapping ranges", () => {
    const index = flattenText(SPLIT);
    const ranges = findHighlightRanges(index, ["terminate for", "for convenience"]);
    expect(ranges).toHaveLength(1);
    expect(index.text.slice(ranges[0].start, ranges[0].end)).toBe("terminate for convenience");
  });

  it("matches case-insensitively", () => {
    const index = flattenText(SPLIT);
    expect(findHighlightRanges(index, ["TERMINATE FOR CONVENIENCE"])).toHaveLength(1);
  });
});
