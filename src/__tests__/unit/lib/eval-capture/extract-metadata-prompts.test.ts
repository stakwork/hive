import { describe, test, expect } from "vitest";
import { extractMetadataPrompts } from "@/lib/eval-capture/extract-metadata-prompts";

// Each helper to parse a single stringified entry back to an object
function parse(s: string) {
  return JSON.parse(s);
}

describe("extractMetadataPrompts", () => {
  test("returns [] for null metadata", () => {
    expect(extractMetadataPrompts(null)).toEqual([]);
  });

  test("returns [] for undefined metadata", () => {
    expect(extractMetadataPrompts(undefined)).toEqual([]);
  });

  test("returns [] for non-object metadata (string)", () => {
    expect(extractMetadataPrompts("some-string")).toEqual([]);
  });

  test("returns [] for non-object metadata (number)", () => {
    expect(extractMetadataPrompts(42)).toEqual([]);
  });

  test("returns [] when metadata has no prompts key", () => {
    expect(extractMetadataPrompts({ foo: "bar" })).toEqual([]);
  });

  test("returns [] when metadata.prompts is an empty array", () => {
    expect(extractMetadataPrompts({ prompts: [] })).toEqual([]);
  });

  test("handles array input — JSON-stringifies each entry as-is", () => {
    const entries = [
      { name: "p1", prompt_id: 1, prompt_version_id: 10 },
      { name: "p2", prompt_id: 2, prompt_version_id: 20, resolution: "v2" },
    ];
    const result = extractMetadataPrompts({ prompts: entries });

    expect(result).toHaveLength(2);
    expect(parse(result[0])).toEqual(entries[0]);
    expect(parse(result[1])).toEqual(entries[1]);
  });

  test("handles record input — maps via mapPromptResolutions then JSON-stringifies", () => {
    const record = {
      my_prompt: {
        prompt_id: 5,
        prompt_version_id: 50,
        resolution: { value: "resolved-value" },
      },
    };
    const result = extractMetadataPrompts({ prompts: record });

    expect(result).toHaveLength(1);
    const parsed = parse(result[0]);
    expect(parsed).toMatchObject({
      name: "my_prompt",
      prompt_id: 5,
      prompt_version_id: 50,
      resolution: "resolved-value",
    });
  });

  test("handles record input with resolution.value === null — omits resolution field", () => {
    const record = {
      p_no_res: {
        prompt_id: 7,
        prompt_version_id: 70,
        resolution: { value: null },
      },
    };
    const result = extractMetadataPrompts({ prompts: record });

    expect(result).toHaveLength(1);
    const parsed = parse(result[0]);
    expect(parsed).toEqual({ name: "p_no_res", prompt_id: 7, prompt_version_id: 70 });
    expect("resolution" in parsed).toBe(false);
  });

  test("returns [] when record input yields empty after mapPromptResolutions", () => {
    // mapPromptResolutions returns undefined for empty records, helper should return []
    expect(extractMetadataPrompts({ prompts: {} })).toEqual([]);
  });

  test("returns each entry as an individually JSON-stringified string (not a nested array)", () => {
    const entries = [{ name: "x", prompt_id: 1, prompt_version_id: 1 }];
    const result = extractMetadataPrompts({ prompts: entries });

    expect(typeof result[0]).toBe("string");
    // Should NOT be double-stringified
    expect(() => JSON.parse(result[0])).not.toThrow();
  });
});
