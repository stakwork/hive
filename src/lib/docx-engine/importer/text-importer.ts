/**
 * Extracts text from a w:t node, respecting xml:space="preserve".
 *
 * fast-xml-parser can produce two forms for w:t depending on whether
 * w:t has attributes:
 *   - plain string: `"hello"` (no attributes, isArray wraps it as `["hello"]`)
 *   - object: `{ "#text": "hello", "@_xml:space": "preserve" }` (has attrs)
 *
 * Callers pass individual items already unwrapped from the array.
 */

import { OoxmlNode } from "../types/ooxml";
import { attrValue } from "../core/xml-access";

/**
 * Extract text content from a single w:t value (already unwrapped from isArray).
 * Handles both the plain-string form and the object form.
 */
export function importText(
  tNode: OoxmlNode | string | undefined
): string {
  if (!tNode) return "";

  // fast-xml-parser renders <w:t>plain</w:t> as the string "plain" when
  // the element has no attributes (even with isArray, each array item may be
  // a primitive string).
  if (typeof tNode === "string") return tNode;
  if (typeof tNode === "number") return String(tNode);

  const raw = tNode["#text"];
  const text = raw !== undefined ? String(raw) : "";

  // xml:space is stored as @_xml:space by fast-xml-parser
  const space = attrValue(tNode as OoxmlNode, "xml:space");
  if (space === "preserve") {
    return text;
  }

  return text;
}
