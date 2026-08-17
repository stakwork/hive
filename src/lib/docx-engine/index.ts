/**
 * Public API for the DOCX engine.
 *
 * parseDocx(file)           — parse a File into a DocxDocument
 * exportDocx(doc, zip)      — serialise a DocxDocument back to a .docx Blob
 * createDocx()              — create a blank DocxDocument
 */

import JSZip from "jszip";
import { DocxDocument } from "./types/document";
import { importDocument } from "./importer/document-importer";
import { buildZip } from "./exporter/zip-builder";

// Re-export all public types
export type { DocxDocument, DocxBlock, DocxParagraph, DocxTable, DocxTableRow, DocxTableCell, DocxInlineNode, DocxTextRun, DocxImageRun, DocxHyperlinkRun, DocxBreakRun, DocxComment, DocxStyleDef, RunProperties, ParagraphProperties, SectionProperties, NumberingMap, } from "./types/document";
export { TrackChangeType, TrackChangeStatus } from "./types/track-changes";
export type { TrackChangeMark } from "./types/track-changes";
export { DocxStyleCycleError } from "./resolver/style-resolver";
export { resolveRunStyle, resolveParaStyle } from "./resolver/style-resolver";
export { resolveListMarker } from "./resolver/numbering-resolver";
export { xmlAttrEscape, xmlTextEscape } from "./core/xml-escape";
export { twipsToPx, emuToPx, halfPointsToPx, pointsToPx } from "./core/units";

/**
 * Parse a .docx File into a DocxDocument.
 * All parsing happens synchronously in the browser — no server round-trips.
 */
export async function parseDocx(file: File): Promise<DocxDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  return importDocument(zip, file.name);
}

/**
 * Export a DocxDocument back to a .docx Blob.
 *
 * @param doc         - The (possibly edited) document.
 * @param originalZip - The JSZip instance loaded during parseDocx.
 *   All untouched parts are copied verbatim; only word/document.xml
 *   and word/comments.xml are re-serialized.
 */
export async function exportDocx(
  doc: DocxDocument,
  originalZip: JSZip
): Promise<Blob> {
  return buildZip(doc, originalZip);
}

/**
 * Create a blank DocxDocument (empty body, default A4 page).
 */
export function createDocx(filename = "untitled.docx"): DocxDocument {
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename,
    blocks: [],
    comments: [],
    styles: new Map(),
    numbering: {
      abstractDefs: new Map(),
      numDefs: new Map(),
    },
    sectionProperties: {
      pageWidth: 794,
      pageHeight: 1123,
      marginTop: 96,
      marginRight: 96,
      marginBottom: 96,
      marginLeft: 96,
    },
    imageUrls: new Map(),
  };
}

// Also export JSZip so callers don't need a separate import
export { JSZip };
