import { describe, it, expect } from "vitest";

import { applyExactEdits, type ApplyExactEditsOptions } from "@/services/text-edits";

const BASE = [
  "You are a helpful assistant.",
  "",
  "Rules:",
  "- Be concise.",
  "- Cite sources.",
].join("\n");

const PROMPT_OPTS: ApplyExactEditsOptions = {
  noun: "prompt",
  rereadHint:
    "Re-read the current value with raw: true and build the edit from that text",
  maxEdits: 50,
};

const HTML_OPTS: ApplyExactEditsOptions = {
  noun: "page",
  rereadHint: "Re-read the current page with get_html.",
  maxEdits: 50,
};

function ok(result: ReturnType<typeof applyExactEdits>): string {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function err(result: ReturnType<typeof applyExactEdits>): {
  error: string;
  reason: string;
} {
  if (result.ok) throw new Error("expected failure, got ok");
  return { error: result.error, reason: result.reason };
}

describe.each([
  { label: "prompt", opts: PROMPT_OPTS, noun: "prompt", reread: "raw: true" },
  { label: "html", opts: HTML_OPTS, noun: "page", reread: "get_html" },
])("applyExactEdits — $label flavor", ({ opts, noun, reread }) => {
  it("happy path: replaces a unique occurrence and leaves the rest byte-identical", () => {
    const value = ok(
      applyExactEdits(BASE, [{ oldStr: "- Be concise.", newStr: "- Be extremely concise." }], opts),
    );

    expect(value).toBe(BASE.replace("- Be concise.", "- Be extremely concise."));
    expect(value).toContain("You are a helpful assistant.");
  });

  it("applies multiple edits in order, each against the prior result", () => {
    const value = ok(
      applyExactEdits(
        "aaa",
        [
          { oldStr: "aaa", newStr: "bbb" },
          { oldStr: "bbb", newStr: "ccc" },
        ],
        opts,
      ),
    );
    expect(value).toBe("ccc");
  });

  it("zero-match: fails, names the noun, and includes the reread hint", () => {
    const result = applyExactEdits(BASE, [{ oldStr: "- Be terse.", newStr: "x" }], opts);
    const { error, reason } = err(result);

    expect(reason).toBe("zero_match");
    expect(error).toMatch(/not found/i);
    expect(error).toContain(noun);
    expect(error).toContain(reread);
    // Cross-check: the OTHER flavor's noun/hint must not leak in.
    if (noun === "page") {
      expect(error).not.toMatch(/\bprompt\b/);
      expect(error).not.toContain("raw: true");
    } else {
      expect(error).not.toMatch(/\bpage\b/);
      expect(error).not.toContain("get_html");
    }
  });

  it("ambiguous match without replaceAll: fails, names occurrence count", () => {
    const result = applyExactEdits("foo bar foo", [{ oldStr: "foo", newStr: "qux" }], opts);
    const { error, reason } = err(result);

    expect(reason).toBe("ambiguous_match");
    expect(error).toMatch(/matched 2 times/i);
    expect(error).toMatch(/replaceAll/);
  });

  it("ambiguous match WITH replaceAll: succeeds, replaces every occurrence", () => {
    const value = ok(
      applyExactEdits(
        "foo bar foo baz foo",
        [{ oldStr: "foo", newStr: "qux", replaceAll: true }],
        opts,
      ),
    );
    expect(value).toBe("qux bar qux baz qux");
  });

  it("edit-cap exceeded: fails with too_many_edits", () => {
    const edits = Array.from({ length: opts.maxEdits + 1 }, (_, i) => ({
      oldStr: `x${i}`,
      newStr: `y${i}`,
    }));
    const result = applyExactEdits(BASE, edits, opts);
    const { error, reason } = err(result);

    expect(reason).toBe("too_many_edits");
    expect(error).toMatch(/too many edits/i);
  });

  it("empty edits list fails with empty_edits", () => {
    const { reason } = err(applyExactEdits(BASE, [], opts));
    expect(reason).toBe("empty_edits");
  });

  it("no-op edit (oldStr === newStr) fails with noop_edit", () => {
    const { reason } = err(
      applyExactEdits(BASE, [{ oldStr: "- Be concise.", newStr: "- Be concise." }], opts),
    );
    expect(reason).toBe("noop_edit");
  });

  it("does not partially apply edits when a later one fails", () => {
    const result = applyExactEdits(
      BASE,
      [
        { oldStr: "- Be concise.", newStr: "- Be brief." },
        { oldStr: "missing", newStr: "x" },
      ],
      opts,
    );
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });

  it("truncates a long oldStr snippet in the error message", () => {
    const long = "z".repeat(500);
    const { error } = err(applyExactEdits(BASE, [{ oldStr: long, newStr: "x" }], opts));
    expect(error).toContain("…");
    expect(error.length).toBeLessThan(long.length);
  });
});
