import { describe, it, expect } from "vitest";
import {
  RUBRIC_EXCERPT_CHAR_CAP,
  toEpochMs,
  formatDuration,
  groupRubrics,
  aggregateFixes,
  computeStats,
  flattenText,
  findHighlightRanges,
  isPassVerdict,
  buildTimeline,
  buildGantt,
  readTraces,
  readSummaries,
  readSynthesis,
  MAX_HIGHLIGHT_TOKENS,
} from "@/lib/run-report/derive";
import { FULL_BUNDLE } from "@/app/api/mock/run-report/fixtures/full";
import type { SanitizedNode, TimelineStep } from "@/lib/run-report/types";

describe("toEpochMs", () => {
  it("parses the generator's space-separated form as UTC", () => {
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

  it("accepts epoch milliseconds (above floor)", () => {
    expect(toEpochMs(1_776_000_000_000)).toBe(1_776_000_000_000);
  });

  it("accepts epoch seconds (above floor when converted)", () => {
    // 1_776_000_000 seconds → 1_776_000_000_000 ms, which is above the year-2000 floor
    expect(toEpochMs(1_776_000_000)).toBe(1_776_000_000_000);
  });

  it("returns null rather than NaN for junk", () => {
    expect(toEpochMs("not a date")).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("")).toBeNull();
  });

  it("returns null for a small relative-offset-shaped number (below year-2000 floor)", () => {
    // A relative offset like 57.109 (seconds) or 3600 (one hour) would be
    // misread as a 1970s epoch-seconds date. We reject values that convert to
    // ms below the year-2000 floor (946_684_800_000 ms).
    expect(toEpochMs(57.109)).toBeNull();
    expect(toEpochMs(3600)).toBeNull();
    expect(toEpochMs(0)).toBeNull();
    // Negative numbers are also rejected.
    expect(toEpochMs(-1)).toBeNull();
  });

  it("returns null for a duration_s value that looks like epoch seconds but is too small", () => {
    // duration_s values from the bundle (e.g. 18.903, 64.32) must not be
    // silently misread as year-1970 timestamps.
    expect(toEpochMs(18.903)).toBeNull();
    expect(toEpochMs(64.32)).toBeNull();
    expect(toEpochMs(20.74)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats durations across unit boundaries", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
  });
});

describe("groupRubrics", () => {
  it("carries match criteria and judge-review keys, narrowing to primitives", () => {
    const rows = groupRubrics([
      {
        id: "X1",
        title: "t",
        verdict: "fail",
        match_criteria: "asks for the cap",
        flagged: "true",
        llm_flag_reason: "judge note",
        document_excerpt: "quoted evidence",
      },
      // object/array judge values must never ride the projection
      { id: "X2", title: "t", verdict: "fail", flagged: { nested: true }, llm_flag_reason: 42 },
    ]);
    expect(rows[0].matchCriteria).toBe("asks for the cap");
    expect(rows[0].judgeFlagged).toBe("true");
    expect(rows[0].judgeFlagReason).toBe("judge note");
    expect(rows[0].documentExcerpt).toBe("quoted evidence");
    expect(rows[1].judgeFlagged).toBeUndefined();
    expect(rows[1].judgeFlagReason).toBeUndefined();
    expect(rows[1].matchCriteria).toBe("");
    expect(rows[1].documentExcerpt).toBe("");
  });

  it("clamps an over-long document excerpt", () => {
    const rows = groupRubrics([
      { id: "X1", title: "t", verdict: "fail", document_excerpt: "a".repeat(RUBRIC_EXCERPT_CHAR_CAP + 50) },
    ]);
    expect(rows[0].documentExcerpt.length).toBe(RUBRIC_EXCERPT_CHAR_CAP + 1);
    expect(rows[0].documentExcerpt.endsWith("\u2026")).toBe(true);
  });

  it("accepts rubrics[] as first argument (new signature)", () => {
    const rows = groupRubrics([
      { id: "R1", title: "One", verdict: "pass", reasoning: "ok" },
      { id: "R2", title: "Two", verdict: "fail", reasoning: "no" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].passed).toBe(true);
    expect(rows[1].passed).toBe(false);
  });

  it("treats verdict casing as unverified and matches case-insensitively", () => {
    expect(isPassVerdict("pass")).toBe(true);
    expect(isPassVerdict("PASS")).toBe(true);
    expect(isPassVerdict("Passed")).toBe(true);
    expect(isPassVerdict("fail")).toBe(false);
    expect(isPassVerdict(undefined)).toBe(false);
  });

  it("reads id, title, verdict, reasoning directly from rubric entries", () => {
    const rows = groupRubrics([
      {
        id: "R1",
        title: "Identifies the indemnity cap",
        match_criteria: "Response names the cap.",
        verdict: "pass",
        reasoning: "Correct cap identified.",
      },
    ]);
    expect(rows[0].id).toBe("R1");
    expect(rows[0].title).toBe("Identifies the indemnity cap");
    expect(rows[0].verdict).toBe("pass");
    expect(rows[0].reasoning).toBe("Correct cap identified.");
  });

  it("stores an empty string for missing verdict (graceful degradation)", () => {
    const rows = groupRubrics([
      { id: "R3", title: "Cites law", verdict: "", reasoning: "Ambiguous." },
    ]);
    expect(rows[0].verdict).toBe("");
    expect(rows[0].passed).toBe(false);
  });

  it("skips entries with no id", () => {
    expect(groupRubrics([{ title: "no id" }])).toHaveLength(0);
  });

  it("returns empty array for empty or non-array input", () => {
    expect(groupRubrics([])).toHaveLength(0);
    expect(groupRubrics(undefined as unknown as unknown[])).toHaveLength(0);
  });

  it("does NOT include suggestedFix/causeType/causeSummary (those live on traces)", () => {
    const rows = groupRubrics([
      {
        id: "R2",
        title: "Flag clause",
        verdict: "fail",
        reasoning: "Missed.",
        cause_type: "retrieval_miss",
        suggested_fix: "Increase overlap",
      },
    ]);
    // These fields are removed from RubricRow — they come from analysis.traces
    expect(rows[0]).not.toHaveProperty("causeType");
    expect(rows[0]).not.toHaveProperty("suggestedFix");
    expect(rows[0]).not.toHaveProperty("causeSummary");
  });

  it("produces rubric rows from full fixture page_data.rubrics", () => {
    const pageData = FULL_BUNDLE.page_data;
    const rows = groupRubrics(pageData.rubrics as unknown[]);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("R1");
    expect(rows[0].passed).toBe(true);
    expect(rows[1].id).toBe("R2");
    expect(rows[1].passed).toBe(false);
    // R3 has empty verdict — should be treated as not-passed
    expect(rows[2].id).toBe("R3");
    expect(rows[2].passed).toBe(false);
    expect(rows[2].verdict).toBe("");
  });

  // ─── criterionContested narrowing ──────────────────────────────────────────

  it("carries boolean contested: true as criterionContested", () => {
    const rows = groupRubrics([
      { id: "C1", title: "t", verdict: "fail", contested: true },
    ]);
    expect(rows[0].criterionContested).toBe(true);
  });

  it("carries number contested: 1 as criterionContested", () => {
    const rows = groupRubrics([
      { id: "C2", title: "t", verdict: "fail", contested: 1 },
    ]);
    expect(rows[0].criterionContested).toBe(1);
  });

  it("carries string contested: 'true' as criterionContested", () => {
    const rows = groupRubrics([
      { id: "C3", title: "t", verdict: "pass", contested: "true" },
    ]);
    expect(rows[0].criterionContested).toBe("true");
  });

  it("carries boolean contested: false as criterionContested", () => {
    const rows = groupRubrics([
      { id: "C4", title: "t", verdict: "fail", contested: false },
    ]);
    expect(rows[0].criterionContested).toBe(false);
  });

  it("omits criterionContested when wire contested is an object (narrowing rejects it)", () => {
    const rows = groupRubrics([
      { id: "C5", title: "t", verdict: "fail", contested: { nested: true } },
    ]);
    expect(rows[0].criterionContested).toBeUndefined();
  });

  it("omits criterionContested when wire contested is an array (narrowing rejects it)", () => {
    const rows = groupRubrics([
      { id: "C6", title: "t", verdict: "fail", contested: ["true"] },
    ]);
    expect(rows[0].criterionContested).toBeUndefined();
  });

  it("omits criterionContested when wire contested is absent", () => {
    const rows = groupRubrics([
      { id: "C7", title: "t", verdict: "fail" },
    ]);
    expect(rows[0].criterionContested).toBeUndefined();
  });

  // ─── judgeFlagBasis narrowing ───────────────────────────────────────────────

  it("carries string flag_basis as judgeFlagBasis", () => {
    const rows = groupRubrics([
      { id: "D1", title: "t", verdict: "fail", flag_basis: "criterion_validity" },
    ]);
    expect(rows[0].judgeFlagBasis).toBe("criterion_validity");
  });

  it("carries empty-string flag_basis as judgeFlagBasis (asString passes empty strings)", () => {
    const rows = groupRubrics([
      { id: "D2", title: "t", verdict: "fail", flag_basis: "" },
    ]);
    // asString("") returns "" which is not null, so judgeFlagBasis is set to ""
    expect(rows[0].judgeFlagBasis).toBe("");
  });

  it("omits judgeFlagBasis when wire flag_basis is absent", () => {
    const rows = groupRubrics([
      { id: "D3", title: "t", verdict: "fail" },
    ]);
    expect(rows[0].judgeFlagBasis).toBeUndefined();
  });

  it("omits judgeFlagBasis when wire flag_basis is an object (asString rejects it)", () => {
    const rows = groupRubrics([
      { id: "D4", title: "t", verdict: "fail", flag_basis: { nested: true } },
    ]);
    expect(rows[0].judgeFlagBasis).toBeUndefined();
  });

  it("omits judgeFlagBasis when wire flag_basis is an array (asString rejects it)", () => {
    const rows = groupRubrics([
      { id: "D5", title: "t", verdict: "fail", flag_basis: ["judge_error"] },
    ]);
    expect(rows[0].judgeFlagBasis).toBeUndefined();
  });

  it("carries unknown flag_basis tokens verbatim as judgeFlagBasis", () => {
    const rows = groupRubrics([
      { id: "D6", title: "t", verdict: "fail", flag_basis: "some_unknown_basis" },
    ]);
    expect(rows[0].judgeFlagBasis).toBe("some_unknown_basis");
  });
});

describe("aggregateFixes", () => {
  it("groups failing rubrics (causeType is always uncategorized now — sourced from traces)", () => {
    const fixes = aggregateFixes([
      { id: "R1", title: "a", passed: false, verdict: "fail", reasoning: "" },
      { id: "R2", title: "b", passed: false, verdict: "fail", reasoning: "" },
      { id: "R3", title: "c", passed: true, verdict: "pass", reasoning: "" },
    ]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].count).toBe(2);
    expect(fixes[0].rubricIds).toEqual(["R1", "R2"]);
    expect(fixes[0].causeType).toBe("uncategorized");
  });

  it("skips passed rubrics", () => {
    const fixes = aggregateFixes([
      { id: "R1", title: "a", passed: true, verdict: "pass", reasoning: "" },
    ]);
    expect(fixes).toHaveLength(0);
  });
});

describe("computeStats", () => {
  const base = {
    sourceDocs: [1, 2],
    workfiles: [1],
    traces: [1, 2, 3],
    branches: ["b1", "b2"],
    timeline: [1, 2, 3, 4],
    agents: [1, 2],
    rubricRows: [],
  };

  it("emits stepCount, noteCount, agentCount instead of branchCount", () => {
    const stats = computeStats({
      ...base,
      rubricRows: [
        { id: "R1", title: "", passed: true, verdict: "pass", reasoning: "" },
        { id: "R2", title: "", passed: false, verdict: "fail", reasoning: "" },
      ],
    });
    expect(stats).toMatchObject({
      sourceDocCount: 2,
      workfileCount: 1,
      traceCount: 3,
      noteCount: 2,   // branches.length
      stepCount: 4,   // timeline.length
      agentCount: 2,  // agents.length
      rubricCount: 2,
      passCount: 1,
      failCount: 1,
    });
    // branchCount is gone — no longer in the stats shape
    expect((stats as unknown as Record<string, unknown>).branchCount).toBeUndefined();
  });

  it("returns null (not 0) when no rubrics ran at all", () => {
    const stats = computeStats({ ...base, rubricRows: [] });
    expect(stats.passCount).toBeNull();
    expect(stats.failCount).toBeNull();
  });

  it("stepCount is timeline.length, noteCount is branches.length, agentCount is agents.length", () => {
    const stats = computeStats({
      ...base,
      branches: ["n1", "n2", "n3"],
      timeline: [1, 2, 3, 4, 5, 6],
      agents: [1],
      rubricRows: [],
    });
    expect(stats.noteCount).toBe(3);
    expect(stats.stepCount).toBe(6);
    expect(stats.agentCount).toBe(1);
  });
});

describe("buildTimeline", () => {
  const TIMELINE: TimelineStep[] = FULL_BUNDLE.page_data.timeline as TimelineStep[];
  const AGENTS = FULL_BUNDLE.page_data.agents as unknown[];

  it("converts timeline steps to {name, startMs, endMs} entries", () => {
    const entries = buildTimeline(TIMELINE, []);
    expect(entries.length).toBe(TIMELINE.length);
    for (const entry of entries) {
      expect(typeof entry.name).toBe("string");
      // All steps in the full fixture have valid timestamps
      expect(entry.startMs).not.toBeNull();
      expect(entry.endMs).not.toBeNull();
    }
  });

  it("dedups 1:1 launch agents and keeps fan-out agents as extra rows", () => {
    // full fixture: both agents are 1:1 with steps already on the timeline —
    // their rows would duplicate the step bars (run_draft / draft, twice)
    const deduped = buildTimeline(TIMELINE, AGENTS);
    expect(deduped.length).toBe(TIMELINE.length);
    expect(deduped.some((e) => e.name === "cross_check_agent")).toBe(false);

    // a fan-out step (several agents per step) adds one row per agent
    const fanout = [
      { name: "ingest: a.docx", step: "foreach_ingest", start: "2026-08-10 14:28:12.000", end: "2026-08-10 14:28:20.000" },
      { name: "ingest: b.docx", step: "foreach_ingest", start: "2026-08-10 14:28:13.000", end: "2026-08-10 14:28:25.000" },
    ];
    expect(buildTimeline(TIMELINE, fanout).length).toBe(TIMELINE.length + 2);

    // an agent whose step is unknown to the timeline keeps its row too
    const stray = [{ name: "judge", step: "not_on_timeline", start: null, end: null }];
    expect(buildTimeline(TIMELINE, stray).length).toBe(TIMELINE.length + 1);
  });

  it("interleaves rows chronologically by start time", () => {
    const fanout = [
      { name: "ingest: a.docx", step: "foreach_ingest", start: "2026-08-10 14:28:12.000", end: "2026-08-10 14:28:20.000" },
    ];
    const entries = buildTimeline(TIMELINE, fanout);
    const timed = entries.filter((e) => e.startMs != null);
    for (let i = 1; i < timed.length; i++) {
      expect(timed[i - 1].startMs! <= timed[i].startMs!).toBe(true);
    }
    // the fan-out row lands right after check_documents, not appended at the end
    expect(entries[1].name).toBe("ingest: a.docx");
  });

  it("feeds buildGantt with at least one non-other phase for the full fixture", () => {
    const entries = buildTimeline(TIMELINE, AGENTS);
    const gantt = buildGantt(entries);
    expect(gantt).not.toBeNull();
    // At least one bar must have a phase other than "other"
    const nonOther = gantt!.bars.filter((b) => b.phase !== "other");
    expect(nonOther.length).toBeGreaterThan(0);
  });

  it("produces at least one pair of overlapping spans when a step fans out", () => {
    const fanout = [
      { name: "ingest: a.docx", step: "foreach_ingest", start: "2026-08-10 14:28:12.000", end: "2026-08-10 14:28:20.000" },
      { name: "ingest: b.docx", step: "foreach_ingest", start: "2026-08-10 14:28:13.000", end: "2026-08-10 14:28:25.000" },
    ];
    const entries = buildTimeline(TIMELINE, fanout);
    const valid = entries.filter(
      (e): e is { name: string; startMs: number; endMs: number } =>
        e.startMs != null && e.endMs != null,
    );
    // Find any pair where spans overlap: one starts before the other ends
    let hasOverlap = false;
    for (let i = 0; i < valid.length && !hasOverlap; i++) {
      for (let j = i + 1; j < valid.length && !hasOverlap; j++) {
        const a = valid[i];
        const b = valid[j];
        if (a.startMs < b.endMs && b.startMs < a.endMs) {
          hasOverlap = true;
        }
      }
    }
    expect(hasOverlap).toBe(true);
  });

  it("returns null startMs/endMs for entries with no valid timestamps", () => {
    const badTimeline: TimelineStep[] = [
      { step: "some_step", start: null, end: null, duration_s: 5 },
    ];
    const entries = buildTimeline(badTimeline, []);
    expect(entries[0].startMs).toBeNull();
    expect(entries[0].endMs).toBeNull();
  });

  it("ignores duration_s as a timestamp (would be below the year-2000 floor)", () => {
    // duration_s values like 57.109 must NOT be passed to toEpochMs as
    // timestamps — only start/end strings are timestamps.
    const tlStep: TimelineStep = {
      step: "run_cross_check_agent",
      start: "2026-08-10 14:28:44.771",
      end: "2026-08-10 14:29:41.880",
      duration_s: 57.109,
    };
    const entries = buildTimeline([tlStep], []);
    expect(entries[0].startMs).not.toBeNull();
    expect(entries[0].endMs).not.toBeNull();
    // The duration_s is not used as a timestamp; startMs/endMs are from start/end
    expect(entries[0].startMs).toBe(toEpochMs("2026-08-10 14:28:44.771"));
  });
});

describe("readTraces", () => {
  it("extracts TraceRow[] from analysis following TRACE_SCHEMA", () => {
    const analysis = FULL_BUNDLE.analysis;
    const traces = readTraces(analysis);
    expect(traces).toHaveLength(2);
    expect(traces[0].rubric_id).toBe("R2");
    expect(traces[0].pathway.length).toBeGreaterThan(0);
    expect(traces[0].q_ingested_to_graph).not.toBeNull();
    expect(traces[0].q_draft_got_it?.answer).toBe("no");
    expect(traces[0].root_cause).toContain("Chunk-boundary");
    expect(traces[0].fix_suggestions.length).toBeGreaterThan(0);
  });

  it("returns empty array for missing or empty analysis", () => {
    expect(readTraces({})).toHaveLength(0);
    expect(readTraces({ traces: [] })).toHaveLength(0);
    expect(readTraces(null)).toHaveLength(0);
    expect(readTraces(undefined)).toHaveLength(0);
  });

  it("skips entries without a rubric_id", () => {
    const traces = readTraces({ traces: [{ pathway: [], root_cause: "x" }] });
    expect(traces).toHaveLength(0);
  });
});

describe("readSummaries", () => {
  it("extracts AgentSummary[] from analysis following SUMMARY_SCHEMA", () => {
    const summaries = readSummaries(FULL_BUNDLE.analysis);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].agent_name).toBe("cross_check_agent");
    expect(summaries[0].mission).toContain("NDA");
    expect(summaries[0].tools.length).toBeGreaterThan(0);
    expect(summaries[0].key_findings.length).toBeGreaterThan(0);
    expect(summaries[0].failed_rubric_relevance[0].rubric_id).toBe("R2");
  });

  it("returns empty array for missing or empty analysis", () => {
    expect(readSummaries({})).toHaveLength(0);
    expect(readSummaries({ summaries: [] })).toHaveLength(0);
    expect(readSummaries(null)).toHaveLength(0);
  });

  it("skips entries without agent_name", () => {
    const summaries = readSummaries({ summaries: [{ mission: "x" }] });
    expect(summaries).toHaveLength(0);
  });
});

