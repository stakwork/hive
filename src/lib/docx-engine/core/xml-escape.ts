/**
 * XML attribute and text escaping.
 *
 * Must be called on EVERY string interpolated into an XML attribute
 * in the exporter layer: w:author, w:date, w:id, comment body, etc.
 */

/**
 * Escape a string for safe use as an XML attribute value.
 * Handles all five XML special characters.
 */
export function xmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape a string for safe use as XML text content.
 * Only three characters need escaping in text nodes (not attribute context).
 */
export function xmlTextEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
