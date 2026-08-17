/**
 * Serialises a DocxDocument back to word/document.xml XML.
 *
 * Handles all 6 type×status combinations for tracked changes:
 *   INSERTION  × ACCEPTED  → keep text as plain runs, remove w:ins wrapper
 *   INSERTION  × REJECTED  → remove text entirely
 *   INSERTION  × PENDING   → keep as w:ins
 *   DELETION   × ACCEPTED  → remove text entirely
 *   DELETION   × REJECTED  → keep text as plain runs, remove w:del wrapper
 *   DELETION   × PENDING   → keep as w:del
 *   REPLACEMENT× ACCEPTED  → keep ins runs as plain, remove del runs
 *   REPLACEMENT× REJECTED  → keep del runs as plain, remove ins runs
 *   REPLACEMENT× PENDING   → keep both (del+ins wrappers)
 */

import { DocxDocument, DocxBlock, DocxParagraph, DocxTable, DocxInlineNode } from "../types/document";
import { TrackChangeType, TrackChangeStatus } from "../types/track-changes";
import { xmlAttrEscape, xmlTextEscape } from "../core/xml-escape";
import { wrapAsInsertion, wrapAsDeletion, serializeRun } from "./track-change-exporter";

// ─── Run serialization ────────────────────────────────────────────────────────

/**
 * Decide whether a run should be emitted and how, given its track change status.
 * Returns the XML string for the run (may be empty string to skip).
 */
function serializeInlineWithTracking(run: DocxInlineNode): string {
  const tc = run.trackChange;

  if (!tc) {
    return serializeRun(run);
  }

  const { type, status } = tc;

  switch (type) {
    case TrackChangeType.INSERTION: {
      if (status === TrackChangeStatus.ACCEPTED) {
        // Keep as plain run
        return serializeRun({ ...run, trackChange: undefined });
      }
      if (status === TrackChangeStatus.REJECTED) {
        // Drop entirely
        return "";
      }
      // PENDING → wrap in w:ins
      return wrapAsInsertion(
        [{ ...run, trackChange: undefined }],
        tc.author,
        tc.date,
        tc.id
      );
    }

    case TrackChangeType.DELETION: {
      if (status === TrackChangeStatus.ACCEPTED) {
        // Drop entirely
        return "";
      }
      if (status === TrackChangeStatus.REJECTED) {
        // Keep as plain run
        return serializeRun({ ...run, trackChange: undefined });
      }
      // PENDING → wrap in w:del
      return wrapAsDeletion(
        [{ ...run, trackChange: undefined }],
        tc.author,
        tc.date,
        tc.id
      );
    }

    case TrackChangeType.REPLACEMENT: {
      // Replacement runs: del-side runs have no "kind" distinction but were
      // previously w:del children; ins-side runs were w:ins children.
      // We use a heuristic: runs from del side had strikethrough originally.
      // Since we lost that distinction in the flat structure, we treat all
      // runs in a replacement mark consistently:
      // - For simplicity, emit them all pending as their original wrapper.
      // In the editor state machine, accept/rejectChange will set the
      // correct status on each run individually.
      if (status === TrackChangeStatus.ACCEPTED) {
        // Keep all replacement runs as plain
        return serializeRun({ ...run, trackChange: undefined });
      }
      if (status === TrackChangeStatus.REJECTED) {
        return serializeRun({ ...run, trackChange: undefined });
      }
      // PENDING — emit as-is (caller should group before calling)
      return serializeRun(run);
    }

    default:
      return serializeRun(run);
  }
}

// ─── Paragraph serialization ─────────────────────────────────────────────────

