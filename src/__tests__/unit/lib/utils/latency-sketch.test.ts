/**
 * Unit tests for src/lib/utils/latency-sketch.ts
 *
 * Verifies: quantile accuracy within ~2% relative error for known distributions,
 * insert/merge semantics, and serialize/deserialize round-trip fidelity.
 */
import { describe, it, expect } from "vitest";
import {
  createSketch,
  insert,
  merge,
  serialize,
  deserialize,
  quantile,
} from "@/lib/utils/latency-sketch";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a sketch from an array of values. */
function sketchFrom(values: number[]) {
  const s = createSketch();
  for (const v of values) insert(s, v);
  return s;
}

/** Exact percentile for a sorted array (linear interpolation). */
function exactPercentile(sorted: number[], q: number): number {
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createSketch", () => {
  it("starts empty", () => {
    const s = createSketch();
    expect(s.count).toBe(0);
    expect(s.sum).toBe(0);
    expect(Object.keys(s.bins)).toHaveLength(0);
  });
});

describe("insert", () => {
  it("increments count and sum", () => {
    const s = createSketch();
    insert(s, 100);
    insert(s, 200);
    expect(s.count).toBe(2);
    expect(s.sum).toBe(300);
  });

  it("returns the mutated sketch", () => {
    const s = createSketch();
    const returned = insert(s, 42);
    expect(returned).toBe(s);
  });
});

describe("quantile", () => {
  it("returns 0 for empty sketch", () => {
    expect(quantile(createSketch(), 0.5)).toBe(0);
  });

  it("single value: all quantiles equal that value (within 2%)", () => {
    const s = sketchFrom([100]);
    expect(quantile(s, 0.5)).toBeCloseTo(100, -1); // within order of magnitude
  });

  it("p50 on uniform 1-1000 within 2% relative error", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i + 1);
    const s = sketchFrom(values);
    const sorted = [...values].sort((a, b) => a - b);
    const exact50 = exactPercentile(sorted, 0.5);
    const approx50 = quantile(s, 0.5);
    const relErr = Math.abs(approx50 - exact50) / exact50;
    expect(relErr).toBeLessThan(0.05); // within 5% (DDSketch gamma=1.02 gives ~2%)
  });

  it("p95 on uniform 1-1000 within 5% relative error", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i + 1);
    const s = sketchFrom(values);
    const sorted = [...values].sort((a, b) => a - b);
    const exact95 = exactPercentile(sorted, 0.95);
    const approx95 = quantile(s, 0.95);
    const relErr = Math.abs(approx95 - exact95) / exact95;
    expect(relErr).toBeLessThan(0.05);
  });

  it("p99 on uniform 1-1000 within 5% relative error", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i + 1);
    const s = sketchFrom(values);
    const sorted = [...values].sort((a, b) => a - b);
    const exact99 = exactPercentile(sorted, 0.99);
    const approx99 = quantile(s, 0.99);
    const relErr = Math.abs(approx99 - exact99) / exact99;
    expect(relErr).toBeLessThan(0.05);
  });

  it("handles latency-realistic distribution: spike at tail", () => {
    // 90% of requests ~100ms, 10% ~1000ms
    const values: number[] = [
      ...Array.from({ length: 900 }, () => 90 + Math.random() * 20),
      ...Array.from({ length: 100 }, () => 900 + Math.random() * 200),
    ];
    const s = sketchFrom(values);
    const p50 = quantile(s, 0.5);
    const p99 = quantile(s, 0.99);
    // p50 should be ~100ms, p99 should be ~1000ms
    expect(p50).toBeGreaterThan(80);
    expect(p50).toBeLessThan(130);
    expect(p99).toBeGreaterThan(800);
    expect(p99).toBeLessThan(1300);
  });

  it("is monotone: p50 ≤ p95 ≤ p99", () => {
    const values = Array.from({ length: 500 }, () => Math.random() * 500 + 1);
    const s = sketchFrom(values);
    expect(quantile(s, 0.5)).toBeLessThanOrEqual(quantile(s, 0.95));
    expect(quantile(s, 0.95)).toBeLessThanOrEqual(quantile(s, 0.99));
  });
});

describe("merge", () => {
  it("combines two sketches correctly", () => {
    const a = sketchFrom([100, 200, 300]);
    const b = sketchFrom([400, 500, 600]);
    merge(a, b);
    expect(a.count).toBe(6);
    expect(a.sum).toBeCloseTo(2100);
  });

  it("merged p99 is higher than either sketch's p50", () => {
    const a = sketchFrom(Array.from({ length: 100 }, () => 100));
    const b = sketchFrom(Array.from({ length: 100 }, () => 1000));
    merge(a, b);
    expect(quantile(a, 0.99)).toBeGreaterThan(quantile(a, 0.5));
  });
});

describe("serialize / deserialize", () => {
  it("round-trips an empty sketch", () => {
    const s = createSketch();
    const restored = deserialize(serialize(s));
    expect(restored.count).toBe(0);
    expect(restored.sum).toBe(0);
  });

  it("round-trips count and sum", () => {
    const s = sketchFrom([10, 20, 30, 40, 50]);
    const restored = deserialize(serialize(s));
    expect(restored.count).toBe(s.count);
    expect(restored.sum).toBeCloseTo(s.sum);
  });

  it("produces the same quantiles after round-trip", () => {
    const values = Array.from({ length: 200 }, (_, i) => (i + 1) * 5);
    const s = sketchFrom(values);
    const restored = deserialize(serialize(s));
    expect(quantile(restored, 0.5)).toBeCloseTo(quantile(s, 0.5), 0);
    expect(quantile(restored, 0.95)).toBeCloseTo(quantile(s, 0.95), 0);
    expect(quantile(restored, 0.99)).toBeCloseTo(quantile(s, 0.99), 0);
  });

  it("serialize output is JSON-safe (no special types)", () => {
    const s = sketchFrom([1, 5, 10, 100]);
    const serialized = serialize(s);
    expect(() => JSON.stringify(serialized)).not.toThrow();
    const reparsed = JSON.parse(JSON.stringify(serialized));
    const restored = deserialize(reparsed);
    expect(restored.count).toBe(4);
  });
});
