/**
 * Blackline (redline) generation.
 *
 * Compares two DocxDocuments at the paragraph-text level and returns a new
 * DocxDocument whose paragraphs are annotated with w:ins / w:del track-change
 * marks representing the diff.
 *
 * Uses diffArrays() from the 'diff' package (already in package.json) —
 * no custom diff algorithm is implemented here.
 */

import { diffArrays } from "diff";
import {
  DocxDocument,
  DocxParagraph,
  DocxBlock,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";
import {
  TrackChangeType,
  TrackChangeStatus,
} from "@/lib/docx-engine/types/track-changes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BLACKLINE_AUTHOR = "Blackline";

let _seq = 0;
function newId(prefix: string): string {
  return `${prefix}-bl-${Date.now()}-${++_seq}`;
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

function paragraphToText(para: DocxParagraph): string {
  return para.runs
    .filter((r) => r.kind === "text")
    .map((r) => (r as DocxTextRun).text)
    .join("");
}

/**
 * Build a paragraph node whose single text run carries a track-change mark.
 */
function makeTrackedParagraph(
  text: string,
  type: TrackChangeType.INSERTION | TrackChangeType.DELETION
): DocxParagraph {
  const changeId = newId("tc");
  const runId = newId("run");
  const paraId = newId("para");
  const date = new Date().toISOString();

  const run: DocxTextRun = {
    kind: "text",
    id: runId,
    text,
    properties: {},
    trackChange: {
      id: changeId,
      type,
      status: TrackChangeStatus.PENDING,
      author: BLACKLINE_AUTHOR,
      date,
    },
  };

  return {
    kind: "paragraph",
    id: paraId,
    properties: {},
    runs: [run],
  };
}

/**
 * Build an unchanged paragraph from the original paragraph structure.
 * We copy the full paragraph (including formatting) from docA.
 */
function cloneParagraphAsUnchanged(para: DocxParagraph): DocxParagraph {
  return {
    ...para,
    id: newId("para"),
    runs: para.runs.map((r) => ({ ...r, id: newId("run"), trackChange: undefined })),
  };
}

// ─── generateBlackline ────────────────────────────────────────────────────────

/**
 * Generate a blacklined document showing the textual differences between
 * docA (base) and docB (revised) at the paragraph level.
 *
 * - Paragraphs added in docB appear as insertions (green).
 * - Paragraphs removed from docA appear as deletions (red).
 * - Unchanged paragraphs are carried through as plain text.
 *
 * The returned document inherits docA's metadata (styles, numbering, section
 * properties) since it is the "base" document.
 */
export function generateBlackline(
  docA: DocxDocument,
  docB: DocxDocument
): DocxDocument {
  const parasA = paragraphsFromDoc(docA);
  const parasB = paragraphsFromDoc(docB);

  const textsA = parasA.map(paragraphToText);
  const textsB = parasB.map(paragraphToText);

  // diffArrays compares the two text arrays using the Myers diff algorithm.
  const changes = diffArrays(textsA, textsB);

  const blocks: DocxBlock[] = [];

  // We track positions in parasA to copy original paragraph formatting for
  // unchanged and removed paragraphs.
  let posA = 0;

  for (const change of changes) {
    const count = change.count ?? change.value.length;

    if (change.removed) {
      // These paragraphs exist in A but not in B → deletions
      for (let i = 0; i < count; i++) {
        const text = textsA[posA + i] ?? change.value[i] ?? "";
        blocks.push(makeTrackedParagraph(text, TrackChangeType.DELETION));
      }
      posA += count;
    } else if (change.added) {
      // These paragraphs exist in B but not in A → insertions
      for (const text of change.value) {
        blocks.push(makeTrackedParagraph(text, TrackChangeType.INSERTION));
      }
      // posA stays the same (no consumption from A)
    } else {
      // Unchanged — copy from docA to preserve formatting
      for (let i = 0; i < count; i++) {
        const original = parasA[posA + i];
        if (original) {
          blocks.push(cloneParagraphAsUnchanged(original));
        } else {
          // Safety fallback — should not happen
          const text = change.value[i] ?? "";
          const fallback: DocxParagraph = {
            kind: "paragraph",
            id: newId("para"),
            properties: {},
            runs: text
              ? [{ kind: "text", id: newId("run"), text, properties: {} }]
              : [],
          };
          blocks.push(fallback);
        }
      }
      posA += count;
    }
  }

  return {
    id: newId("doc"),
    filename: `blackline-${docA.filename}`,
    blocks,
    comments: [],
    styles: new Map(docA.styles),
    numbering: {
      abstractDefs: new Map(docA.numbering.abstractDefs),
      numDefs: new Map(docA.numbering.numDefs),
    },
    sectionProperties: { ...docA.sectionProperties },
    imageUrls: new Map(),
  };
}
