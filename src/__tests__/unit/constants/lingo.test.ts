import { describe, it, expect } from "vitest";
import { LINGO_TYPES } from "@/lib/constants/lingo";

describe("LINGO_TYPES", () => {
  it("contains exactly 7 values", () => {
    expect(LINGO_TYPES).toHaveLength(7);
  });

  it("has no duplicate values", () => {
    const unique = new Set(LINGO_TYPES);
    expect(unique.size).toBe(LINGO_TYPES.length);
  });

  it("contains the expected type values", () => {
    expect(LINGO_TYPES).toContain("person");
    expect(LINGO_TYPES).toContain("product_term");
    expect(LINGO_TYPES).toContain("industry_term");
    expect(LINGO_TYPES).toContain("company_jargon");
    expect(LINGO_TYPES).toContain("system_page");
    expect(LINGO_TYPES).toContain("code_symbol");
    expect(LINGO_TYPES).toContain("acronym");
  });
});