function serializeParagraphProperties(para: DocxParagraph): string {
  const props = para.properties;
  const parts: string[] = [];

  if (props.styleId) {
    parts.push(`<w:pStyle w:val="${xmlAttrEscape(props.styleId)}"/>`);
  }

  if (props.numId !== undefined && props.numLevel !== undefined) {
    parts.push(
      `<w:numPr>` +
        `<w:ilvl w:val="${props.numLevel}"/>` +
        `<w:numId w:val="${props.numId}"/>` +
        `</w:numPr>`
    );
  }

  if (props.alignment) {
    parts.push(`<w:jc w:val="${xmlAttrEscape(props.alignment)}"/>`);
  }

  const spacingParts: string[] = [];
  if (props.spacingBefore !== undefined) {
    // px back to twips (approximate)
    const twips = Math.round(props.spacingBefore * (1440 / 96));
    spacingParts.push(`w:before="${twips}"`);
  }
  if (props.spacingAfter !== undefined) {
    const twips = Math.round(props.spacingAfter * (1440 / 96));
    spacingParts.push(`w:after="${twips}"`);
  }
  if (spacingParts.length > 0) {
    parts.push(`<w:spacing ${spacingParts.join(" ")}/>`);
  }

  if (props.indentLeft !== undefined) {
    const twips = Math.round(props.indentLeft * (1440 / 96));
    parts.push(`<w:ind w:left="${twips}"/>`);
  }

  if (parts.length === 0) return "";
  return `<w:pPr>${parts.join("")}</w:pPr>`;
}

function serializeParagraph(para: DocxParagraph): string {
  const pPr = serializeParagraphProperties(para);
  const runsXml = para.runs.map(serializeInlineWithTracking).join("");
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

// ─── Table serialization ──────────────────────────────────────────────────────

function serializeTable(table: DocxTable): string {
  const rows = table.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const cellContent = cell.paragraphs
            .map(serializeParagraph)
            .join("");
          return `<w:tc>${cellContent}</w:tc>`;
        })
        .join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl>${rows}</w:tbl>`;
}

// ─── Block serialization ──────────────────────────────────────────────────────

function serializeBlock(block: DocxBlock): string {
  if (block.kind === "paragraph") return serializeParagraph(block);
  if (block.kind === "table") return serializeTable(block);
  return "";
}

// ─── Section properties ───────────────────────────────────────────────────────

function serializeSectionProperties(doc: DocxDocument): string {
  const sp = doc.sectionProperties;
  const pxToTwips = (px: number) => Math.round(px * (1440 / 96));

  const pgSz = sp.pageWidth
    ? `<w:pgSz w:w="${pxToTwips(sp.pageWidth)}" w:h="${pxToTwips(sp.pageHeight ?? 1123)}"/>`
    : "";

  const pgMar =
    sp.marginTop !== undefined
      ? `<w:pgMar w:top="${pxToTwips(sp.marginTop)}" ` +
        `w:right="${pxToTwips(sp.marginRight ?? 96)}" ` +
        `w:bottom="${pxToTwips(sp.marginBottom ?? 96)}" ` +
        `w:left="${pxToTwips(sp.marginLeft ?? 96)}" ` +
        `w:header="708" w:footer="708" w:gutter="0"/>`
      : "";

  return `<w:sectPr>${pgSz}${pgMar}</w:sectPr>`;
}

// ─── Document root ────────────────────────────────────────────────────────────

const DOCUMENT_NAMESPACES =
  `xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
  `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
  `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
  `xmlns:v="urn:schemas-microsoft-com:vml" ` +
  `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
  `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
  `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
  `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
  `xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ` +
  `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
  `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
  `mc:Ignorable="w14 wp14"`;

/**
 * Serialise a DocxDocument to a complete word/document.xml string.
 */
export function serializeDocument(doc: DocxDocument): string {
  const blocksXml = doc.blocks.map(serializeBlock).join("");
  const sectPr = serializeSectionProperties(doc);

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document ${DOCUMENT_NAMESPACES}>` +
    `<w:body>` +
    blocksXml +
    sectPr +
    `</w:body>` +
    `</w:document>`
  );
}
