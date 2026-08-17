/**
 * Low-level XML node access helpers for fast-xml-parser output.
 *
 * fast-xml-parser is configured with:
 *   attributeNamePrefix: "@_"
 *   ignoreAttributes: false
 *   parseAttributeValue: false  (all attr values as strings)
 *   isArray: always returns arrays for element nodes
 */

import { OoxmlNode } from "../types/ooxml";

/**
 * Find the first child element with the given tag name.
 * Handles both single-object and array forms from fast-xml-parser.
 */
export function findChild(
  node: OoxmlNode | undefined,
  tagName: string
): OoxmlNode | undefined {
  if (!node) return undefined;
  const val = node[tagName];
  if (val === undefined || val === null) return undefined;
  if (Array.isArray(val)) return val[0] as OoxmlNode | undefined;
  if (typeof val === "object") return val as OoxmlNode;
  return undefined;
}

/**
 * Find all child elements with the given tag name.
 * Always returns an array (empty if none found).
 */
export function findChildren(
  node: OoxmlNode | undefined,
  tagName: string
): OoxmlNode[] {
  if (!node) return [];
  const val = node[tagName];
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val as OoxmlNode[];
  if (typeof val === "object") return [val as OoxmlNode];
  return [];
}

/**
 * Read a string attribute value from a node.
 * Attributes are stored with "@_" prefix by fast-xml-parser.
 */
export function attrValue(
  node: OoxmlNode | undefined,
  attrName: string
): string | undefined {
  if (!node) return undefined;
  const key = attrName.startsWith("@_") ? attrName : `@_${attrName}`;
  const val = node[key];
  if (val === undefined || val === null) return undefined;
  return String(val);
}

/**
 * Read all text content from a node and its descendants (depth-first).
 * Concatenates all "#text" values found.
 */
export function textContent(node: OoxmlNode | undefined): string {
  if (!node) return "";
  let result = "";

  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue;
    const val = node[key];
    if (key === "#text") {
      result += String(val ?? "");
    } else if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === "object") {
          result += textContent(child as OoxmlNode);
        }
      }
    } else if (val && typeof val === "object") {
      result += textContent(val as OoxmlNode);
    }
  }

  return result;
}

/**
 * Get the local name from a prefixed tag (e.g. "w:p" → "p").
 */
export function localName(tagName: string): string {
  const colonIdx = tagName.indexOf(":");
  return colonIdx >= 0 ? tagName.slice(colonIdx + 1) : tagName;
}

/**
 * Get all direct child tag names that are element nodes (not attributes).
 */
export function childTagNames(node: OoxmlNode | undefined): string[] {
  if (!node) return [];
  return Object.keys(node).filter((k) => !k.startsWith("@_") && k !== "#text");
}

/**
 * Check if a boolean-style OOXML toggle property is enabled.
 * In OOXML, <w:b/> means bold=true, and <w:b w:val="0"/> means bold=false.
 *
 * fast-xml-parser renders self-closing tags with no attributes as empty
 * string "". We treat that as "present" (i.e. true), same as an empty object.
 */
export function isBoolProp(
  node: OoxmlNode | undefined,
  tagName: string
): boolean {
  if (!node) return false;
  const val = node[tagName];
  if (val === undefined || val === null) return false;
  // Self-closing empty tag → fast-xml-parser gives "" (truthy presence)
  if (val === "") return true;
  if (typeof val !== "object") return true;
  const child = Array.isArray(val) ? (val[0] as OoxmlNode) : (val as OoxmlNode);
  if (!child) return true;
  const wVal = attrValue(child, "w:val");
  // w:val="0" or w:val="false" means explicitly OFF
  if (wVal === "0" || wVal === "false") return false;
  return true;
}
