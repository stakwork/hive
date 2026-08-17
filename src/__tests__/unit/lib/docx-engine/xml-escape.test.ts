import { describe, test, expect } from "vitest";
import { xmlAttrEscape, xmlTextEscape } from "@/lib/docx-engine/core/xml-escape";

describe("xmlAttrEscape", () => {
  test("escapes ampersand", () => {
    expect(xmlAttrEscape("a&b")).toBe("a&amp;b");
  });

  test("escapes double quote", () => {
    expect(xmlAttrEscape('say "hello"')).toBe("say &quot;hello&quot;");
  });

  test("escapes less-than", () => {
    expect(xmlAttrEscape("a<b")).toBe("a&lt;b");
  });

  test("escapes greater-than", () => {
    expect(xmlAttrEscape("a>b")).toBe("a&gt;b");
  });

  test("escapes single quote / apostrophe", () => {
    expect(xmlAttrEscape("it's")).toBe("it&apos;s");
  });

  test("escapes all five chars in one string", () => {
    expect(xmlAttrEscape(`<script>&"'`)).toBe(
      "&lt;script&gt;&amp;&quot;&apos;"
    );
  });

  test("clean ASCII passes unchanged", () => {
    expect(xmlAttrEscape("Hello World 123")).toBe("Hello World 123");
  });

  test("empty string returns empty string", () => {
    expect(xmlAttrEscape("")).toBe("");
  });

  test("multiple ampersands are all escaped", () => {
    expect(xmlAttrEscape("a&b&c")).toBe("a&amp;b&amp;c");
  });

  test("author with angle brackets is fully escaped", () => {
    expect(xmlAttrEscape('<w:del w:id="0">')).toBe(
      "&lt;w:del w:id=&quot;0&quot;&gt;"
    );
  });
});

describe("xmlTextEscape", () => {
  test("escapes ampersand in text content", () => {
    expect(xmlTextEscape("a&b")).toBe("a&amp;b");
  });

  test("escapes less-than in text content", () => {
    expect(xmlTextEscape("a<b")).toBe("a&lt;b");
  });

  test("escapes greater-than in text content", () => {
    expect(xmlTextEscape("a>b")).toBe("a&gt;b");
  });

  test("does NOT escape quotes in text content (not needed)", () => {
    expect(xmlTextEscape('say "hello"')).toBe('say "hello"');
  });

  test("clean ASCII passes unchanged", () => {
    expect(xmlTextEscape("plain text")).toBe("plain text");
  });
});
