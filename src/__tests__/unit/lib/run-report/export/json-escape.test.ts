import { describe, it, expect } from "vitest";
import { escapeForInlineScript } from "@/lib/run-report/export/json-escape";

describe("escapeForInlineScript", () => {
  it("serializes a plain string normally", () => {
    expect(escapeForInlineScript("hello world")).toBe('"hello world"');
  });

  it("escapes < to prevent </script> breakout", () => {
    const result = escapeForInlineScript({ text: "</script><script>alert(1)</script>" });
    // The < character must not appear literally in the output
    expect(result).not.toContain("<");
    expect(result).toContain("\\u003c");
  });

  it("the escaped output cannot form a </script> closing tag", () => {
    const value = { payload: "</script>" };
    const escaped = escapeForInlineScript(value);
    // Simulate embedding in a script tag
    const html = `<script>var x = ${escaped};</script>`;
    // A naive parser looking for the literal closing tag should not find it
    expect(html.indexOf("</script>")).toBe(html.length - "</script>".length);
    // The only </script> is the one we put there ourselves — verify by checking
    // there is exactly one occurrence, and it is NOT inside the data
    const occurrences = html.split("</script>").length - 1;
    expect(occurrences).toBe(1);
  });

  it("escapes U+2028 LINE SEPARATOR", () => {
    const value = "line\u2028separator";
    const result = escapeForInlineScript(value);
    expect(result).not.toMatch(/\u2028/);
    expect(result).toContain("\\u2028");
  });

  it("escapes U+2029 PARAGRAPH SEPARATOR", () => {
    const value = "para\u2029separator";
    const result = escapeForInlineScript(value);
    expect(result).not.toMatch(/\u2029/);
    expect(result).toContain("\\u2029");
  });

  it("handles all three dangerous characters in one payload", () => {
    const value = {
      script: "</script>",
      line: "a\u2028b",
      para: "c\u2029d",
    };
    const result = escapeForInlineScript(value);
    expect(result).not.toContain("<");
    expect(result).not.toMatch(/\u2028/);
    expect(result).not.toMatch(/\u2029/);
  });

  it("round-trips a complex object correctly after escaping", () => {
    const value = { a: 1, b: "hello", c: [true, null] };
    const result = escapeForInlineScript(value);
    // The escaped string must still parse back to the original value
    const parsed = JSON.parse(result.replace(/\\u003c/g, "<"));
    expect(parsed).toEqual(value);
  });

  it("handles nested objects with adversarial strings", () => {
    const value = {
      outer: {
        inner: "</script><img onerror=alert(1)>",
        unicode: "\u2028\u2029",
      },
    };
    const result = escapeForInlineScript(value);
    // Embed in a script block — must not break HTML parsing
    const html = `<script>var d = ${result};</script>`;
    const closeCount = html.split("</script>").length - 1;
    expect(closeCount).toBe(1); // only the closing tag we wrote
    expect(result).not.toMatch(/\u2028/);
    expect(result).not.toMatch(/\u2029/);
  });

  it("preserves > and other safe characters unchanged", () => {
    const result = escapeForInlineScript({ x: "a > b && c" });
    expect(result).toContain(">");
    expect(result).toContain("&&");
  });

  it("handles arrays", () => {
    const value = [1, "</script>", true, null];
    const result = escapeForInlineScript(value);
    expect(result).not.toContain("<");
    expect(JSON.parse(result.replace(/\\u003c/g, "<"))).toEqual(value);
  });

  it("handles numbers and booleans", () => {
    expect(escapeForInlineScript(42)).toBe("42");
    expect(escapeForInlineScript(true)).toBe("true");
    expect(escapeForInlineScript(null)).toBe("null");
  });
});
