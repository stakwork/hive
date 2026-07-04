/**
 * Unit tests for src/services/error-impact.ts
 *
 * Covers:
 * - computeImpactScore: central node → high score
 * - computeImpactScore: peripheral-only node → low score
 * - computeImpactScore: empty input → null
 * - computeImpactScore: multiple nodes, best node wins
 * - computeImpactScore: missing optional fields handled gracefully
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

  it("returns a high score for a central node (high pagerank + high in_degree)", () => {
    const result = computeImpactScore([
      { pagerank: 0.95, in_degree: 80, name: "src/services/core.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // 0.95 * 0.6 + (80/100) * 0.4 = 0.57 + 0.32 = 0.89
    expect(result!.score).toBeGreaterThan(0.8);
    expect(result!.meta.topNodeName).toBe("src/services/core.ts");
    expect(result!.meta.topNodeType).toBe("File");
    expect(result!.meta.topPagerank).toBe(0.95);
    expect(result!.meta.topInDegree).toBe(80);
    expect(result!.meta.nodeCount).toBe(1);
  });

  it("returns a low score for a peripheral node (low pagerank + low in_degree)", () => {
    const result = computeImpactScore([
      { pagerank: 0.05, in_degree: 1, name: "src/utils/format.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // 0.05 * 0.6 + (1/100) * 0.4 = 0.03 + 0.004 = 0.034
    expect(result!.score).toBeLessThan(0.1);
  });

  it("picks the highest-ranking node as top contributor across multiple nodes", () => {
    const result = computeImpactScore([
      { pagerank: 0.1, in_degree: 5, name: "utils.ts", node_type: "File" },
      { pagerank: 0.9, in_degree: 60, name: "core.ts", node_type: "File" },
      { pagerank: 0.3, in_degree: 10, name: "helper.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.meta.topNodeName).toBe("core.ts");
    expect(result!.meta.nodeCount).toBe(3);
    // Score should reflect the top node: 0.9*0.6 + (60/100)*0.4 = 0.54+0.24 = 0.78
    expect(result!.score).toBeGreaterThan(0.7);
  });

  it("handles nodes with missing pagerank/in_degree gracefully (treats as 0)", () => {
    const result = computeImpactScore([
      { name: "ambiguous.ts", node_type: "Function" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0); // 0 * 0.6 + 0 * 0.4 = 0
    expect(result!.meta.topPagerank).toBeNull();
    expect(result!.meta.topInDegree).toBeNull();
  });

  it("clamps in_degree above normalization factor to 1.0 component", () => {
    const result = computeImpactScore([
      { pagerank: 1.0, in_degree: 500, name: "uber-central.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    // Clamped: 1.0 * 0.6 + 1.0 * 0.4 = 1.0
    expect(result!.score).toBe(1.0);
  });

  it("returns score rounded to 4 decimal places", () => {
    const result = computeImpactScore([
      { pagerank: 0.333, in_degree: 33, name: "mid.ts", node_type: "File" },
    ]);
    expect(result).not.toBeNull();
    const scoreStr = String(result!.score);
    const decimalPart = scoreStr.includes(".") ? scoreStr.split(".")[1] : "";
    expect(decimalPart.length).toBeLessThanOrEqual(4);
  });
});
