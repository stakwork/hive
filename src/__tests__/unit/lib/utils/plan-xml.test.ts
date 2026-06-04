import { describe, it, expect } from "vitest";
import { parsePlanXml } from "@/lib/utils/plan-xml";

describe("parsePlanXml", () => {
  it("extracts the flat plan tags", () => {
    const xml = `<plan>
      <brief>Do the thing</brief>
      <requirements>Must be fast</requirements>
      <architecture>Use a queue</architecture>
      <userStories>As a user...</userStories>
    </plan>`;
    const parsed = parsePlanXml(xml);
    expect(parsed.brief).toBe("Do the thing");
    expect(parsed.requirements).toBe("Must be fast");
    expect(parsed.architecture).toBe("Use a queue");
    expect(parsed.userStories).toBe("As a user...");
  });

  describe("nextSteps (suggestion chips)", () => {
    it("extracts repeating <next_step> tags as sibling of <plan>/<message>", () => {
      const xml = `<plan><architecture>x</architecture></plan>\n\n<message>Ready?</message>\n\n<next_step>Yes, looks good</next_step>\n<next_step>Let's discuss architecture</next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual([
        "Yes, looks good",
        "Let's discuss architecture",
      ]);
    });

    it("trims whitespace and drops empty steps", () => {
      const xml = `<next_step>  Move on  </next_step><next_step>   </next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual(["Move on"]);
    });

    it("clamps to the first 4", () => {
      const xml = Array.from({ length: 6 }, (_, i) => `<next_step>chip ${i}</next_step>`).join("");
      expect(parsePlanXml(xml).nextSteps).toHaveLength(4);
    });

    it("returns undefined when no <next_step> tags are present", () => {
      const xml = `<plan><brief>no chips here</brief></plan>`;
      expect(parsePlanXml(xml).nextSteps).toBeUndefined();
    });
  });
});
