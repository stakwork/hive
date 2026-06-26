import { describe, it, expect } from "vitest";
import { jargonScore } from "@/lib/utils/lingo-extraction";

describe("jargonScore", () => {
  it('"lgtm" scores < 4 (short + no jargon)', () => {
    expect(jargonScore("lgtm")).toBeLessThan(4);
  });

  it('"ok" scores < 4 (short penalty)', () => {
    expect(jargonScore("ok")).toBeLessThan(4);
  });

  it('"the LSAT token needs renewal" scores >= 4 (acronym)', () => {
    expect(jargonScore("the LSAT token needs renewal")).toBeGreaterThanOrEqual(4);
  });

  it('"pitoi pushed to WFE" scores >= 4 (capital + acronym)', () => {
    expect(jargonScore("pitoi pushed to WFE")).toBeGreaterThanOrEqual(4);
  });

  it('"the chatMessage payload is malformed" scores >= 4 (camelCase)', () => {
    expect(jargonScore("the chatMessage payload is malformed")).toBeGreaterThanOrEqual(4);
  });

  it('\'\"hub workspace\" config is missing\' scores >= 4 (quoted term)', () => {
    expect(jargonScore('"hub workspace" config is missing')).toBeGreaterThanOrEqual(4);
  });

  it("longer text with multiple acronyms scores higher", () => {
    expect(jargonScore("the API returned a JWT token for the WFE")).toBeGreaterThan(10);
  });

  it("plain lowercase short text scores < 4", () => {
    expect(jargonScore("hello there")).toBeLessThan(4);
  });
});
