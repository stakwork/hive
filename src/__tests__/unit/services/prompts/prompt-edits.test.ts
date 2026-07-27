import { describe, it, expect } from "vitest";

import {
  applyPromptEdits,
  MAX_PROMPT_EDITS,
} from "@/services/prompts/prompt-edits";

const BASE = [
  "You are a helpful assistant.",
  "",
  "Rules:",
  "- Be concise.",
  "- Cite sources.",
].join("\n");

function ok(result: ReturnType<typeof applyPromptEdits>): string {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function err(result: ReturnType<typeof applyPromptEdits>): string {
  if (result.ok) throw new Error("expected failure, got ok");
  return result.error;
}

describe("applyPromptEdits — happy path", () => {
  it("replaces a unique occurrence and leaves the rest byte-identical", () => {
    const value = ok(
      applyPromptEdits(BASE, [{ oldStr: "- Be concise.", newStr: "- Be extremely concise." }]),
    );

    expect(value).toBe(BASE.replace("- Be concise.", "- Be extremely concise."));
    expect(value).toContain("You are a helpful assistant.");
    expect(value).toContain("- Cite sources.");
  });

  it("preserves whitespace and line breaks outside the matched region", () => {
    const base = "line one\n\n  indented\ttab\n";
    const value = ok(applyPromptEdits(base, [{ oldStr: "indented", newStr: "shifted" }]));

    expect(value).toBe("line one\n\n  shifted\ttab\n");
  });

  it("applies multiple edits in order", () => {
    const value = ok(
      applyPromptEdits(BASE, [
        { oldStr: "helpful assistant", newStr: "terse assistant" },
        { oldStr: "- Cite sources.", newStr: "- Cite sources inline." },
      ]),
    );

    expect(value).toContain("You are a terse assistant.");
    expect(value).toContain("- Cite sources inline.");
  });

  it("applies each edit to the result of the previous one", () => {
    const value = ok(
      applyPromptEdits("aaa", [
        { oldStr: "aaa", newStr: "bbb" },
        { oldStr: "bbb", newStr: "ccc" },
      ]),
    );

    expect(value).toBe("ccc");
  });

  it("deletes matched text when newStr is empty", () => {
    const value = ok(applyPromptEdits(BASE, [{ oldStr: "\n- Cite sources.", newStr: "" }]));

    expect(value).not.toContain("Cite sources");
    expect(value).toContain("- Be concise.");
  });

  it("replaces every occurrence with replaceAll", () => {
    const value = ok(
      applyPromptEdits("foo bar foo baz foo", [
        { oldStr: "foo", newStr: "qux", replaceAll: true },
      ]),
    );

    expect(value).toBe("qux bar qux baz qux");
  });

  it("treats oldStr literally, not as a regex", () => {
    const value = ok(
      applyPromptEdits("cost is $1.00 (approx)", [
        { oldStr: "$1.00 (approx)", newStr: "$2.00 (exact)" },
      ]),
    );

    expect(value).toBe("cost is $2.00 (exact)");
  });

  it("does not treat $& in newStr as a substitution pattern", () => {
    const value = ok(applyPromptEdits("hello world", [{ oldStr: "world", newStr: "$& there" }]));

    expect(value).toBe("hello $& there");
  });

  it("handles a multi-line oldStr spanning the whole prompt", () => {
    const value = ok(applyPromptEdits(BASE, [{ oldStr: BASE, newStr: "Replaced wholesale." }]));

    expect(value).toBe("Replaced wholesale.");
  });
});

describe("applyPromptEdits — rejects ambiguous or stale edits", () => {
  it("fails when oldStr is not found", () => {
    const message = err(applyPromptEdits(BASE, [{ oldStr: "- Be terse.", newStr: "x" }]));

    expect(message).toMatch(/not found/i);
    expect(message).toMatch(/edit 1 of 1/);
  });

  it("names the failing edit's position in a multi-edit call", () => {
    const message = err(
      applyPromptEdits(BASE, [
        { oldStr: "- Be concise.", newStr: "- Be brief." },
        { oldStr: "nope", newStr: "x" },
      ]),
    );

    expect(message).toMatch(/edit 2 of 2/);
  });

  it("fails when oldStr matches more than once without replaceAll", () => {
    const message = err(applyPromptEdits("foo bar foo", [{ oldStr: "foo", newStr: "qux" }]));

    expect(message).toMatch(/matched 2 times/i);
    expect(message).toMatch(/replaceAll/);
  });

  it("fails when a later edit becomes ambiguous after an earlier one", () => {
    // The first edit introduces a second "beta", making edit 2 non-unique.
    const message = err(
      applyPromptEdits("alpha beta", [
        { oldStr: "alpha", newStr: "beta" },
        { oldStr: "beta", newStr: "gamma" },
      ]),
    );

    expect(message).toMatch(/edit 2 of 2/);
    expect(message).toMatch(/matched 2 times/i);
  });

  it("rejects an empty oldStr", () => {
    const message = err(applyPromptEdits(BASE, [{ oldStr: "", newStr: "x" }]));

    expect(message).toMatch(/non-empty/i);
  });

  it("rejects a no-op edit where oldStr equals newStr", () => {
    const message = err(
      applyPromptEdits(BASE, [{ oldStr: "- Be concise.", newStr: "- Be concise." }]),
    );

    expect(message).toMatch(/identical/i);
  });

  it("rejects an empty edit list", () => {
    expect(err(applyPromptEdits(BASE, []))).toMatch(/at least one edit/i);
  });

  it("rejects more than MAX_PROMPT_EDITS edits", () => {
    const edits = Array.from({ length: MAX_PROMPT_EDITS + 1 }, (_, i) => ({
      oldStr: `x${i}`,
      newStr: `y${i}`,
    }));

    expect(err(applyPromptEdits(BASE, edits))).toMatch(/too many edits/i);
  });

  it("truncates a long oldStr in the error message", () => {
    const long = "z".repeat(500);
    const message = err(applyPromptEdits(BASE, [{ oldStr: long, newStr: "x" }]));

    expect(message).toContain("…");
    expect(message.length).toBeLessThan(long.length);
  });

  it("does not partially apply edits when a later one fails", () => {
    const result = applyPromptEdits(BASE, [
      { oldStr: "- Be concise.", newStr: "- Be brief." },
      { oldStr: "missing", newStr: "x" },
    ]);

    // Failure returns no value at all — the caller cannot accidentally write a
    // half-applied prompt.
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });
});
