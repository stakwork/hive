/**
 * XML helpers for serialising tracked changes back into OOXML.
 *
 * ALL w:author, w:date, w:id values pass through xmlAttrEscape().
 */

import { xmlAttrEscape } from "../core/xml-escape";
import { DocxInlineNode } from "../types/document";
import { TrackChangeType } from "../types/track-changes";

/**
 * Serialise a single DocxTextRun's text content as a w:t element.
 * Preserves leading/trailing whitespace with xml:space="preserve".
 */
function serializeWt(text: string): string {
  const needsPreserve = text !== text.trim() || text.includes("  ");
  const spaceAttr = needsPreserve ? ' xml:space="preserve"' : "";
  // Escape text content (& < > only — not attribute escaping)
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<w:t${spaceAttr}>${escaped}</w:t>`;
}

/**
 * Serialise run properties to a <w:rPr> element string.
 * Returns empty string if no properties are set.
 */
function serializeRpr(run: DocxInlineNode): string {
  if (run.kind !== "text" && run.kind !== "image") return "";
  const props = run.properties;
  const parts: string[] = [];
  if (props.bold) parts.push("<w:b/>");
  if (props.italic) parts.push("<w:i/>");
  if (props.underline) parts.push('<w:u w:val="single"/>');
  if (props.strikethrough) parts.push("<w:strike/>");
  if (props.fontSize !== undefined) {
    const halfPts = Math.round(props.fontSize * 1.5); // px back to half-pts (approx)
    parts.push(`<w:sz w:val="${halfPts}"/>`);
  }
  if (props.color) parts.push(`<w:color w:val="${xmlAttrEscape(props.color)}"/>`);
  if (parts.length === 0) return "";
  return `<w:rPr>${parts.join("")}</w:rPr>`;
}

/**
 * Serialise a single inline run to its w:r XML.
 */
function serializeRun(run: DocxInlineNode): string {
  if (run.kind === "break") {
    const typeAttr =
      run.breakType !== "line"
        ? ` w:type="${xmlAttrEscape(run.breakType)}"`
        : "";
    return `<w:r><w:br${typeAttr}/></w:r>`;
  }
  if (run.kind === "text") {
    const rpr = serializeRpr(run);
    return `<w:r>${rpr}${serializeWt(run.text)}</w:r>`;
  }
  if (run.kind === "image") {
    // Images are preserved verbatim from the original ZIP; skip re-serializing
    return "";
  }
  if (run.kind === "hyperlink") {
    const innerRuns = run.runs.map(serializeRun).join("");
    return `<w:hyperlink><w:r>${innerRuns}</w:r></w:hyperlink>`;
  }
  return "";
}

/**
 * Wrap a set of run nodes as a w:ins element.
 */
export function wrapAsInsertion(
  runs: DocxInlineNode[],
  author: string,
  date: string,
  id: string
): string {
  const escapedAuthor = xmlAttrEscape(author);
  const escapedDate = xmlAttrEscape(date);
  const escapedId = xmlAttrEscape(id);
  const innerXml = runs.map(serializeRun).join("");
  return (
    `<w:ins w:id="${escapedId}" w:author="${escapedAuthor}" w:date="${escapedDate}">` +
    innerXml +
    `</w:ins>`
  );
}

/**
 * Wrap a set of run nodes as a w:del element.
 * Text runs inside w:del use w:delText instead of w:t.
 */
export function wrapAsDeletion(
  runs: DocxInlineNode[],
  author: string,
  date: string,
  id: string
): string {
  const escapedAuthor = xmlAttrEscape(author);
  const escapedDate = xmlAttrEscape(date);
  const escapedId = xmlAttrEscape(id);

  const innerXml = runs
    .map((run) => {
      if (run.kind === "text") {
        const needsPreserve =
          run.text !== run.text.trim() || run.text.includes("  ");
        const spaceAttr = needsPreserve ? ' xml:space="preserve"' : "";
        const escaped = run.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const rpr = serializeRpr(run);
        return `<w:r>${rpr}<w:delText${spaceAttr}>${escaped}</w:delText></w:r>`;
      }
      return serializeRun(run);
    })
    .join("");

  return (
    `<w:del w:id="${escapedId}" w:author="${escapedAuthor}" w:date="${escapedDate}">` +
    innerXml +
    `</w:del>`
  );
}

export { serializeRun };
