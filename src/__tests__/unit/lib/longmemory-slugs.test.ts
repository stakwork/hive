import { describe, it, expect } from "vitest";
import { LEGAL_SLUGS, LEGAL_STRUT_SLUGS, isLongMemoryWorkspace } from "@/lib/eval-capture-slugs";

describe("isLongMemoryWorkspace", () => {
  it("is true for openlaw-1 only", () => {
    expect(isLongMemoryWorkspace("openlaw-1")).toBe(true);
    for (const slug of ["openlaw", "hive", "stakwork", "openlaw-2", "", null, undefined]) {
      expect(isLongMemoryWorkspace(slug)).toBe(false);
    }
  });

  it("leaves the legal slug lists alone", () => {
    expect(LEGAL_SLUGS).toEqual(["openlaw"]);
    expect(LEGAL_STRUT_SLUGS).toEqual(["openlaw-1"]);
  });
});
