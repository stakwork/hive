import { describe, test, expect } from "vitest";
import { unescapeLogString } from "@/components/agent-logs/LogDetailContent";

describe("unescapeLogString", () => {
  test("unescapes \\n to real newline", () => {
    expect(unescapeLogString("line one\\nline two")).toBe("line one\nline two");
  });

  test("unescapes \\t to real tab", () => {
    expect(unescapeLogString("col1\\tcol2")).toBe("col1\tcol2");
  });

  test('unescapes \\" to double quote', () => {
    expect(unescapeLogString('say \\"hi\\"')).toBe('say "hi"');
  });

  test("leaves already-unescaped single quotes unchanged", () => {
    expect(unescapeLogString("it's fine")).toBe("it's fine");
  });

  test("returns empty string unchanged", () => {
    expect(unescapeLogString("")).toBe("");
  });

  test("handles multiple escape sequences in one string", () => {
    expect(unescapeLogString("a\\nb\\tc")).toBe("a\nb\tc");
  });
});
