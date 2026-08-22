/**
 * Unit tests for track-change-exporter.ts
 *
 * Key security assertion: author/date/id fields containing XML special chars
 * must be escaped — the exported XML must never contain raw `<` or `>` from
 * user-supplied author strings.
 */
import { describe, test, expect } from "vitest";
import {
  wrapAsInsertion,
  wrapAsDeletion,
} from "@/lib/docx-engine/exporter/track-change-exporter";
import type { DocxInlineNode } from "@/lib/docx-engine/types/document";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textRun(text: string): DocxInlineNode {
  return {
    kind: "text",
    text,
    properties: {},
    trackChange: undefined,
  } as DocxInlineNode;
}

// ---------------------------------------------------------------------------
// wrapAsInsertion — XML attribute escaping
// ---------------------------------------------------------------------------

describe("wrapAsInsertion — XML attribute escaping", () => {
  test("author containing <script> tags is escaped in w:ins attribute", () => {
    const xml = wrapAsInsertion(
      [textRun("hello")],
      "<script>alert(1)</script>",
      "2024-01-01T00:00:00Z",
      "1",
    );

    // Must not contain raw angle brackets from author
    expect(xml).not.toContain('<script>');
    expect(xml).not.toContain('</script>');

    // Must contain properly escaped form
    expect(xml).toContain("&lt;script&gt;");
  });

  test("author with all five XML special chars is fully escaped", () => {
    const xml = wrapAsInsertion(
      [textRun("text")],
      `<w:del w:id="0">it's & "fun"`,
      "2024-01-01T00:00:00Z",
      "2",
    );

    expect(xml).not.toContain('<w:del');
    expect(xml).toContain("&lt;w:del");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&apos;");
    expect(xml).toContain("&amp;");
  });

  test("date with special chars is escaped", () => {
    const xml = wrapAsInsertion(
      [textRun("text")],
      "Alice",
      "<bad-date>",
      "3",
    );

    expect(xml).not.toContain("<bad-date>");
    expect(xml).toContain("&lt;bad-date&gt;");
  });

  test("id with special chars is escaped", () => {
    const xml = wrapAsInsertion(
      [textRun("text")],
      "Alice",
      "2024-01-01T00:00:00Z",
      "<injected-id>",
    );

    expect(xml).not.toContain("<injected-id>");
    expect(xml).toContain("&lt;injected-id&gt;");
  });

  test("clean ASCII author/date/id passes through unchanged", () => {
    const xml = wrapAsInsertion(
      [textRun("hello world")],
      "Alice Smith",
      "2024-01-01T00:00:00Z",
      "42",
    );

    expect(xml).toContain('w:author="Alice Smith"');
    expect(xml).toContain('w:date="2024-01-01T00:00:00Z"');
    expect(xml).toContain('w:id="42"');
  });

  test("produces a valid w:ins XML fragment", () => {
    const xml = wrapAsInsertion(
      [textRun("inserted")],
      "Bob",
      "2024-06-01T10:00:00Z",
      "7",
    );

    expect(xml).toMatch(/^<w:ins /);
    expect(xml).toContain("</w:ins>");
    expect(xml).toContain("<w:r>");
    expect(xml).toContain("inserted");
  });
});

// ---------------------------------------------------------------------------
// wrapAsDeletion — XML attribute escaping
// ---------------------------------------------------------------------------

describe("wrapAsDeletion — XML attribute escaping", () => {
  test("author containing <script> tags is escaped in w:del attribute", () => {
    const xml = wrapAsDeletion(
      [textRun("old text")],
      "<script>alert(1)</script>",
      "2024-01-01T00:00:00Z",
      "1",
    );

    expect(xml).not.toContain('<script>alert(1)</script>');
    expect(xml).toContain("&lt;script&gt;");
  });

  test("author with angle brackets does not break XML structure", () => {
    const maliciousAuthor = '<w:del w:id="0">';
    const xml = wrapAsDeletion(
      [textRun("deleted text")],
      maliciousAuthor,
      "2024-01-01T00:00:00Z",
      "99",
    );

    // The xml string must not contain unescaped < or > within attribute values.
    // Check that the xml does not open a spurious element from the author string.
    expect(xml).not.toMatch(/w:author="<w:del/);
    expect(xml).toContain("&lt;w:del");
    expect(xml).toContain("&gt;");
  });

  test("clean ASCII passes through unchanged", () => {
    const xml = wrapAsDeletion(
      [textRun("removed")],
      "Carol",
      "2024-06-15T09:30:00Z",
      "12",
    );

    expect(xml).toContain('w:author="Carol"');
    expect(xml).toContain('w:date="2024-06-15T09:30:00Z"');
    expect(xml).toContain('w:id="12"');
  });

  test("produces a valid w:del XML fragment with w:delText", () => {
    const xml = wrapAsDeletion(
      [textRun("deleted")],
      "Dan",
      "2024-06-01T00:00:00Z",
      "5",
    );

    expect(xml).toMatch(/^<w:del /);
    expect(xml).toContain("</w:del>");
    expect(xml).toContain("<w:delText");
    expect(xml).toContain("deleted");
  });
});
