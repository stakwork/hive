/**
 * Unit tests for the hill-climb extensions to eval-normalizers.ts:
 * - normalizeOutput: surfaces n_passed/n_total/date_added_to_graph/id, with judge_notes fallback
 * - sortAttemptsChronologically: Option A (date_added_to_graph) and Option B (id suffix)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeOutput,
  sortAttemptsChronologically,
  resolveJudgeDispute,
  JUDGE_DISPUTE_NO_PROSE_MARKER,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";

// ─── normalizeOutput ──────────────────────────────────────────────────────────

describe("normalizeOutput", () => {
  it("returns null for a node without ref_id", () => {
    expect(normalizeOutput({ ref_id: "" })).toBeNull();
  });

  it("surfaces n_passed and n_total from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-1",
      properties: { n_passed: 28, n_total: 42, result: "pass", score: 0.67 },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBe(28);
    expect(out?.n_total).toBe(42);
  });

  it("coerces string n_passed/n_total to numbers", () => {
    const node: RawJarvisNode = {
      ref_id: "out-2",
      properties: { n_passed: "34", n_total: "42" },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBe(34);
    expect(out?.n_total).toBe(42);
  });

  it("surfaces date_added_to_graph from top-level node field", () => {
    const node: RawJarvisNode = {
      ref_id: "out-3",
      date_added_to_graph: "1720000000",
      properties: { n_passed: 10, n_total: 20 },
    };
    const out = normalizeOutput(node);
    expect(out?.date_added_to_graph).toBe("1720000000");
  });

  it("surfaces id from properties.id", () => {
    const node: RawJarvisNode = {
      ref_id: "out-4",
      properties: { id: "task-slug-run-123", n_passed: 5, n_total: 10 },
    };
    const out = normalizeOutput(node);
    expect(out?.id).toBe("task-slug-run-123");
  });

  it("surfaces report_url from properties when it is an http(s) URL", () => {
    const node: RawJarvisNode = {
      ref_id: "out-r1",
      properties: { n_passed: 5, n_total: 10, report_url: "https://example.com/report/1" },
    };
    expect(normalizeOutput(node)?.report_url).toBe("https://example.com/report/1");
  });

  it("trims surrounding whitespace on report_url", () => {
    const node: RawJarvisNode = {
      ref_id: "out-r2",
      properties: { report_url: "  https://example.com/report/2  " },
    };
    expect(normalizeOutput(node)?.report_url).toBe("https://example.com/report/2");
  });

  it("drops report_url when it is not an http(s) URL", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://example.com/x",
      "example.com/no-scheme",
      "",
      "   ",
      42,
      { url: "https://example.com" },
      null,
    ]) {
      const node: RawJarvisNode = {
        ref_id: "out-r3",
        properties: { report_url: bad },
      };
      expect(normalizeOutput(node)?.report_url).toBeUndefined();
    }
  });

  it("leaves report_url undefined when absent", () => {
    const node: RawJarvisNode = { ref_id: "out-r4", properties: { n_passed: 1, n_total: 2 } };
    expect(normalizeOutput(node)?.report_url).toBeUndefined();
  });

  it("falls back to judge_notes parse when n_passed/n_total absent from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-5",
      properties: {
        result: "pass",
        score: 0.9,
        judge_notes: "38/42 criteria passed — well done.",
      },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBe(38);
    expect(out?.n_total).toBe(42);
  });

  it("falls back when judge_notes uses uppercase 'Criteria Passed'", () => {
    const node: RawJarvisNode = {
      ref_id: "out-6",
      properties: { judge_notes: "10/20 Criteria Passed in this run" },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBe(10);
    expect(out?.n_total).toBe(20);
  });

  it("leaves n_passed/n_total undefined when absent from both properties and judge_notes", () => {
    const node: RawJarvisNode = {
      ref_id: "out-7",
      properties: { result: "pass", score: 0.5 },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBeUndefined();
    expect(out?.n_total).toBeUndefined();
  });

  it("does not set n_passed/n_total if judge_notes has no match pattern", () => {
    const node: RawJarvisNode = {
      ref_id: "out-8",
      properties: { judge_notes: "Everything looks great!" },
    };
    const out = normalizeOutput(node);
    expect(out?.n_passed).toBeUndefined();
    expect(out?.n_total).toBeUndefined();
  });

  it("still returns n_passed/n_total from properties when n_passed is 0", () => {
    const node: RawJarvisNode = {
      ref_id: "out-9",
      properties: { n_passed: 0, n_total: 10 },
    };
    const out = normalizeOutput(node);
    // n_passed = 0, n_total = 10 → should NOT fall back to judge_notes
    expect(out?.n_passed).toBe(0);
    expect(out?.n_total).toBe(10);
  });

  it("preserves existing fields (ref_id, result, score, attempt_number)", () => {
    const node: RawJarvisNode = {
      ref_id: "out-10",
      properties: { result: "fail", score: 0.3, attempt_number: 2, n_passed: 3, n_total: 10 },
    };
    const out = normalizeOutput(node);
    expect(out?.ref_id).toBe("out-10");
    expect(out?.result).toBe("fail");
    expect(out?.score).toBeCloseTo(0.3);
    expect(out?.attempt_number).toBe(2);
  });

  it("does NOT set date_added_to_graph when absent from node", () => {
    const node: RawJarvisNode = {
      ref_id: "out-11",
      properties: { n_passed: 5, n_total: 10 },
    };
    const out = normalizeOutput(node);
    expect(out?.date_added_to_graph).toBeUndefined();
  });

  it("does NOT set id when absent from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-12",
      properties: {},
    };
    const out = normalizeOutput(node);
    expect(out?.id).toBeUndefined();
  });
});

// ─── sortAttemptsChronologically ─────────────────────────────────────────────

function makeOutput(overrides: Partial<EvalTriggerOutput>): EvalTriggerOutput {
  return {
    ref_id: "out",
    attempt_number: 1,
    result: "pass",
    score: 0.8,
    n_passed: 10,
    n_total: 20,
    ...overrides,
  };
}

describe("sortAttemptsChronologically", () => {
  it("returns an empty array for empty input", () => {
    expect(sortAttemptsChronologically([])).toEqual([]);
  });

  describe("Option A — sort by date_added_to_graph when all present", () => {
    it("sorts ascending by Unix-epoch timestamp", () => {
      const a = makeOutput({ ref_id: "a", date_added_to_graph: "1720172800", n_passed: 38 });
      const b = makeOutput({ ref_id: "b", date_added_to_graph: "1720000000", n_passed: 28 });
      const c = makeOutput({ ref_id: "c", date_added_to_graph: "1720086400", n_passed: 34 });

      const result = sortAttemptsChronologically([a, b, c]);
      expect(result.map((o) => o.ref_id)).toEqual(["b", "c", "a"]);
    });

    it("places the earliest timestamp first (baseline)", () => {
      const baseline = makeOutput({ ref_id: "base", date_added_to_graph: "1720000000" });
      const rerun1 = makeOutput({ ref_id: "rerun1", date_added_to_graph: "1720086400" });
      const rerun2 = makeOutput({ ref_id: "rerun2", date_added_to_graph: "1720172800" });

      const result = sortAttemptsChronologically([rerun2, rerun1, baseline]);
      expect(result[0].ref_id).toBe("base");
      expect(result[1].ref_id).toBe("rerun1");
      expect(result[2].ref_id).toBe("rerun2");
    });

    it("does not mutate the original array", () => {
      const a = makeOutput({ ref_id: "a", date_added_to_graph: "1720172800" });
      const b = makeOutput({ ref_id: "b", date_added_to_graph: "1720000000" });
      const input = [a, b];
      sortAttemptsChronologically(input);
      expect(input[0].ref_id).toBe("a"); // unchanged
    });
  });

  describe("Option B — id-suffix fallback when timestamps missing", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("sorts baseline (no -- suffix) before reruns", () => {
      const base = makeOutput({ ref_id: "b", id: "task-run-abc" }); // no "--"
      const rerun1 = makeOutput({ ref_id: "r1", id: "task-run-abc--57419001" });
      const rerun2 = makeOutput({ ref_id: "r2", id: "task-run-abc--57419002" });

      const result = sortAttemptsChronologically([rerun2, rerun1, base]);
      expect(result[0].ref_id).toBe("b");
      expect(result[1].ref_id).toBe("r1");
      expect(result[2].ref_id).toBe("r2");
    });

    it("sorts reruns by numeric suffix ascending", () => {
      const r10 = makeOutput({ ref_id: "r10", id: "slug-run--10" });
      const r2 = makeOutput({ ref_id: "r2", id: "slug-run--2" });
      const r100 = makeOutput({ ref_id: "r100", id: "slug-run--100" });

      const result = sortAttemptsChronologically([r10, r100, r2]);
      expect(result.map((o) => o.ref_id)).toEqual(["r2", "r10", "r100"]);
    });

    it("emits a console.warn when falling back to id-suffix", () => {
      const base = makeOutput({ ref_id: "b", id: "task-run-abc" });
      const rerun = makeOutput({ ref_id: "r", id: "task-run-abc--1" });
      sortAttemptsChronologically([base, rerun]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/id-suffix/i));
    });

    it("handles nodes with no id (sorts to front after baseline-less)", () => {
      const noId = makeOutput({ ref_id: "no-id" });
      const base = makeOutput({ ref_id: "base", id: "task-run" });
      // Both have no timestamp; no-id has suffix -1, base also -1 — order between them is stable
      const result = sortAttemptsChronologically([base, noId]);
      expect(result.length).toBe(2);
    });
  });

  describe("mixed timestamps (not all present) → falls back to Option B", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("uses id-suffix when only some nodes have date_added_to_graph", () => {
      const a = makeOutput({ ref_id: "a", date_added_to_graph: "1720000000", id: "task-run--2" });
      const b = makeOutput({ ref_id: "b", id: "task-run" }); // no timestamp
      const result = sortAttemptsChronologically([a, b]);
      expect(result[0].ref_id).toBe("b"); // baseline (no "--)
      expect(result[1].ref_id).toBe("a");
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  it("does NOT sort by attempt_number", () => {
    // Nodes with ascending attempt_number but descending date_added_to_graph
    // → should sort by date ascending (ignoring attempt_number)
    const a = makeOutput({
      ref_id: "a",
      date_added_to_graph: "1720172800",
      attempt_number: 1, // lower attempt_number but LATER timestamp
    });
    const b = makeOutput({
      ref_id: "b",
      date_added_to_graph: "1720000000",
      attempt_number: 2, // higher attempt_number but EARLIER timestamp
    });
    const result = sortAttemptsChronologically([a, b]);
    // Should be ordered by date: b first (earlier), then a
    expect(result[0].ref_id).toBe("b");
    expect(result[1].ref_id).toBe("a");
  });
});

// ─── resolveJudgeDispute ──────────────────────────────────────────────────────

describe("resolveJudgeDispute", () => {
  const PROSE = "The deliverable cites $15M but the source says $10M — this is a real failure.";

  // ── Verdict gate ────────────────────────────────────────────────────────────
  describe("verdict gate — passed criteria always return null", () => {
    it("returns null for verdict 'pass' even when flagged and prose are both set", () => {
      expect(
        resolveJudgeDispute({ verdict: "pass", flagged: true, llm_flag_reason: PROSE }),
      ).toBeNull();
    });

    it("returns null for verdict 'PASS' (uppercase)", () => {
      expect(
        resolveJudgeDispute({ verdict: "PASS", flagged: true, llm_flag_reason: PROSE }),
      ).toBeNull();
    });

    it("returns null for verdict 'Pass' (mixed case)", () => {
      expect(
        resolveJudgeDispute({ verdict: "Pass", flagged: true }),
      ).toBeNull();
    });
  });

  // ── Happy-path: both fields set ─────────────────────────────────────────────
  it("failed + flagged:true + prose → hasReason:true, displayText is prose", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      llm_flag_reason: PROSE,
    });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(true);
    expect(result!.reason).toBe(PROSE);
    expect(result!.displayText).toBe(PROSE);
  });

  // ── Marked, no usable prose ─────────────────────────────────────────────────
  it("failed + flagged:true + no llm_flag_reason → hasReason:false, displayText is marker", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.reason).toBe("");
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  it("failed + flagged:true + whitespace-only prose → hasReason:false, displayText is marker", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true, llm_flag_reason: "   " });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  // ── Prose only (no flagged) ─────────────────────────────────────────────────
  it("failed + prose only (flagged absent) → hasReason:true, displayText is prose", () => {
    const result = resolveJudgeDispute({ verdict: "fail", llm_flag_reason: PROSE });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(true);
    expect(result!.displayText).toBe(PROSE);
  });

  it("failed + prose only (flagged:false) → hasReason:true, displayText is prose", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: false, llm_flag_reason: PROSE });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(true);
    expect(result!.displayText).toBe(PROSE);
  });

  // ── Neither field present → null ────────────────────────────────────────────
  it("failed + neither flagged nor prose → null", () => {
    expect(resolveJudgeDispute({ verdict: "fail" })).toBeNull();
  });

  it("failed + flagged:false + no prose → null", () => {
    expect(resolveJudgeDispute({ verdict: "fail", flagged: false })).toBeNull();
  });

  it("failed + flagged:0 + no prose → null", () => {
    expect(resolveJudgeDispute({ verdict: "fail", flagged: 0 })).toBeNull();
  });

  // ── Non-string prose handling ───────────────────────────────────────────────
  it("failed + non-string prose (object) + flagged absent → null", () => {
    expect(
      resolveJudgeDispute({ verdict: "fail", llm_flag_reason: { text: "bad" } }),
    ).toBeNull();
  });

  it("failed + non-string prose (object) + flagged:true → hasReason:false, displayText is marker", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      llm_flag_reason: { text: "bad" },
    });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  it("failed + non-string prose (number) + flagged absent → null", () => {
    expect(resolveJudgeDispute({ verdict: "fail", llm_flag_reason: 42 })).toBeNull();
  });

  it("failed + non-string prose (array) + flagged:true → hasReason:false, displayText is marker", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      llm_flag_reason: ["reason one", "reason two"],
    });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  // ── displayText never contains "[object Object]" ────────────────────────────
  it("displayText never contains '[object Object]' for any non-string prose input", () => {
    const nonStringInputs = [
      { text: "oops" },
      ["a", "b"],
      42,
      true,
      null,
      undefined,
    ];
    for (const bad of nonStringInputs) {
      const result = resolveJudgeDispute({
        verdict: "fail",
        flagged: true,
        llm_flag_reason: bad,
      });
      // When flagged:true, we always get a result — it must not contain [object Object]
      expect(result?.displayText).not.toContain("[object Object]");
    }
  });

  // ── Loose truthiness for flagged ────────────────────────────────────────────
  it("flagged:'true' (string) is treated as marked", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: "true" });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  it("flagged:'TRUE' (uppercase string) is treated as marked", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: "TRUE" });
    expect(result).not.toBeNull();
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  it("flagged:1 (number) is treated as marked", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: 1 });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(false);
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  it("flagged:'false' (string) is NOT treated as marked", () => {
    // No prose either → null
    expect(resolveJudgeDispute({ verdict: "fail", flagged: "false" })).toBeNull();
  });

  // ── Whitespace-only prose ───────────────────────────────────────────────────
  it("whitespace-only llm_flag_reason is treated as absent prose", () => {
    // No flagged → null
    expect(
      resolveJudgeDispute({ verdict: "fail", llm_flag_reason: "   \t\n  " }),
    ).toBeNull();
  });

  it("whitespace-only llm_flag_reason with flagged:true → marker, not whitespace string", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true, llm_flag_reason: "\n\n" });
    expect(result!.hasReason).toBe(false);
    expect(result!.reason).toBe("");
    expect(result!.displayText).toBe(JUDGE_DISPUTE_NO_PROSE_MARKER);
  });

  // ── prose is trimmed ────────────────────────────────────────────────────────
  it("trims leading/trailing whitespace from prose in displayText and reason", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      llm_flag_reason: "  the judge overreached  ",
    });
    expect(result!.reason).toBe("the judge overreached");
    expect(result!.displayText).toBe("the judge overreached");
  });

  // ── no verdict field (undefined) ────────────────────────────────────────────
  it("no verdict field at all is treated as non-pass (not gated)", () => {
    const result = resolveJudgeDispute({ flagged: true, llm_flag_reason: PROSE });
    expect(result).not.toBeNull();
    expect(result!.hasReason).toBe(true);
  });

  // ── isDispute field ──────────────────────────────────────────────────────────

  it("isDispute:true when flagged:true", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true, llm_flag_reason: PROSE });
    expect(result!.isDispute).toBe(true);
  });

  it("isDispute:true when flagged:1", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: 1 });
    expect(result!.isDispute).toBe(true);
  });

  it('isDispute:true when flagged:"true" (string)', () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: "true" });
    expect(result!.isDispute).toBe(true);
  });

  it("isDispute:false when only prose present (flagged absent)", () => {
    const result = resolveJudgeDispute({ verdict: "fail", llm_flag_reason: PROSE });
    expect(result).not.toBeNull();
    expect(result!.isDispute).toBe(false);
  });

  it("isDispute:false when flagged:false + prose present", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: false, llm_flag_reason: PROSE });
    expect(result).not.toBeNull();
    expect(result!.isDispute).toBe(false);
  });

  it("flagged:false + no prose → null (marker suppressed, not emitted)", () => {
    expect(resolveJudgeDispute({ verdict: "fail", flagged: false })).toBeNull();
  });

  // ── flagBasis field ──────────────────────────────────────────────────────────

  it("flagBasis is null when flag_basis is absent", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true });
    expect(result!.flagBasis).toBeNull();
  });

  it("flagBasis is null when flag_basis is empty string", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true, flag_basis: "" });
    expect(result!.flagBasis).toBeNull();
  });

  it("flagBasis is null when flag_basis is whitespace-only", () => {
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true, flag_basis: "   " });
    expect(result!.flagBasis).toBeNull();
  });

  it("flagBasis is trimmed and lowercased when flag_basis is a non-empty string", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "  Criterion_Validity  ",
    });
    expect(result!.flagBasis).toBe("criterion_validity");
  });

  it("flagBasis preserves unknown tokens verbatim (lowercased)", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "SOME_UNKNOWN_BASIS",
    });
    expect(result!.flagBasis).toBe("some_unknown_basis");
  });

  it("flagBasis:legitimate_failure does NOT suppress isDispute (basis never suppresses)", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "legitimate_failure",
    });
    expect(result).not.toBeNull();
    expect(result!.isDispute).toBe(true);
    expect(result!.flagBasis).toBe("legitimate_failure");
  });

  it("prose-only result still returns flagBasis:null (no flag_basis input)", () => {
    const result = resolveJudgeDispute({ verdict: "fail", llm_flag_reason: PROSE });
    expect(result!.flagBasis).toBeNull();
  });

  // ── pass-verdict prefix gate ─────────────────────────────────────────────────

  it('verdict:"passed" → null under the prefix gate', () => {
    expect(
      resolveJudgeDispute({ verdict: "passed", flagged: true, llm_flag_reason: PROSE }),
    ).toBeNull();
  });

  it('verdict:" pass" (leading space) → null under the prefix gate', () => {
    expect(
      resolveJudgeDispute({ verdict: " pass", flagged: true, llm_flag_reason: PROSE }),
    ).toBeNull();
  });

  it('verdict:"PASSED" (uppercase) → null under the prefix gate', () => {
    expect(
      resolveJudgeDispute({ verdict: "PASSED", flagged: true, llm_flag_reason: PROSE }),
    ).toBeNull();
  });

  // ── flag_basis canonicalisation ───────────────────────────────────────────────

  it('flag_basis "judgeerror" (unpunctuated) → canonical "judge_error"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "judgeerror",
    });
    expect(result!.flagBasis).toBe("judge_error");
  });

  it('flag_basis "criterionvalidity" (unpunctuated) → canonical "criterion_validity"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "criterionvalidity",
    });
    expect(result!.flagBasis).toBe("criterion_validity");
  });

  it('flag_basis "legitimatefailure" (unpunctuated) → canonical "legitimate_failure"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "legitimatefailure",
    });
    expect(result!.flagBasis).toBe("legitimate_failure");
  });

  it('flag_basis "indeterminate" → canonical "indeterminate" (unchanged — no underscores to add)', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "indeterminate",
    });
    expect(result!.flagBasis).toBe("indeterminate");
  });

  it("underscored tokens are unchanged after canonicalisation", () => {
    for (const token of ["judge_error", "criterion_validity", "legitimate_failure", "indeterminate"]) {
      const result = resolveJudgeDispute({ verdict: "fail", flagged: true, flag_basis: token });
      expect(result!.flagBasis).toBe(token);
    }
  });

  it('hyphenated variant "judge-error" canonicalises to "judge_error"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "judge-error",
    });
    expect(result!.flagBasis).toBe("judge_error");
  });

  it('spaced variant "judge error" canonicalises to "judge_error"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "judge error",
    });
    expect(result!.flagBasis).toBe("judge_error");
  });

  it('hyphenated variant "criterion-validity" canonicalises to "criterion_validity"', () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "criterion-validity",
    });
    expect(result!.flagBasis).toBe("criterion_validity");
  });

  it("unknown token is returned verbatim (lowercased) — not dropped, not coerced", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "SOMETHINGELSE",
    });
    expect(result!.flagBasis).toBe("somethingelse");
  });

  it("unknown token with underscores is returned verbatim (lowercased)", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "SOME_UNKNOWN_BASIS",
    });
    expect(result!.flagBasis).toBe("some_unknown_basis");
  });

  it("isDispute is unaffected by flag_basis value — only flagged gates the badge (regression guard)", () => {
    // flagged=false, flag_basis present → isDispute must be false regardless
    const noFlag = resolveJudgeDispute({
      verdict: "fail",
      flagged: false,
      llm_flag_reason: PROSE,
      flag_basis: "judgeerror",
    });
    expect(noFlag).not.toBeNull();
    expect(noFlag!.isDispute).toBe(false);

    // flagged=true, flag_basis="legitimate_failure" → isDispute must still be true
    const withFlag = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "legitimatefailure",
    });
    expect(withFlag!.isDispute).toBe(true);

    // flagged=true, unknown basis → isDispute must be true
    const unknownBasis = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "somethingelse",
    });
    expect(unknownBasis!.isDispute).toBe(true);
  });

  it("mixed-case unpunctuated token is normalised case-insensitively", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "JudgeError",
    });
    expect(result!.flagBasis).toBe("judge_error");
  });

  it("flag_basis with leading/trailing whitespace is trimmed before canonicalisation", () => {
    const result = resolveJudgeDispute({
      verdict: "fail",
      flagged: true,
      flag_basis: "  judgeerror  ",
    });
    expect(result!.flagBasis).toBe("judge_error");
  });
});