describe("readSynthesis", () => {
  it("extracts ConceptSynthesis from populated concepts", () => {
    const synthesis = readSynthesis(FULL_BUNDLE.concepts);
    expect(synthesis).not.toBeNull();
    expect(synthesis!.overall_narrative).toContain("chunking");
    expect(synthesis!.concept_matrix.length).toBeGreaterThan(0);
    expect(synthesis!.relation_to_failures[0].rubric_id).toBe("R2");
    expect(synthesis!.recommendations.length).toBeGreaterThan(0);
  });

  it("returns null when concepts is {} (not-run default)", () => {
    expect(readSynthesis({})).toBeNull();
  });

  it("returns null when concepts.synthesis is absent", () => {
    expect(readSynthesis({ per_agent: [] })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(readSynthesis(null)).toBeNull();
    expect(readSynthesis(undefined)).toBeNull();
    expect(readSynthesis("string")).toBeNull();
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
    const index = flattenText(SPLIT);
    expect(() =>
      findHighlightRanges(index, ["(a+)+$", "[[[", "\\", "*.*", "(?<x>y)"]),
    ).not.toThrow();
  });

  it("caps token count", () => {
    const index = flattenText(SPLIT);
    const filler = Array.from({ length: MAX_HIGHLIGHT_TOKENS + 10 }, (_, i) => `zz${i}`);
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
