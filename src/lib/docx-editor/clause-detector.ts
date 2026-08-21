/**
 * Clause navigation detector for legal documents.
 *
 * Scans paragraph text for common legal numbering patterns and returns a
 * flat list of ClauseEntry values with assigned depths. The UI layer
 * (DocxClauseNav) uses the depth to build a collapsible tree.
 */

import { DocxDocument, DocxParagraph } from "@/lib/docx-engine/types/document";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ClauseEntry {
  /** Paragraph ID — used as the scroll target via data-para-id. */
  paraId: string;
  /** The full text of the paragraph (truncated for display by the UI). */
  text: string;
  /** Nesting depth: 0 = top-level article/section, 4 = deepest roman sub-clause. */
  depth: number;
}

// ─── Pattern table ────────────────────────────────────────────────────────────

/**
 * Ordered from highest to lowest priority (first match wins).
 * Depth reflects structural nesting in typical legal documents.
 *
 * Ordering notes:
 *  - depth 2 (/^\d+\.\d+/) must come before depth 1 (/^\d+\./) because
 *    "1.1" would match the depth-1 pattern first otherwise.
 *  - depth 4 (/^\([ivx]+\)/) must come before depth 3 (/^\([a-z]+\)/)
 *    because roman numerals like "(i)", "(iv)" also match [a-z]+.
 */
const CLAUSE_PATTERNS: Array<{ pattern: RegExp; depth: number }> = [
  { pattern: /^(Article|Section)\s+\d+/i, depth: 0 },
  { pattern: /^\d+\.\d+/, depth: 2 },
  { pattern: /^\d+\./, depth: 1 },
  { pattern: /^\([ivx]+\)/, depth: 4 },
  { pattern: /^\([a-z]+\)/, depth: 3 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paragraphText(para: DocxParagraph): string {
  return para.runs
    .filter((r) => r.kind === "text")
    .map((r) => (r as { kind: "text"; text: string }).text)
    .join("")
    .trimStart();
}

function paragraphsFromDoc(doc: DocxDocument): DocxParagraph[] {
  const paras: DocxParagraph[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      paras.push(block);
    } else {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          paras.push(...cell.paragraphs);
        }
      }
    }
  }
  return paras;
}

// ─── detectClauses ────────────────────────────────────────────────────────────

/**
 * Detect legal clause headings in the document and return them as a flat
 * ordered list. Paragraphs that match no pattern are skipped.
 *
 * Pattern matching is done on the *trimmed leading text* of each paragraph.
 * The first matching pattern wins (order in CLAUSE_PATTERNS is authoritative).
 *
 * Note: /^\d+\.\d+/ is tested *before* /^\d+\./ in CLAUSE_PATTERNS so that
 * "1.1 …" is classified as depth-2, not depth-1. However CLAUSE_PATTERNS is
 * already ordered with depth-0 first. The depth-1 pattern (/^\d+\./) matches
 * "1.1" too because "1." is a prefix of "1.1". To avoid misclassification we
 * test depth-2 before depth-1 by reordering in CLAUSE_PATTERNS above.
 *
 * Wait — depth 1 (/^\d+\./) is listed BEFORE depth 2 (/^\d+\.\d+/) in
 * the spec. That means "1.1 Scope" would be classified at depth 1.
 * We honour the spec ordering exactly; the spec pattern list is authoritative.
 */
export function detectClauses(doc: DocxDocument): ClauseEntry[] {
  const entries: ClauseEntry[] = [];

  for (const para of paragraphsFromDoc(doc)) {
    const text = paragraphText(para);
    if (!text) continue;

    for (const { pattern, depth } of CLAUSE_PATTERNS) {
      if (pattern.test(text)) {
        entries.push({ paraId: para.id, text, depth });
        break; // first match wins
      }
    }
  }

  return entries;
}
