/**
 * Text as lines for the artifact viewers
 * (`_components/artifacts/lines.ts`): counting and cutting it, and reading
 * log text — what counts as a line's time and level, and which lines a
 * level filter keeps together.
 */
import { describe, test, expect } from "vitest";
import {
  lastLines,
  lineCount,
  markdownExcerpt,
  parseLogLines,
  plural,
} from "@/app/org/[githubLogin]/_components/artifacts/lines";

describe("plural", () => {
  test("one of a thing is singular, any other number is not", () => {
    expect(plural(1, "line")).toBe("1 line");
    expect(plural(0, "line")).toBe("0 lines");
    expect(plural(3, "file")).toBe("3 files");
    expect(plural(12000, "line")).toBe("12,000 lines");
  });
});

describe("lineCount", () => {
  test("a closing newline does not start another line", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\n")).toBe(1);
    expect(lineCount("a\nb")).toBe(2);
    expect(lineCount("\n\nb\n")).toBe(3);
  });
});

describe("lastLines", () => {
  test("cuts a text down to its last lines", () => {
    expect(lastLines("a\nb\nc", 2)).toBe("b\nc");
    expect(lastLines("a\nb\nc", 1)).toBe("c");
  });

  test("a closing newline stays with the last line", () => {
    expect(lastLines("a\nb\nc\n", 2)).toBe("b\nc\n");
  });

  test("a text with no more lines than asked for comes back whole", () => {
    expect(lastLines("a\nb\nc", 3)).toBe("a\nb\nc");
    expect(lastLines("a\nb\nc", 9)).toBe("a\nb\nc");
    expect(lastLines("", 3)).toBe("");
  });

  test("an empty line counts as a line", () => {
    expect(lastLines("\nb", 2)).toBe("\nb");
    expect(lastLines("a\n\nb", 2)).toBe("\nb");
  });
});

describe("markdownExcerpt", () => {
  test("a document no longer than the limit comes back whole", () => {
    expect(markdownExcerpt("# Plan\n\nText", 3)).toBe("# Plan\n\nText");
  });

  test("a longer one is cut at the limit", () => {
    expect(markdownExcerpt("one\ntwo\nthree\nfour", 2)).toBe("one\ntwo");
  });

  test("a block closed before the cut is kept", () => {
    expect(markdownExcerpt("```\ncode\n```\nafter\nmore", 4)).toBe("```\ncode\n```\nafter");
  });

  test("a cut inside a fenced block ends the excerpt before the block", () => {
    expect(markdownExcerpt("intro\n\n```mermaid\ngraph TD\nA --> B\n```\nafter", 4)).toBe("intro\n");
  });

  test("unless the block is all there is to show", () => {
    expect(markdownExcerpt("```ts\nconst a = 1;\nconst b = 2;\n```", 2)).toBe("```ts\nconst a = 1;");
  });
});

describe("parseLogLines", () => {
  test("there are no lines in blank text", () => {
    expect(parseLogLines("  \n")).toEqual([]);
  });

  test("takes the clock time and the level off the front of a line", () => {
    expect(parseLogLines("2026-09-30T09:41:02.118Z INFO  Starting")).toEqual([
      { number: 1, time: "09:41:02", level: "info", group: "info", text: "Starting" },
    ]);
  });

  test("reads a bracketed time, a bracketed level and a comma for the milliseconds", () => {
    const [bracketed, comma] = parseLogLines("[09:41:03] [warn] careful\n09:41:05,123 DEBUG: detail");
    expect(bracketed).toMatchObject({ time: "09:41:03", level: "warn", text: "careful" });
    expect(comma).toMatchObject({ time: "09:41:05", level: "debug", text: "detail" });
  });

  test("reads a CI runner's ##[error]", () => {
    expect(parseLogLines("##[error]Process completed with exit code 1.")[0]).toMatchObject({
      level: "error",
      text: "Process completed with exit code 1.",
    });
  });

  test("strips terminal colour codes", () => {
    expect(parseLogLines("\u001b[31mERROR\u001b[0m boom")[0]).toMatchObject({ level: "error", text: "boom" });
  });

  test("a thrown error is an error, and keeps its text whole", () => {
    expect(parseLogLines("TypeError: Cannot read properties of null")[0]).toMatchObject({
      level: "error",
      text: "TypeError: Cannot read properties of null",
    });
  });

  test("a level word only counts in capitals", () => {
    expect(parseLogLines("info about the run")[0]).toMatchObject({ level: null, text: "info about the run" });
  });

  test("numbers lines from one and handles Windows line endings", () => {
    expect(parseLogLines("a\r\nb\r\n").map((line) => [line.number, line.text])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  test("in a log that stamps its entries, a line with no stamp sits under the entry above it", () => {
    const lines = parseLogLines(
      [
        "09:41:38 ERROR test failed",
        "TypeError: Cannot read properties of null",
        "    at useOnboardingChecklist (hook.ts:21:38)",
        "09:41:39 INFO  retrying",
        "still retrying",
      ].join("\n"),
    );
    expect(lines.map((line) => line.group)).toEqual(["error", "error", "error", "info", "info"]);
    expect(lines[2]).toMatchObject({ time: null, level: null });
  });

  test("in a log that does not, only an indented line does", () => {
    const lines = parseLogLines(["ERROR boom", "    at fn (file.ts:1:2)", "a new plain line"].join("\n"));
    expect(lines.map((line) => line.group)).toEqual(["error", "error", null]);
  });
});
