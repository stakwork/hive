/**
 * Reassembles a DOCX ZIP from a DocxDocument.
 *
 * Strategy:
 * - Copy ALL parts from the original ZIP verbatim EXCEPT word/document.xml
 *   and word/comments.xml (which are re-serialized).
 * - Any missing part (word/settings.xml, [Content_Types].xml, etc.) would
 *   cause Word/LibreOffice to reject the file, so nothing is dropped.
 */

import JSZip from "jszip";
import { DocxDocument } from "../types/document";
import { serializeDocument } from "./document-exporter";
import { serializeComments } from "./comment-exporter";

/**
 * Build a new DOCX Blob from the given document and original ZIP.
 *
 * @param doc     - The (possibly edited) DocxDocument to serialize.
 * @param originalZip - The original JSZip loaded during import.
 *   Must be kept alive by the caller (not closed/disposed).
 */
export async function buildZip(
  doc: DocxDocument,
  originalZip: JSZip
): Promise<Blob> {
  const outputZip = new JSZip();

  // Step 1: Copy all parts from the original ZIP verbatim
  const files = originalZip.files;
  for (const [path, file] of Object.entries(files)) {
    if (file.dir) continue;

    // Skip only the two parts we re-serialize
    if (path === "word/document.xml" || path === "word/comments.xml") {
      continue;
    }

    // Copy as uint8array to preserve binary content exactly
    const content = await file.async("uint8array");
    outputZip.file(path, content, {
      // Preserve compression settings from original
      compression: file.options.compression ?? "DEFLATE",
    });
  }

  // Step 2: Re-serialize word/document.xml
  const documentXml = serializeDocument(doc);
  outputZip.file("word/document.xml", documentXml, {
    compression: "DEFLATE",
  });

  // Step 3: Re-serialize word/comments.xml
  // Always write it, even if empty, to maintain ZIP integrity
  const commentsXml = serializeComments(doc.comments);
  outputZip.file("word/comments.xml", commentsXml, {
    compression: "DEFLATE",
  });

  // Step 4: Generate final Blob
  const blob = await outputZip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return blob;
}
