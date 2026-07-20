/**
 * Unit tests for the hill-climb extensions to eval-normalizers.ts:
 * - normalizeOutput: surfaces n_passed/n_total/date_added_to_graph/id, with judge_notes fallback
 * - sortAttemptsChronologically: Option A (date_added_to_graph) and Option B (id suffix)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeOutput,
  sortAttemptsChronologically,
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
