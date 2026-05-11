import { describe, test, expect } from "vitest";

// The transform applied in the prompt name onChange handlers
const transformPromptName = (value: string) =>
  value.toUpperCase().replace(/[^A-Z_]/g, "");

describe("Prompt name onChange transform", () => {
  test("converts lowercase to uppercase", () => {
    expect(transformPromptName("hello")).toBe("HELLO");
  });

  test("strips spaces", () => {
    expect(transformPromptName("hello world")).toBe("HELLOWORLD");
  });

  test("preserves underscores", () => {
    expect(transformPromptName("my_PROMPT")).toBe("MY_PROMPT");
  });

  test("strips numbers and dashes", () => {
    expect(transformPromptName("test-123")).toBe("TEST");
  });

  test("leaves already-valid names unchanged", () => {
    expect(transformPromptName("VALID_NAME")).toBe("VALID_NAME");
  });

  test("strips all special characters", () => {
    expect(transformPromptName("test!@#$%")).toBe("TEST");
  });

  test("handles empty string", () => {
    expect(transformPromptName("")).toBe("");
  });

  test("handles mixed case with underscores and noise", () => {
    expect(transformPromptName("My_Prompt-v2")).toBe("MY_PROMPTV");
  });
});
