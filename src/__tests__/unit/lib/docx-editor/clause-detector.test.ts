import { describe, test, expect } from "vitest";
import { detectClauses } from "@/lib/docx-editor/clause-detector";
import {
  DocxDocument,
  DocxParagraph,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextRun(id: string, text: string): DocxTextRun {
  return { kind: "text", id, text, properties: {} };
}

function makeParagraph(id: string, text: string): DocxParagraph {
  return {
    kind: "paragraph",
    id,
    properties: {},
    runs: [makeTextRun(`${id}-r1`, text)],
  };
}

function makeDoc(paras: DocxParagraph[]): DocxDocument {
  return {
    id: "test-doc",
    filename: "test.docx",
    blocks: paras,
    comments: [],
    styles: new Map(),
    numbering: { abstractDefs: new Map(), numDefs: new Map() },
    sectionProperties: {},
    imageUrls: new Map(),
  };
}

// ─── detectClauses ────────────────────────────────────────────────────────────

describe("detectClauses", () => {
  test("returns empty array for a document with no matching paragraphs", () => {
    const doc = makeDoc([
      makeParagraph("p1", "This is an introductory sentence with no clause number."),
      makeParagraph("p2", "Another plain paragraph."),
    ]);
    expect(detectClauses(doc)).toHaveLength(0);
  });

  test("detects Article / Section at depth 0 (case-insensitive)", () => {
    const doc = makeDoc([
      makeParagraph("p1", "Article 1 Definitions"),
      makeParagraph("p2", "Section 2 Scope"),
      makeParagraph("p3", "ARTICLE 3 Representations"),
      makeParagraph("p4", "section 4 Warranties"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(4);
    for (const c of clauses) {
      expect(c.depth).toBe(0);
    }
  });

  test("detects /^\\d+\\./ at depth 1", () => {
    const doc = makeDoc([
      makeParagraph("p1", "1. General Provisions"),
      makeParagraph("p2", "2. Definitions"),
      makeParagraph("p3", "10. Miscellaneous"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(3);
    for (const c of clauses) {
      expect(c.depth).toBe(1);
    }
  });

  test("detects /^\\d+\\.\\d+/ at depth 2", () => {
    const doc = makeDoc([
      makeParagraph("p1", "1.1 Interpretation"),
      makeParagraph("p2", "2.3 Representations"),
      makeParagraph("p3", "10.12 Miscellaneous sub-clause"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(3);
    for (const c of clauses) {
      expect(c.depth).toBe(2);
    }
  });

  test("detects /^\\([a-z]+\\)/ at depth 3", () => {
    const doc = makeDoc([
      makeParagraph("p1", "(a) first lettered sub-clause"),
      makeParagraph("p2", "(b) second lettered sub-clause"),
      makeParagraph("p3", "(z) last lettered sub-clause"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(3);
    for (const c of clauses) {
      expect(c.depth).toBe(3);
    }
  });

  test("detects /^\\([ivx]+\\)/ at depth 4", () => {
    const doc = makeDoc([
      makeParagraph("p1", "(i) first roman sub-clause"),
      makeParagraph("p2", "(ii) second roman sub-clause"),
      makeParagraph("p3", "(iv) fourth roman sub-clause"),
      makeParagraph("p4", "(xiv) fourteenth roman sub-clause"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(4);
    for (const c of clauses) {
      expect(c.depth).toBe(4);
    }
  });

  test("all five depth levels are represented in a mixed document", () => {
    const doc = makeDoc([
      makeParagraph("p1", "Article 1 Definitions"),        // depth 0
      makeParagraph("p2", "1. General Provisions"),         // depth 1
      makeParagraph("p3", "1.1 Interpretation"),            // depth 2
      makeParagraph("p4", "(a) sub-clause alpha"),          // depth 3
      makeParagraph("p5", "(i) sub-sub-clause roman"),      // depth 4
    ]);

    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(5);

    const depths = clauses.map((c) => c.depth);
    expect(depths).toContain(0);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
    expect(depths).toContain(3);
    expect(depths).toContain(4);
  });

  test("paraId and text are correctly captured", () => {
    const doc = makeDoc([
      makeParagraph("para-abc", "Article 5 Indemnification"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses[0].paraId).toBe("para-abc");
    expect(clauses[0].text).toBe("Article 5 Indemnification");
  });

  test("non-matching paragraphs are skipped", () => {
    const doc = makeDoc([
      makeParagraph("p1", "This is a plain paragraph."),
      makeParagraph("p2", "Article 2 Scope"),
      makeParagraph("p3", "Another plain paragraph."),
      makeParagraph("p4", "1. Definitions"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(2);
    expect(clauses[0].paraId).toBe("p2");
    expect(clauses[1].paraId).toBe("p4");
  });

  test("preserves document order in output", () => {
    const doc = makeDoc([
      makeParagraph("p1", "Article 1 Title"),
      makeParagraph("p2", "Plain text."),
      makeParagraph("p3", "1. Clause one"),
      makeParagraph("p4", "Plain text again."),
      makeParagraph("p5", "(a) sub-clause"),
    ]);
    const clauses = detectClauses(doc);
    expect(clauses.map((c) => c.paraId)).toEqual(["p1", "p3", "p5"]);
  });

  test("empty document returns empty array", () => {
    const doc = makeDoc([]);
    expect(detectClauses(doc)).toHaveLength(0);
  });

  test("empty paragraphs are skipped", () => {
    const emptyPara: DocxParagraph = {
      kind: "paragraph",
      id: "p-empty",
      properties: {},
      runs: [],
    };
    const doc = makeDoc([emptyPara, makeParagraph("p1", "Article 1 Scope")]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].paraId).toBe("p1");
  });

  test("(i) roman pattern does not match (a) letter pattern", () => {
    // (a) should be depth 3, not depth 4
    const doc = makeDoc([makeParagraph("p1", "(a) alpha sub-clause")]);
    const clauses = detectClauses(doc);
    expect(clauses[0].depth).toBe(3);
  });

  test("Section with no number does not match (only 'Section N' matches)", () => {
    // "Section" without a following digit should not match the depth-0 pattern
    const doc = makeDoc([
      makeParagraph("p1", "Section 1 Definitions"), // should match
      makeParagraph("p2", "Section Definitions"),    // should NOT match (/Section\s+\d+/)
    ]);
    const clauses = detectClauses(doc);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].paraId).toBe("p1");
  });
});
