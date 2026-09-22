import { describe, expect, test } from "vitest";
import type { StepResult, ToolSet } from "ai";
import {
  endsWithEndMarker,
  hasTrailingEndMarker,
  stripEndMarker,
} from "@/lib/ai/endMarker";

const step = (content: unknown[]): StepResult<ToolSet> =>
  ({ content }) as unknown as StepResult<ToolSet>;

describe("endsWithEndMarker", () => {
  test("a trailing marker, with or without trailing whitespace", () => {
    expect(endsWithEndMarker("Done.\n[END_OF_ANSWER]")).toBe(true);
    expect(endsWithEndMarker("Done.\n[END_OF_ANSWER]\n\n")).toBe(true);
  });

  test("a quoted mid-text, empty, or missing marker is not a termination", () => {
    expect(endsWithEndMarker("after the `[END_OF_ANSWER]` strip.")).toBe(false);
    expect(endsWithEndMarker("")).toBe(false);
    expect(endsWithEndMarker(undefined)).toBe(false);
  });
});

describe("stripEndMarker", () => {
  test("removes only the trailing marker and keeps a quoted one", () => {
    expect(
      stripEndMarker("after the `[END_OF_ANSWER]` strip.\n[END_OF_ANSWER]\n"),
    ).toBe("after the `[END_OF_ANSWER]` strip.\n");
  });

  test("does not trim — streaming callers own their whitespace", () => {
    expect(stripEndMarker("\n\nHello ")).toBe("\n\nHello ");
  });
});

describe("hasTrailingEndMarker", () => {
  test("true when a step's concatenated text ends with the marker", () => {
    const steps = [
      step([
        { type: "text", text: "Part one. " },
        { type: "text", text: "Done.\n[END_OF_ANSWER]" },
      ]),
    ];
    expect(hasTrailingEndMarker(steps)).toBe(true);
  });

  test("false for a marker quoted in narration alongside tool calls", () => {
    const steps = [
      step([
        { type: "text", text: "Now checking the `[END_OF_ANSWER]` strip." },
        { type: "tool-call", toolName: "bash" },
        { type: "tool-result", toolName: "bash", output: "ok" },
      ]),
    ];
    expect(hasTrailingEndMarker(steps)).toBe(false);
  });
});
