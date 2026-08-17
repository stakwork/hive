/**
 * Run property importer using the preserveOrder OrderedNode system.
 * The actual run content import is handled in paragraph-importer.ts
 * which has the full inline context.
 */

import { RunProperties } from "../types/document";
import {
  OrderedNode,
  orderedTagName,
  orderedChildren,
  orderedAttr,
} from "./document-importer";
import { halfPointsToPx } from "../core/units";

/**
 * Import w:rPr properties from an OrderedNode.
 */
export function importRunPropertiesOrdered(
  rPrNode: OrderedNode
): RunProperties {
  const children = orderedChildren(rPrNode);
  const props: RunProperties = {};

  for (const child of children) {
    const tag = orderedTagName(child);

    if (tag === "w:b") {
      const val = orderedAttr(child, "w:val");
      if (val !== "0" && val !== "false") props.bold = true;
    } else if (tag === "w:i") {
      const val = orderedAttr(child, "w:val");
      if (val !== "0" && val !== "false") props.italic = true;
    } else if (tag === "w:strike" || tag === "w:dstrike") {
      const val = orderedAttr(child, "w:val");
      if (val !== "0" && val !== "false") props.strikethrough = true;
    } else if (tag === "w:u") {
      const val = orderedAttr(child, "w:val");
      if (val && val !== "none") props.underline = true;
    } else if (tag === "w:sz") {
      const val = orderedAttr(child, "w:val");
      if (val) props.fontSize = halfPointsToPx(Number(val));
    } else if (tag === "w:color") {
      const val = orderedAttr(child, "w:val");
      if (val && val !== "auto") props.color = val;
    } else if (tag === "w:rFonts") {
      const ascii = orderedAttr(child, "w:ascii") ?? orderedAttr(child, "w:hAnsi");
      if (ascii) props.fontFamily = ascii;
    } else if (tag === "w:vertAlign") {
      const val = orderedAttr(child, "w:val");
      if (val === "superscript" || val === "subscript") props.vertAlign = val;
    } else if (tag === "w:rStyle") {
      const val = orderedAttr(child, "w:val");
      if (val) props.styleId = val;
    }
  }

  return props;
}

// Re-export legacy names for backward compat
export { importRunPropertiesOrdered as importRunProperties };
