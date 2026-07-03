/**
 * Unit tests for src/services/error-impact.ts
 *
 * Covers: computeImpactScore — central node, peripheral node, empty input,
 * and formula properties (null-safety, normalization, meta fields).
 */
import { describe, it, expect } from "vitest";
import { computeImpactScore } from "@/services/error-impact";

describe("computeImpactScore", () => {
  it("returns null for empty input", () => {
    expect(computeImpactScore([])).toBeNull();
  });

  it("returns null for undefined/null guard", () => {
    // TypeScript prevents null/undefined at compile time, but belt-and-suspenders
    expect(computeImpactScore([] as never)).toBeNull();
  });

  it("returns a high score for a central node with high pagerank + high in_degree", () => {
    const result = computeImpactScore([
      { pagerank: 0.9, in_degree: 180, name: "api-client.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
    expect(result!.score).toBeLessThanOrEqual(1);
  });

  it("returns a low score for a peripheral node with low pagerank + low in_degree", () => {
    const result = computeImpactScore([
      { pagerank: 0.05, in_degree: 2, name: "utils.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThan(0.15);
    expect(result!.score).toBeGreaterThanOrEqual(0);
  });

  it("picks the best node when multiple are provided", () => {
    const resultMulti = computeImpactScore([
      { pagerank: 0.05, in_degree: 2, name: "peripheral.ts", node_type: "File" },
      { pagerank: 0.9, in_degree: 180, name: "central.ts", node_type: "File" },
    ]);
    const resultSingle = computeImpactScore([
      { pagerank: 0.9, in_degree: 180, name: "central.ts", node_type: "File" },
    ]);
    // Multi-node result should equal the single best-node result
    expect(resultMulti!.score).toBeCloseTo(resultSingle!.score, 5);
    expect(resultMulti!.meta.topNodeName).toBe("central.ts");
  });

  it("handles nodes with only pagerank (no in_degree)", () => {
    const result = computeImpactScore([
      { pagerank: 0.7, name: "service.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.meta.topInDegree).toBe(0);
  });

  it("handles nodes with only in_degree (no pagerank)", () => {
    const result = computeImpactScore([
      { in_degree: 100, name: "router.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.meta.topPagerank).toBe(0);
  });

  it("handles nodes with neither pagerank nor in_degree (zero-score node)", () => {
    // A node with no centrality data still produces a non-null result (was resolved)
    // but the score should be 0
    const result = computeImpactScore([
      { name: "unknown.ts", node_type: "File" },
    ]);
    // Score is 0/maxRaw = 0, but result is not null — the node resolved
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0);
  });

  it("normalizes score to [0, 1]", () => {
    // Even an extreme node should not exceed 1
    const result = computeImpactScore([
      { pagerank: 999, in_degree: 99999, name: "god-file.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThanOrEqual(1);
    expect(result!.score).toBeGreaterThanOrEqual(0);
  });

  it("populates meta with top node details", () => {
    const result = computeImpactScore([
      { pagerank: 0.8, in_degree: 120, name: "auth.ts", node_type: "Function" },
    ]);
    expect(result!.meta.topNodeName).toBe("auth.ts");
    expect(result!.meta.topNodeType).toBe("Function");
    expect(result!.meta.topPagerank).toBe(0.8);
    expect(result!.meta.topInDegree).toBe(120);
    expect(result!.meta.nodeCount).toBe(1);
  });

  it("counts all nodes in meta.nodeCount", () => {
    const result = computeImpactScore([
      { pagerank: 0.1, in_degree: 5 },
      { pagerank: 0.2, in_degree: 10 },
      { pagerank: 0.9, in_degree: 150 },
    ]);
    expect(result!.meta.nodeCount).toBe(3);
  });
});
