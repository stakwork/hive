/**
 * Unit tests for normalizeOutput and sortAttemptsChronologically
 * in src/lib/harvey-lab/eval-normalizers.ts
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeOutput,
  sortAttemptsChronologically,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";

// ── normalizeOutput ───────────────────────────────────────────────────────────

describe("normalizeOutput", () => {
  it("returns null for a node with no ref_id", () => {
    const node = { ref_id: "", properties: { result: "pass", score: 1 } };
    expect(normalizeOutput(node)).toBeNull();
  });

  it("maps basic fields from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-1",
      properties: {
        attempt_number: 2,
        result: "pass",
        score: 0.87,
        judge_notes: "Looks good",
      },
    };
    const out = normalizeOutput(node)!;
    expect(out.ref_id).toBe("out-1");
    expect(out.attempt_number).toBe(2);
    expect(out.result).toBe("pass");
    expect(out.score).toBe(0.87);
    expect(out.judge_notes).toBe("Looks good");
  });

  it("reads n_passed and n_total from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-2",
      properties: { result: "pass", score: 1, n_passed: 28, n_total: 42 },
    };
    const out = normalizeOutput(node)!;
    expect(out.n_passed).toBe(28);
    expect(out.n_total).toBe(42);
  });

  it("leaves n_passed/n_total undefined when absent from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-3",
      properties: { result: "fail", score: 0 },
    };
    const out = normalizeOutput(node)!;
    expect(out.n_passed).toBeUndefined();
    expect(out.n_total).toBeUndefined();
  });

  it("reads id from properties", () => {
    const node: RawJarvisNode = {
      ref_id: "out-4",
      properties: { result: "pass", score: 1, id: "antitrust/task-1-src-run-abc--100001" },
    };
    const out = normalizeOutput(node)!;
    expect(out.id).toBe("antitrust/task-1-src-run-abc--100001");
  });

  it("reads top-level date_added_to_graph", () => {
    const node: RawJarvisNode = {
      ref_id: "out-5",
      properties: { result: "pass", score: 1 },
      date_added_to_graph: "1720000000",
    };
    const out = normalizeOutput(node)!;
    expect(out.date_added_to_graph).toBe("1720000000");
  });

  it("defaults to safe values when properties are absent", () => {
    const node: RawJarvisNode = { ref_id: "out-6" };
    const out = normalizeOutput(node)!;
    expect(out.attempt_number).toBe(0);
    expect(out.result).toBe("");
    expect(out.score).toBe(0);
    expect(out.judge_notes).toBeUndefined();
  });
});

// ── sortAttemptsChronologically ───────────────────────────────────────────────

function makeOutput(overrides: Partial<EvalTriggerOutput> = {}): EvalTriggerOutput {
  return {
    ref_id: `out-${Math.random()}`,
    attempt_number: 0,
    result: "pass",
    score: 1,
    n_passed: 10,
    n_total: 20,
    ...overrides,
  };
}

describe("sortAttemptsChronologically", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Option A: date_added_to_graph path ─────────────────────────────────

  it("returns a shallow copy — does not mutate the input", () => {
    const outputs = [
      makeOutput({ date_added_to_graph: "1720172800" }),
      makeOutput({ date_added_to_graph: "1720000000" }),
    ];
    const copy = [...outputs];
    sortAttemptsChronologically(outputs);
    expect(outputs[0]).toBe(copy[0]); // original order unchanged
  });

  it("sorts ascending by date_added_to_graph when all present (Option A)", () => {
    const a = makeOutput({ date_added_to_graph: "1720000000", n_passed: 14 });
    const b = makeOutput({ date_added_to_graph: "1720086400", n_passed: 28 });
    const c = makeOutput({ date_added_to_graph: "1720172800", n_passed: 38 });

    // Pass in reverse order
    const sorted = sortAttemptsChronologically([c, a, b]);
    expect(sorted[0].n_passed).toBe(14);
    expect(sorted[1].n_passed).toBe(28);
    expect(sorted[2].n_passed).toBe(38);
  });

  it("baseline is first when sorted by date_added_to_graph", () => {
    const baseline = makeOutput({ date_added_to_graph: "1710000000", n_passed: 5 });
    const rerun1 = makeOutput({ date_added_to_graph: "1720000000", n_passed: 15 });
    const sorted = sortAttemptsChronologically([rerun1, baseline]);
    expect(sorted[0]).toBe(baseline);
    expect(sorted[1]).toBe(rerun1);
  });

  it("returns a single-element array unchanged", () => {
    const outputs = [makeOutput({ date_added_to_graph: "1720000000" })];
    const sorted = sortAttemptsChronologically(outputs);
    expect(sorted).toHaveLength(1);
  });

  // ── Option B: id-suffix fallback path ─────────────────────────────────

  it("falls back to id-suffix ordering when date_added_to_graph is absent (Option B)", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const baseline = makeOutput({ id: "task-1-src-run-abc", n_passed: 14 }); // no --suffix
    const rerun1 = makeOutput({ id: "task-1-src-run-abc--100001", n_passed: 28 });
    const rerun2 = makeOutput({ id: "task-1-src-run-abc--100002", n_passed: 38 });

    const sorted = sortAttemptsChronologically([rerun2, baseline, rerun1]);
    expect(sorted[0].n_passed).toBe(14); // baseline (no suffix)
    expect(sorted[1].n_passed).toBe(28); // rerun 1
    expect(sorted[2].n_passed).toBe(38); // rerun 2

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("warns when falling back to id-suffix ordering", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const a = makeOutput({ id: "t-run--1" });
    const b = makeOutput({ id: "t-run" });
    sortAttemptsChronologically([a, b]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("date_added_to_graph"),
    );
  });

  it("baseline (no -- suffix) sorts before reruns in id-suffix fallback", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const baseline = makeOutput({ id: "slug-runid" });
    const rerun = makeOutput({ id: "slug-runid--999" });

    const sorted = sortAttemptsChronologically([rerun, baseline]);
    expect(sorted[0]).toBe(baseline);

    consoleSpy.mockRestore();
  });

  it("handles empty array", () => {
    expect(sortAttemptsChronologically([])).toEqual([]);
  });
});
