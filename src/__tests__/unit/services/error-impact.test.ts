/**
 * Unit tests for src/services/error-impact.ts
 *
 * Covers:
 * - computeImpactScore: empty input → null (unscored)
 * - computeImpactScore: central node → high score (pageRank-only)
 * - computeImpactScore: peripheral-only node → low score
 * - computeImpactScore: multiple nodes, best node wins
 * - computeImpactScore: missing pagerank handled gracefully (returns 0, not null)
 * - computeImpactScore: no in_degree or topInDegree in inputs/outputs
 */
import { describe, it, expect } from "vitest";
import { computeImpactScore } from "@/services/error-impact";

describe("computeImpactScore", () => {
  it("returns null for an empty node list (unscored)", () => {
    expect(computeImpactScore([])).toBeNull();
  });

  it("returns null for undefined/falsy input", () => {
    // @ts-expect-error intentional bad input
    expect(computeImpactScore(null)).toBeNull();
    // @ts-expect-error intentional bad input
    expect(computeImpactScore(undefined)).toBeNull();
  });

  it("returns a high score for a central node (high pagerank)", () => {
    const result = computeImpactScore([
      { pagerank: 0.95, name: "src/services/core.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // score = clamp(0.95, 0, 1) = 0.95
    expect(result!.score).toBe(0.95);
    expect(result!.meta.topNodeName).toBe("src/services/core.ts");
    expect(result!.meta.topNodeType).toBe("File");
    expect(result!.meta.topPagerank).toBe(0.95);
    expect(result!.meta.nodeCount).toBe(1);
    // topInDegree must NOT be present
    expect(result!.meta).not.toHaveProperty("topInDegree");
  });

  it("returns a low score for a peripheral node (low pagerank)", () => {
    const result = computeImpactScore([
      { pagerank: 0.05, name: "src/utils/format.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // score = clamp(0.05, 0, 1) = 0.05
    expect(result!.score).toBe(0.05);
    expect(result!.score).toBeLessThan(0.1);
  });

  it("picks the highest-ranking node as top contributor across multiple nodes", () => {
    const result = computeImpactScore([
      { pagerank: 0.1, name: "utils.ts", node_type: "File" },
      { pagerank: 0.9, name: "core.ts", node_type: "File" },
      { pagerank: 0.3, name: "helper.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.meta.topNodeName).toBe("core.ts");
    expect(result!.meta.nodeCount).toBe(3);
    // Score should be 0.9 (top node pagerank)
    expect(result!.score).toBe(0.9);
  });

  it("handles nodes with missing pagerank gracefully (score = 0, not null)", () => {
    const result = computeImpactScore([
      { name: "ambiguous.ts", node_type: "Function" },
    ]);
    expect(result).not.toBeNull();
    // score = clamp(0, 0, 1) = 0
    expect(result!.score).toBe(0);
    expect(result!.meta.topPagerank).toBeNull();
    // topInDegree must NOT be present
    expect(result!.meta).not.toHaveProperty("topInDegree");
  });

  it("clamps pagerank above 1 to 1.0", () => {
    const result = computeImpactScore([
      { pagerank: 1.5, name: "uber-central.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // Clamped: clamp(1.5, 0, 1) = 1.0
    expect(result!.score).toBe(1.0);
  });

  it("clamps negative pagerank to 0", () => {
    const result = computeImpactScore([
      { pagerank: -0.5, name: "negative.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0);
  });

  it("returns score rounded to 4 decimal places", () => {
    const result = computeImpactScore([
      { pagerank: 0.333333, name: "mid.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    const scoreStr = String(result!.score);
    const decimalPart = scoreStr.includes(".") ? scoreStr.split(".")[1] : "";
    expect(decimalPart.length).toBeLessThanOrEqual(4);
  });

  it("does not accept in_degree in input type (compile-time only — runtime graceful)", () => {
    // CentralityNodeInput no longer has in_degree; verify output has no topInDegree
    const result = computeImpactScore([
      { pagerank: 0.7, name: "service.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.meta).not.toHaveProperty("topInDegree");
  });
});
