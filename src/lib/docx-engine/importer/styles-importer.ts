/**
 * Imports w:styles from word/styles.xml into a Map<styleId, DocxStyleDef>.
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { DocxStyleDef, RunProperties, ParagraphProperties } from "../types/document";
import { findChild, findChildren, attrValue, isBoolProp } from "../core/xml-access";
import { halfPointsToPx, twipsToPx } from "../core/units";
import { OoxmlNode } from "../types/ooxml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: (tagName: string) => {
    return tagName === "w:style";
  },
});

function importRunProperties(rPr: OoxmlNode | undefined): RunProperties {
  if (!rPr) return {};
  const props: RunProperties = {};

  if (isBoolProp(rPr, "w:b")) props.bold = true;
  if (isBoolProp(rPr, "w:i")) props.italic = true;
  if (isBoolProp(rPr, "w:strike")) props.strikethrough = true;

  const u = findChild(rPr, "w:u");
  if (u) {
    const val = attrValue(u, "w:val");
    if (val && val !== "none") props.underline = true;
  }

  const sz = findChild(rPr, "w:sz");
  if (sz) {
    const val = attrValue(sz, "w:val");
    if (val) props.fontSize = halfPointsToPx(Number(val));
  }

  const color = findChild(rPr, "w:color");
  if (color) {
    const val = attrValue(color, "w:val");
    if (val && val !== "auto") props.color = val;
  }

  const rFonts = findChild(rPr, "w:rFonts");
  if (rFonts) {
    const ascii = attrValue(rFonts, "w:ascii") ?? attrValue(rFonts, "w:hAnsi");
    if (ascii) props.fontFamily = ascii;
  }

  const vertAlign = findChild(rPr, "w:vertAlign");
  if (vertAlign) {
    const val = attrValue(vertAlign, "w:val");
    if (val === "superscript" || val === "subscript") props.vertAlign = val;
  }

  return props;
}

function importParagraphProperties(pPr: OoxmlNode | undefined): ParagraphProperties {
  if (!pPr) return {};
  const props: ParagraphProperties = {};

  const jc = findChild(pPr, "w:jc");
  if (jc) {
    const val = attrValue(jc, "w:val");
    if (val === "center" || val === "right" || val === "both" || val === "distribute") {
      props.alignment = val;
    } else if (val === "left" || val === "start") {
      props.alignment = "left";
    }
  }

  const spacing = findChild(pPr, "w:spacing");
  if (spacing) {
    const before = attrValue(spacing, "w:before");
    const after = attrValue(spacing, "w:after");
    const line = attrValue(spacing, "w:line");
    if (before) props.spacingBefore = twipsToPx(Number(before));
    if (after) props.spacingAfter = twipsToPx(Number(after));
    if (line) props.lineSpacing = Number(line) / 240; // 240 = single spacing
  }

  const ind = findChild(pPr, "w:ind");
  if (ind) {
    const left = attrValue(ind, "w:left") ?? attrValue(ind, "w:start");
    const right = attrValue(ind, "w:right") ?? attrValue(ind, "w:end");
    const hanging = attrValue(ind, "w:hanging");
    const firstLine = attrValue(ind, "w:firstLine");
    if (left) props.indentLeft = twipsToPx(Number(left));
    if (right) props.indentRight = twipsToPx(Number(right));
    if (hanging) props.indentHanging = twipsToPx(Number(hanging));
    if (firstLine) props.indentFirstLine = twipsToPx(Number(firstLine));
  }

  const outlineLvl = findChild(pPr, "w:outlineLvl");
  if (outlineLvl) {
    const val = attrValue(outlineLvl, "w:val");
    if (val !== undefined) props.outlineLevel = Number(val);
  }

  return props;
}

/**
 * Parse word/styles.xml from ZIP and return a style map.
 */
export async function importStyles(zip: JSZip): Promise<Map<string, DocxStyleDef>> {
  const styleMap = new Map<string, DocxStyleDef>();

  const stylesFile = zip.file("word/styles.xml");
  if (!stylesFile) return styleMap;

  const xml = await stylesFile.async("string");
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return styleMap;
  }

  const stylesRoot = parsed["w:styles"] as OoxmlNode | undefined;
  if (!stylesRoot) return styleMap;

  const styleNodes = findChildren(stylesRoot, "w:style");

  for (const styleNode of styleNodes) {
    const styleId = attrValue(styleNode, "w:styleId");
    if (!styleId) continue;

    const typeVal = attrValue(styleNode, "w:type") ?? "paragraph";
    const type = (["paragraph", "character", "table", "numbering"].includes(typeVal)
      ? typeVal
      : "paragraph") as DocxStyleDef["type"];

    const nameNode = findChild(styleNode, "w:name");
    const name = attrValue(nameNode, "w:val") ?? styleId;

    const basedOnNode = findChild(styleNode, "w:basedOn");
    const basedOn = attrValue(basedOnNode, "w:val");

    const rPr = findChild(styleNode, "w:rPr");
    const pPr = findChild(styleNode, "w:pPr");

    const def: DocxStyleDef = {
      styleId,
      name,
      type,
      basedOn,
      runProperties: importRunProperties(rPr),
      paragraphProperties: importParagraphProperties(pPr),
    };

    styleMap.set(styleId, def);
  }

  return styleMap;
}

export { importRunProperties, importParagraphProperties };
