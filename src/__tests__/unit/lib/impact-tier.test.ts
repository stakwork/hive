import { describe, it, expect } from "vitest";
import { impactTier, impactTooltip, IMPACT_EXPLANATION } from "@/lib/utils/impact-tier";

describe("impactTier", () => {
  it("returns 'Not scored' for null", () => {
    const result = impactTier(null);
    expect(result.label).toBe("Not scored");
    expect(result.colorClass).toBe("text-muted-foreground");
  });

  it("returns 'Low' for score 0 (pct=0)", () => {
    const result = impactTier(0);
    expect(result.label).toBe("Low");
    expect(result.colorClass).toBe("bg-muted text-muted-foreground");
  });

  it("returns 'Low' for score 0.32 (pct=32)", () => {
    const result = impactTier(0.32);
    expect(result.label).toBe("Low");
  });

  it("returns 'Medium' for score 0.33 (pct=33)", () => {
    const result = impactTier(0.33);
    expect(result.label).toBe("Medium");
    expect(result.colorClass).toBe("bg-orange-500/80 text-white");
  });

  it("returns 'Medium' for score 0.65 (pct=65)", () => {
    const result = impactTier(0.65);
    expect(result.label).toBe("Medium");
  });

  it("returns 'High' for score 0.66 (pct=66)", () => {
    const result = impactTier(0.66);
    expect(result.label).toBe("High");
    expect(result.colorClass).toBe("bg-destructive/80 text-destructive-foreground");
  });

  it("returns 'High' for score 1 (pct=100)", () => {
    const result = impactTier(1);
    expect(result.label).toBe("High");
  });
});

describe("impactTooltip", () => {
  it("returns undefined for null meta", () => {
    expect(impactTooltip(null)).toBeUndefined();
  });

  it("returns undefined when topNodeName is missing", () => {
    expect(impactTooltip({ topNodeType: "Function" })).toBeUndefined();
  });

  it("returns undefined when topNodeName is not a string", () => {
    expect(impactTooltip({ topNodeName: 42 })).toBeUndefined();
  });

  it("builds full tooltip for complete meta", () => {
    const result = impactTooltip({
      topNodeName: "edit",
      topNodeType: "Function",
      topPagerank: 0.405,
      nodeCount: 4,
    });
    expect(result).toContain("edit (Function)");
    expect(result).toContain("centrality 0.41");
    expect(result).toContain("4 code locations referenced");
    expect(result).toMatch(/^Most-connected code touched:/);
  });

  it("omits centrality segment when topPagerank is null", () => {
    const result = impactTooltip({
      topNodeName: "edit",
      topNodeType: "Function",
      topPagerank: null,
      nodeCount: 4,
    });
    expect(result).toContain("edit (Function)");
    expect(result).not.toContain("centrality");
    expect(result).toContain("4 code locations referenced");
  });

  it("omits centrality segment when topPagerank is not a finite number", () => {
    const result = impactTooltip({
      topNodeName: "edit",
      topNodeType: "Function",
      topPagerank: Infinity,
      nodeCount: 2,
    });
    expect(result).not.toContain("centrality");
  });

  it("omits (topNodeType) when topNodeType is not a string", () => {
    const result = impactTooltip({
      topNodeName: "edit",
      topNodeType: 99,
      topPagerank: 0.3,
      nodeCount: 2,
    });
    expect(result).toContain("Most-connected code touched: edit");
    expect(result).not.toContain("(");
  });

  it("omits nodeCount segment when nodeCount is absent", () => {
    const result = impactTooltip({
      topNodeName: "edit",
      topNodeType: "Function",
      topPagerank: 0.3,
    });
    expect(result).not.toContain("code locations");
  });

  it("returns just the node name when all optional fields are absent", () => {
    const result = impactTooltip({ topNodeName: "myFunc" });
    expect(result).toBe("Most-connected code touched: myFunc");
  });
});

describe("IMPACT_EXPLANATION", () => {
  it("is a non-empty string containing key terms", () => {
    expect(typeof IMPACT_EXPLANATION).toBe("string");
    expect(IMPACT_EXPLANATION).toContain("PageRank");
    expect(IMPACT_EXPLANATION).toContain("blast radius");
  });
});
