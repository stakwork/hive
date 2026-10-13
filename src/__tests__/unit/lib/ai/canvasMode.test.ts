import { describe, it, expect } from "vitest";
import { parseCanvasAgentMode } from "@/lib/ai/canvasMode";

describe("parseCanvasAgentMode", () => {
  it("only an exact 'concept' is concept mode", () => {
    expect(parseCanvasAgentMode("concept")).toBe("concept");
    for (const v of ["full", "Concept", "", undefined, null, 1, {}]) {
      expect(parseCanvasAgentMode(v)).toBe("full");
    }
  });
});
