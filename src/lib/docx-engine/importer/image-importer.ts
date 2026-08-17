/**
 * Resolves images from the DOCX ZIP and creates blob object URLs.
 *
 * Returns Map<relationshipId, objectUrl>.
 * The caller is responsible for calling URL.revokeObjectURL() on all
 * URLs when the document is closed to avoid memory leaks.
 */

import JSZip from "jszip";
import { RelationshipMap } from "../core/rels-resolver";
import { REL_TYPES } from "../core/namespace";

/**
 * Build a map of relationship ID → blob object URL for all image relationships.
 *
 * Images in a DOCX are stored under word/media/ and referenced via
 * relationship targets like "media/image1.png".
 *
 * This function is designed for browser environments where
 * URL.createObjectURL is available. In Node/test environments, it
 * falls back gracefully (returns empty map if createObjectURL is absent).
 */
export async function importImages(
  zip: JSZip,
  rels: RelationshipMap
): Promise<Map<string, string>> {
  const imageUrls = new Map<string, string>();

  // Only process image relationships
  const imageRels = Array.from(rels.values()).filter((rel) =>
    rel.type === REL_TYPES.IMAGE
  );

  for (const rel of imageRels) {
    // target is relative to word/ e.g. "media/image1.png"
    const zipPath = rel.target.startsWith("/")
      ? rel.target.slice(1)
      : `word/${rel.target}`;

    const file = zip.file(zipPath);
    if (!file) continue;

    try {
      const blob = await file.async("blob");

      // Detect MIME type from extension
      const ext = zipPath.split(".").pop()?.toLowerCase() ?? "";
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        bmp: "image/bmp",
        tiff: "image/tiff",
        tif: "image/tiff",
        svg: "image/svg+xml",
        emf: "image/emf",
        wmf: "image/wmf",
      };
      const mimeType = mimeTypes[ext] ?? "application/octet-stream";

      // Re-create blob with correct MIME type
      const typedBlob = new Blob([await blob.arrayBuffer()], {
        type: mimeType,
      });

      // createObjectURL may not be available in Node.js test environments
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const objectUrl = URL.createObjectURL(typedBlob);
        imageUrls.set(rel.id, objectUrl);
      }
    } catch {
      // Skip images that fail to load
    }
  }

  return imageUrls;
}
