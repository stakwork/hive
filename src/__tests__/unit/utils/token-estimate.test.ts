import { describe, it, expect } from "vitest";
import { estimateTokens, formatTokenCount } from "@/lib/utils/token-estimate";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null-ish values", () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("returns a positive integer for non-empty text", () => {
    const result = estimateTokens("Hello world");
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("returns more tokens for longer text", () => {
    const short = estimateTokens("Hello");
    const long = estimateTokens("Hello world, this is a much longer prompt with many more words.");
    expect(long).toBeGreaterThan(short);
  });
});

describe("formatTokenCount", () => {
  it("formats sub-1k counts as ~N tokens", () => {
    expect(formatTokenCount(0)).toBe("~0 tokens");
    expect(formatTokenCount(1)).toBe("~1 tokens");
    expect(formatTokenCount(500)).toBe("~500 tokens");
    expect(formatTokenCount(999)).toBe("~999 tokens");
  });

  it("formats 1000 as ~1k tokens", () => {
    expect(formatTokenCount(1000)).toBe("~1k tokens");
  });

  it("formats 1500 as ~1.5k tokens", () => {
    expect(formatTokenCount(1500)).toBe("~1.5k tokens");
  });

  it("formats large counts correctly", () => {
    expect(formatTokenCount(2000)).toBe("~2k tokens");
    expect(formatTokenCount(10000)).toBe("~10k tokens");
  });
});
