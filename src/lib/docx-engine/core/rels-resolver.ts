/**
 * Relationship resolver for OOXML .docx files.
 *
 * Parses word/_rels/document.xml.rels and (optionally)
 * word/_rels/comments.xml.rels to build a RelationshipMap.
 *
 * Called before any importer in document-importer.ts.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string; // "External" for hyperlinks
}

export type RelationshipMap = Map<string, Relationship>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: () => false,
});

/**
 * Parse a single .rels XML string into a RelationshipMap.
 */
function parseRelsXml(xml: string): RelationshipMap {
  const map: RelationshipMap = new Map();
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return map;
  }

  const relationships =
    (parsed["Relationships"] as Record<string, unknown>) ?? {};
  const relNodes = relationships["Relationship"];

  const nodes: Record<string, unknown>[] = Array.isArray(relNodes)
    ? (relNodes as Record<string, unknown>[])
    : relNodes
      ? [relNodes as Record<string, unknown>]
      : [];

  for (const node of nodes) {
    const id = String(node["@_Id"] ?? "");
    const type = String(node["@_Type"] ?? "");
    const target = String(node["@_Target"] ?? "");
    const targetMode =
      node["@_TargetMode"] !== undefined
        ? String(node["@_TargetMode"])
        : undefined;

    if (id) {
      map.set(id, { id, type, target, targetMode });
    }
  }

  return map;
}

/**
 * Build a RelationshipMap from a DOCX ZIP archive.
 * Reads word/_rels/document.xml.rels and merges
 * word/_rels/comments.xml.rels if present.
 */
export async function buildRelationshipMap(zip: JSZip): Promise<RelationshipMap> {
  const combined: RelationshipMap = new Map();

  const docRelsFile = zip.file("word/_rels/document.xml.rels");
  if (docRelsFile) {
    const xml = await docRelsFile.async("string");
    const map = parseRelsXml(xml);
    for (const [id, rel] of map) {
      combined.set(id, rel);
    }
  }

  const commentRelsFile = zip.file("word/_rels/comments.xml.rels");
  if (commentRelsFile) {
    const xml = await commentRelsFile.async("string");
    const map = parseRelsXml(xml);
    for (const [id, rel] of map) {
      // Avoid overwriting doc rels with comment rels for same id
      if (!combined.has(id)) {
        combined.set(id, rel);
      }
    }
  }

  return combined;
}
