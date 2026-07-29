import { describe, test, expect } from "vitest";
import { parseMessageSegments } from "@/lib/prompts/detect-prompt-names";

describe("parseMessageSegments", () => {
  test("plain text returns a single text segment", () => {
    const result = parseMessageSegments("hello world");
    expect(result).toEqual([{ type: "text", value: "hello world" }]);
  });

  test("empty string returns a single empty text segment", () => {
    const result = parseMessageSegments("");
    expect(result).toEqual([{ type: "text", value: "" }]);
  });

  test("UPPERCASE_UNDERSCORE prompt name is detected; surrounding text becomes text segments", () => {
    const result = parseMessageSegments("Check out HARVEY_CASE_LAW_RESEARCH_PROMPT please.");
    expect(result).toEqual([
      { type: "text", value: "Check out " },
      { type: "prompt", name: "HARVEY_CASE_LAW_RESEARCH_PROMPT" },
      { type: "text", value: " please." },
    ]);
  });

  test("bare acronyms API, HTTP do NOT produce prompt segments", () => {
    const result = parseMessageSegments("Use the API and HTTP endpoints.");
    expect(result).toEqual([
      { type: "text", value: "Use the API and HTTP endpoints." },
    ]);
  });

  test("short token V3 does NOT produce a prompt segment", () => {
    // V3 matches the version pattern but has no preceding prompt name,
    // so it is emitted as a text segment — never a prompt segment.
    const result = parseMessageSegments("Version V3 is available.");
    expect(result.every((s) => s.type !== "prompt")).toBe(true);
    expect(result.every((s) => s.type !== "version")).toBe(true);
  });

  test("version reference after a prompt name produces a version segment associated with that prompt", () => {
    const result = parseMessageSegments("Use MY_PROMPT version 3 now.");
    expect(result).toEqual([
      { type: "text", value: "Use " },
      { type: "prompt", name: "MY_PROMPT" },
      { type: "text", value: " " },
      { type: "version", label: "version 3", number: 3, promptName: "MY_PROMPT" },
      { type: "text", value: " now." },
    ]);
  });

  test("version reference with no preceding prompt is emitted as a text segment", () => {
    const result = parseMessageSegments("Please use version 2 of the tool.");
    expect(result).toEqual([
      { type: "text", value: "Please use " },
      { type: "text", value: "version 2" },
      { type: "text", value: " of the tool." },
    ]);
  });

  test("multiple prompt names: version associates with the nearest preceding one", () => {
    const result = parseMessageSegments(
      "FIRST_PROMPT and SECOND_PROMPT version 5 are available.",
    );
    expect(result).toContainEqual({ type: "prompt", name: "FIRST_PROMPT" });
    expect(result).toContainEqual({ type: "prompt", name: "SECOND_PROMPT" });
    expect(result).toContainEqual({
      type: "version",
      label: "version 5",
      number: 5,
      promptName: "SECOND_PROMPT",
    });
    // version must NOT be associated with FIRST_PROMPT
    expect(result).not.toContainEqual(
      expect.objectContaining({ type: "version", promptName: "FIRST_PROMPT" }),
    );
  });

  test("duplicate version token: leftmost is version segment; subsequent duplicate is text", () => {
    const result = parseMessageSegments("MY_PROMPT version 2 (v2) is the one.");
    expect(result).toContainEqual({
      type: "version",
      label: "version 2",
      number: 2,
      promptName: "MY_PROMPT",
    });
    // v2 duplicates version 2 for the same prompt → emitted as text
    expect(result).toContainEqual({ type: "text", value: "v2" });
    // No second version segment for the same pair
    const versionSegments = result.filter((s) => s.type === "version");
    expect(versionSegments).toHaveLength(1);
  });

  test("v3 shorthand is detected as a version reference when preceded by a prompt name", () => {
    const result = parseMessageSegments("See CASE_PROMPT v3 for details.");
    expect(result).toContainEqual({
      type: "version",
      label: "v3",
      number: 3,
      promptName: "CASE_PROMPT",
    });
  });

  test("draft version reference is detected", () => {
    const result = parseMessageSegments("Try RESEARCH_PROMPT draft version 1.");
    expect(result).toContainEqual({
      type: "version",
      label: "draft version 1",
      number: 1,
      promptName: "RESEARCH_PROMPT",
    });
  });

  test("multiple calls do not share RegExp lastIndex state", () => {
    // First call
    const r1 = parseMessageSegments("MY_PROMPT version 1");
    expect(r1).toContainEqual({ type: "prompt", name: "MY_PROMPT" });

    // Second call should still find the same tokens
    const r2 = parseMessageSegments("MY_PROMPT version 1");
    expect(r2).toContainEqual({ type: "prompt", name: "MY_PROMPT" });
    expect(r2).toContainEqual({
      type: "version",
      label: "version 1",
      number: 1,
      promptName: "MY_PROMPT",
    });
  });

  test("prompt name only with no surrounding text", () => {
    const result = parseMessageSegments("JUST_A_PROMPT");
    expect(result).toEqual([{ type: "prompt", name: "JUST_A_PROMPT" }]);
  });

  test("two separate prompt names in one message", () => {
    const result = parseMessageSegments("Use ALPHA_PROMPT and BETA_PROMPT today.");
    expect(result).toContainEqual({ type: "prompt", name: "ALPHA_PROMPT" });
    expect(result).toContainEqual({ type: "prompt", name: "BETA_PROMPT" });
    const prompts = result.filter((s) => s.type === "prompt");
    expect(prompts).toHaveLength(2);
  });
});
