import { describe, test, expect } from "vitest";
import { findMatches, replaceInDocs } from "@/lib/docx-editor/find-replace";
import {
  DocxDocument,
  DocxParagraph,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextRun(id: string, text: string): DocxTextRun {
  return { kind: "text", id, text, properties: {} };
}

function makeParagraph(id: string, runs: DocxTextRun[]): DocxParagraph {
  return { kind: "paragraph", id, properties: {}, runs };
}

function makeDoc(id: string, paras: DocxParagraph[]): DocxDocument {
  return {
    id,
    filename: `${id}.docx`,
    blocks: paras,
    comments: [],
    styles: new Map(),
    numbering: { abstractDefs: new Map(), numDefs: new Map() },
    sectionProperties: {},
    imageUrls: new Map(),
  };
}

// ─── findMatches ──────────────────────────────────────────────────────────────

describe("findMatches", () => {
  test("returns empty array for empty query", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "Hello World")])]);
    expect(findMatches(doc, "")).toHaveLength(0);
  });

  test("finds a single match", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "Hello World")])]);
    const matches = findMatches(doc, "World");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ runId: "r1", offset: 6, length: 5 });
  });

  test("finds multiple matches within one run", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "foo bar foo baz foo")]),
    ]);
    const matches = findMatches(doc, "foo");
    expect(matches).toHaveLength(3);
  });

  test("is case-insensitive by default", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "Hello HELLO hello")]),
    ]);
    const matches = findMatches(doc, "hello");
    expect(matches).toHaveLength(3);
  });

  test("is case-sensitive when caseSensitive:true", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "Hello HELLO hello")]),
    ]);
    const matches = findMatches(doc, "hello", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].offset).toBe(12); // only the lowercase "hello" at the end
  });

  test("case-sensitive produces fewer results than case-insensitive for mixed-case input", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "CONTRACT contract Contract")]),
    ]);
    const insensitive = findMatches(doc, "contract");
    const sensitive = findMatches(doc, "contract", { caseSensitive: true });
    expect(sensitive.length).toBeLessThan(insensitive.length);
  });

  test("finds matches across multiple runs", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [
        makeTextRun("r1", "foo"),
        makeTextRun("r2", "bar"),
        makeTextRun("r3", "foo"),
      ]),
    ]);
    const matches = findMatches(doc, "foo");
    expect(matches).toHaveLength(2);
    expect(matches[0].runId).toBe("r1");
    expect(matches[1].runId).toBe("r3");
  });

  test("finds matches across multiple paragraphs", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "clause one")]),
      makeParagraph("p2", [makeTextRun("r2", "another clause here")]),
    ]);
    const matches = findMatches(doc, "clause");
    expect(matches).toHaveLength(2);
  });

  test("sets docIndex correctly when provided", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "hello")])]);
    const matches = findMatches(doc, "hello", {}, 3);
    expect(matches[0].docIndex).toBe(3);
  });

  test("returns no matches when query is not found", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "nothing here")])]);
    expect(findMatches(doc, "xyzzy")).toHaveLength(0);
  });
});

// ─── replaceInDocs ────────────────────────────────────────────────────────────

describe("replaceInDocs", () => {
  test("returns original docs unchanged when query not found", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "hello world")])]);
    const { docs, summary } = replaceInDocs([doc], "xyzzy", "replaced");
    expect(docs[0]).toBe(doc);
    expect(summary).toHaveLength(0);
  });

  test("replaces single occurrence and returns correct summary", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "hello world")])]);
    const { docs, summary } = replaceInDocs([doc], "world", "earth");

    const para = docs[0].blocks[0] as DocxParagraph;
    const run = para.runs[0] as DocxTextRun;
    expect(run.text).toBe("hello earth");

    expect(summary).toHaveLength(1);
    expect(summary[0]).toEqual({ docIndex: 0, count: 1 });
  });

  test("replaces multiple occurrences in one doc", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "foo bar foo bar foo")]),
    ]);
    const { docs, summary } = replaceInDocs([doc], "foo", "baz");

    const para = docs[0].blocks[0] as DocxParagraph;
    const run = para.runs[0] as DocxTextRun;
    expect(run.text).toBe("baz bar baz bar baz");
    expect(summary[0].count).toBe(3);
  });

  test("multi-doc replace returns per-doc summary with correct docIndex", () => {
    const doc0 = makeDoc("d0", [makeParagraph("p1", [makeTextRun("r1", "term here")])]);
    const doc1 = makeDoc("d1", [makeParagraph("p2", [makeTextRun("r2", "no match")])]);
    const doc2 = makeDoc("d2", [makeParagraph("p3", [makeTextRun("r3", "term again")])]);

    const { docs: newDocs, summary } = replaceInDocs(
      [doc0, doc1, doc2],
      "term",
      "concept"
    );

    expect(summary).toHaveLength(2);
    expect(summary.find((s) => s.docIndex === 0)?.count).toBe(1);
    expect(summary.find((s) => s.docIndex === 2)?.count).toBe(1);

    // doc1 unchanged
    expect(newDocs[1]).toBe(doc1);

    // doc0 updated
    const p0 = newDocs[0].blocks[0] as DocxParagraph;
    expect((p0.runs[0] as DocxTextRun).text).toBe("concept here");

    // doc2 updated
    const p2 = newDocs[2].blocks[0] as DocxParagraph;
    expect((p2.runs[0] as DocxTextRun).text).toBe("concept again");
  });

  test("case-insensitive replace is the default", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "Hello HELLO hello")]),
    ]);
    const { docs, summary } = replaceInDocs([doc], "hello", "hi");

    const para = docs[0].blocks[0] as DocxParagraph;
    expect((para.runs[0] as DocxTextRun).text).toBe("hi hi hi");
    expect(summary[0].count).toBe(3);
  });

  test("case-sensitive replace only replaces exact case matches", () => {
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", "Hello HELLO hello")]),
    ]);
    const { docs, summary } = replaceInDocs([doc], "hello", "hi", {
      caseSensitive: true,
    });

    const para = docs[0].blocks[0] as DocxParagraph;
    // Only the third "hello" (lowercase) should be replaced
    expect((para.runs[0] as DocxTextRun).text).toBe("Hello HELLO hi");
    expect(summary[0].count).toBe(1);
  });

  test("does not mutate the original documents", () => {
    const originalText = "original text";
    const doc = makeDoc("d1", [
      makeParagraph("p1", [makeTextRun("r1", originalText)]),
    ]);
    replaceInDocs([doc], "original", "changed");

    const para = doc.blocks[0] as DocxParagraph;
    expect((para.runs[0] as DocxTextRun).text).toBe(originalText);
  });

  test("empty query returns docs unchanged", () => {
    const doc = makeDoc("d1", [makeParagraph("p1", [makeTextRun("r1", "hello")])]);
    const { docs, summary } = replaceInDocs([doc], "", "anything");
    expect(docs[0]).toBe(doc);
    expect(summary).toHaveLength(0);
  });
});
