/**
 * Imports w:numbering from word/numbering.xml into a NumberingMap.
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import {
  NumberingMap,
  NumberingAbstractDef,
  NumberingDef,
  NumberingLevelDef,
} from "../types/document";
import { findChild, findChildren, attrValue } from "../core/xml-access";
import { twipsToPx } from "../core/units";
import { OoxmlNode } from "../types/ooxml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: (tagName: string) => {
    return (
      tagName === "w:abstractNum" ||
      tagName === "w:num" ||
      tagName === "w:lvl" ||
      tagName === "w:lvlOverride"
    );
  },
});

function importLevelDef(lvlNode: OoxmlNode): NumberingLevelDef {
  const ilvl = Number(attrValue(lvlNode, "w:ilvl") ?? "0");

  const startNode = findChild(lvlNode, "w:start");
  const start = Number(attrValue(startNode, "w:val") ?? "1");

  const numFmtNode = findChild(lvlNode, "w:numFmt");
  const numFmt = attrValue(numFmtNode, "w:val") ?? "decimal";

  const lvlTextNode = findChild(lvlNode, "w:lvlText");
  const lvlText = attrValue(lvlTextNode, "w:val") ?? "";

  const pPr = findChild(lvlNode, "w:pPr");
  let indent: number | undefined;
  if (pPr) {
    const ind = findChild(pPr, "w:ind");
    if (ind) {
      const left = attrValue(ind, "w:left") ?? attrValue(ind, "w:start");
      if (left) indent = twipsToPx(Number(left));
    }
  }

  return { level: ilvl, numFmt, lvlText, start, indent };
}

/**
 * Parse word/numbering.xml from ZIP and return a NumberingMap.
 */
export async function importNumbering(zip: JSZip): Promise<NumberingMap> {
  const abstractDefs = new Map<number, NumberingAbstractDef>();
  const numDefs = new Map<number, NumberingDef>();

  const numberingFile = zip.file("word/numbering.xml");
  if (!numberingFile) {
    return { abstractDefs, numDefs };
  }

  const xml = await numberingFile.async("string");
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { abstractDefs, numDefs };
  }

  const root = parsed["w:numbering"] as OoxmlNode | undefined;
  if (!root) return { abstractDefs, numDefs };

  // Parse abstractNum definitions
  const abstractNumNodes = findChildren(root, "w:abstractNum");
  for (const absNode of abstractNumNodes) {
    const id = Number(attrValue(absNode, "w:abstractNumId") ?? "-1");
    if (id < 0) continue;

    const lvlNodes = findChildren(absNode, "w:lvl");
    const levels = lvlNodes.map(importLevelDef);

    abstractDefs.set(id, { abstractNumId: id, levels });
  }

  // Parse num (instance) definitions
  const numNodes = findChildren(root, "w:num");
  for (const numNode of numNodes) {
    const numId = Number(attrValue(numNode, "w:numId") ?? "-1");
    if (numId < 0) continue;

    const abstractNumIdNode = findChild(numNode, "w:abstractNumId");
    const abstractNumId = Number(
      attrValue(abstractNumIdNode, "w:val") ?? "-1"
    );

    const lvlOverrideNodes = findChildren(numNode, "w:lvlOverride");
    const levelOverrides: Partial<NumberingLevelDef>[] = lvlOverrideNodes.map(
      (ovNode) => {
        const ilvl = Number(attrValue(ovNode, "w:ilvl") ?? "0");
        const startOverrideNode = findChild(ovNode, "w:startOverride");
        const startOverride = startOverrideNode
          ? Number(attrValue(startOverrideNode, "w:val"))
          : undefined;
        const lvlNode = findChild(ovNode, "w:lvl");
        if (lvlNode) {
          return { ...importLevelDef(lvlNode), level: ilvl };
        }
        return startOverride !== undefined
          ? { level: ilvl, start: startOverride }
          : { level: ilvl };
      }
    );

    numDefs.set(numId, {
      numId,
      abstractNumId,
      levelOverrides: levelOverrides.length > 0 ? levelOverrides : undefined,
    });
  }

  return { abstractDefs, numDefs };
}
