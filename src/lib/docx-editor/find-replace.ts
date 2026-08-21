/**
 * Find & Replace across one or more DocxDocument instances.
 *
 * Search is performed on the plain text content of each run.
 * Case-insensitive by default; opt-in case-sensitive toggle via FindOpts.
 */

import {
  DocxDocument,
  DocxBlock,
  DocxParagraph,
  DocxInlineNode,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FindOpts {
  caseSensitive?: boolean; // default: false
}

export interface Match {
  /** Index of the document in the array passed to replaceInDocs (0-based). */
  docIndex: number;
  /** ID of the run that contains this match. */
  runId: string;
  /** Character offset within the run's text where the match starts. */
  offset: number;
  /** Length of the matched substring. */
  length: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function textRunsFromParagraphs(paras: DocxParagraph[]): DocxTextRun[] {
  const runs: DocxTextRun[] = [];
  for (const para of paras) {
    for (const run of para.runs) {
      if (run.kind === "text") runs.push(run);
    }
  }
  return runs;
}

// ─── findMatches ──────────────────────────────────────────────────────────────

/**
 * Find all occurrences of `query` within a single DocxDocument.
 *
 * docIndex is always set to 0 here — callers that aggregate across multiple
 * documents should set docIndex themselves (see replaceInDocs).
 */
export function findMatches(
  doc: DocxDocument,
  query: string,
  opts: FindOpts = {},
  docIndex = 0
): Match[] {
  if (!query) return [];

  const { caseSensitive = false } = opts;
  const matches: Match[] = [];

  const runs = textRunsFromParagraphs(paragraphsFromDoc(doc));

  for (const run of runs) {
    const haystack = caseSensitive ? run.text : run.text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();

    let startIndex = 0;
    while (startIndex < haystack.length) {
      const idx = haystack.indexOf(needle, startIndex);
      if (idx === -1) break;
      matches.push({
        docIndex,
        runId: run.id,
        offset: idx,
        length: query.length,
      });
      startIndex = idx + query.length;
    }
  }

  return matches;
}

// ─── replaceInDocs ────────────────────────────────────────────────────────────

/**
 * Replace all occurrences of `query` with `replacement` across multiple documents.
 *
 * Returns new document instances (immutable) plus a summary of how many
 * replacements were made in each affected document.
 */
export function replaceInDocs(
  docs: DocxDocument[],
  query: string,
  replacement: string,
  opts: FindOpts = {}
): {
  docs: DocxDocument[];
  summary: Array<{ docIndex: number; count: number }>;
} {
  if (!query) return { docs, summary: [] };

  const { caseSensitive = false } = opts;
  const summary: Array<{ docIndex: number; count: number }> = [];

  const newDocs = docs.map((doc, docIndex) => {
    const matches = findMatches(doc, query, opts, docIndex);
    if (matches.length === 0) return doc;

    summary.push({ docIndex, count: matches.length });

    // Build a set of run IDs that have matches for fast lookup
    const runMatchMap = new Map<string, Match[]>();
    for (const m of matches) {
      const arr = runMatchMap.get(m.runId) ?? [];
      arr.push(m);
      runMatchMap.set(m.runId, arr);
    }

    function replaceRunText(run: DocxTextRun): DocxTextRun {
      const matchesInRun = runMatchMap.get(run.id);
      if (!matchesInRun || matchesInRun.length === 0) return run;

      let newText = run.text;
      // Replace all occurrences — use a regex so we don't have to track offsets
      const flags = caseSensitive ? "g" : "gi";
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      newText = newText.replace(new RegExp(escaped, flags), replacement);

      return { ...run, text: newText };
    }

    function updateRun(run: DocxInlineNode): DocxInlineNode {
      if (run.kind === "text") return replaceRunText(run);
      if (run.kind === "hyperlink") {
        return { ...run, runs: run.runs.map(updateRun) };
      }
      return run;
    }

    function updateParagraph(para: DocxParagraph): DocxParagraph {
      return { ...para, runs: para.runs.map(updateRun) };
    }

    function updateBlock(block: DocxBlock): DocxBlock {
      if (block.kind === "paragraph") return updateParagraph(block);
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            paragraphs: cell.paragraphs.map(updateParagraph),
          })),
        })),
      };
    }

    return { ...doc, blocks: doc.blocks.map(updateBlock) };
  });

  return { docs: newDocs, summary };
}
