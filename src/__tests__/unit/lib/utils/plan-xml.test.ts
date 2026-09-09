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

    it("ignores an echoed earlier copy of the message + chip block", () => {
      // A doubled block used to render as [A, B, C, A]: six matches clamped to four.
      const block = `<message>Anything missing, or shall I move to requirements?</message>
<next_step>Looks good, on to requirements</next_step>
<next_step>Keep it read-only telemetry</next_step>
<next_step>Add automated cleanup too</next_step>`;
      expect(parsePlanXml(`${block}\n\n${block}`).nextSteps).toEqual([
        "Looks good, on to requirements",
        "Keep it read-only telemetry",
        "Add automated cleanup too",
      ]);
    });

    it("keeps the latest turn's chips when an earlier message carries stale ones", () => {
      const xml = `<message>Earlier turn</message>
<next_step>Old chip one</next_step>
<next_step>Old chip two</next_step>

<message>Latest turn</message>
<next_step>Fresh chip one</next_step>
<next_step>Fresh chip two</next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual(["Fresh chip one", "Fresh chip two"]);
    });

    it("reads the whole document when the payload has no message wrapper", () => {
      const xml = `<plan><architecture>x</architecture></plan>
<next_step>Only chip</next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual(["Only chip"]);
    });

    it("dedupes repeats within a turn, ignoring case and whitespace", () => {
      const xml = `<next_step>Looks good, on to requirements</next_step>
<next_step>looks good,  on to   requirements</next_step>
<next_step>Keep it read-only telemetry</next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual([
        "Looks good, on to requirements",
        "Keep it read-only telemetry",
      ]);
    });

    it("clamps to 4 after deduping, so repeats never crowd out real chips", () => {
      const xml = `<next_step>chip 0</next_step><next_step>chip 0</next_step><next_step>chip 1</next_step><next_step>chip 2</next_step><next_step>chip 3</next_step><next_step>chip 4</next_step>`;
      expect(parsePlanXml(xml).nextSteps).toEqual(["chip 0", "chip 1", "chip 2", "chip 3"]);
    });
  });
});
