/**
 * Orchestrator importer: builds a complete DocxDocument from a DOCX ZIP.
 *
 * Uses preserveOrder:true so that inline w:r, w:ins, w:del nodes within a
 * paragraph are processed in document order.
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { DocxDocument, DocxBlock, SectionProperties } from "../types/document";
import { buildRelationshipMap } from "../core/rels-resolver";
import { twipsToPx } from "../core/units";
import { importStyles } from "./styles-importer";
import { importNumbering } from "./numbering-importer";
import { importImages } from "./image-importer";
import { importComments } from "./comment-importer";
import { importParagraphOrdered } from "./paragraph-importer";
import { importTableOrdered } from "./table-importer";

// ─── Parser ───────────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  preserveOrder: true,
});

// ─── OrderedNode type ─────────────────────────────────────────────────────────

/**
 * A child node in fast-xml-parser preserveOrder output.
 * Each object has exactly one key (the tag name) whose value is an array of
 * children, plus an optional ":@" key holding attributes.
 *
 * Using `unknown` for the index type avoids the TypeScript conflict with the
 * optional ":@" property.
 */
export type OrderedNode = {
  ":@"?: Record<string, string>;
} & {
  [tagName: string]: unknown;
};

/** Get the tag name of an OrderedNode (first non-":@" key) */
export function orderedTagName(node: OrderedNode): string {
  return Object.keys(node).find((k) => k !== ":@") ?? "";
}

/** Get the children array of an OrderedNode */
export function orderedChildren(node: OrderedNode): OrderedNode[] {
  const tag = orderedTagName(node);
  if (!tag) return [];
  return (node[tag] as OrderedNode[]) ?? [];
}

/** Get attributes of an OrderedNode */
export function orderedAttrs(node: OrderedNode): Record<string, string> {
  return (node[":@"] as Record<string, string>) ?? {};
}

/** Read a specific attribute value from an OrderedNode */
export function orderedAttr(
  node: OrderedNode,
  name: string
): string | undefined {
  const attrs = orderedAttrs(node);
  const key = name.startsWith("@_") ? name : `@_${name}`;
  const val = attrs[key];
  return val !== undefined ? String(val) : undefined;
}

/** Find the first child with the given tag name */
export function orderedFindChild(
  children: OrderedNode[],
  tagName: string
): OrderedNode | undefined {
  return children.find((c) => orderedTagName(c) === tagName);
}

/** Find all children with the given tag name */
export function orderedFindChildren(
  children: OrderedNode[],
  tagName: string
): OrderedNode[] {
  return children.filter((c) => orderedTagName(c) === tagName);
}

/**
 * Get text content from children of a w:t or w:delText node.
 * In preserveOrder mode, text content is a child object with key "#text".
 */
export function orderedTextContent(children: OrderedNode[]): string {
  const parts: string[] = [];
  for (const child of children) {
    const text = (child as Record<string, unknown>)["#text"];
    if (text !== undefined) parts.push(String(text));
  }
  return parts.join("");
}

// ─── Section properties ───────────────────────────────────────────────────────

function importSectionPropertiesOrdered(
  sectPrNode: OrderedNode | undefined
): SectionProperties {
  if (!sectPrNode) {
    return {
      pageWidth: 794,
      pageHeight: 1123,
      marginTop: 96,
      marginRight: 96,
      marginBottom: 96,
      marginLeft: 96,
    };
  }

  const children = orderedChildren(sectPrNode);
  const pgSzNode = orderedFindChild(children, "w:pgSz");
  const pgMarNode = orderedFindChild(children, "w:pgMar");

  return {
    pageWidth: pgSzNode
      ? twipsToPx(Number(orderedAttr(pgSzNode, "w:w") ?? "12240"))
      : 794,
    pageHeight: pgSzNode
      ? twipsToPx(Number(orderedAttr(pgSzNode, "w:h") ?? "15840"))
      : 1123,
    marginTop: pgMarNode
      ? twipsToPx(Number(orderedAttr(pgMarNode, "w:top") ?? "1440"))
      : 96,
    marginRight: pgMarNode
      ? twipsToPx(Number(orderedAttr(pgMarNode, "w:right") ?? "1440"))
      : 96,
    marginBottom: pgMarNode
      ? twipsToPx(Number(orderedAttr(pgMarNode, "w:bottom") ?? "1440"))
      : 96,
    marginLeft: pgMarNode
      ? twipsToPx(Number(orderedAttr(pgMarNode, "w:left") ?? "1440"))
      : 96,
  };
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function importBody(
  bodyChildren: OrderedNode[],
  rels: Awaited<ReturnType<typeof buildRelationshipMap>>,
  imageUrls: Map<string, string>
): { blocks: DocxBlock[]; sectionProperties: SectionProperties } {
  const blocks: DocxBlock[] = [];
  let sectionProperties: SectionProperties =
    importSectionPropertiesOrdered(undefined);

  for (const child of bodyChildren) {
    const tag = orderedTagName(child);
    if (tag === "w:p") {
      blocks.push(importParagraphOrdered(child, rels, imageUrls));
    } else if (tag === "w:tbl") {
      blocks.push(importTableOrdered(child, rels, imageUrls));
    } else if (tag === "w:sectPr") {
      sectionProperties = importSectionPropertiesOrdered(child);
    }
  }

  return { blocks, sectionProperties };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function makeDocId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function importDocument(
  zip: JSZip,
  filename: string
): Promise<DocxDocument> {
  const rels = await buildRelationshipMap(zip);
  const [styles, numbering, imageUrls, comments] = await Promise.all([
    importStyles(zip),
    importNumbering(zip),
    importImages(zip, rels),
    importComments(zip),
  ]);

  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return {
      id: makeDocId(),
      filename,
      blocks: [],
      comments,
      styles,
      numbering,
      sectionProperties: importSectionPropertiesOrdered(undefined),
      imageUrls,
    };
  }

  const xml = await docFile.async("string");
  let parsed: OrderedNode[];
  try {
    parsed = parser.parse(xml) as OrderedNode[];
  } catch {
    return {
      id: makeDocId(),
      filename,
      blocks: [],
      comments,
      styles,
      numbering,
      sectionProperties: importSectionPropertiesOrdered(undefined),
      imageUrls,
    };
  }

  const documentNode = parsed.find((n) => orderedTagName(n) === "w:document");
  const documentChildren = documentNode ? orderedChildren(documentNode) : [];
  const bodyNode = orderedFindChild(documentChildren, "w:body");
  const bodyChildren = bodyNode ? orderedChildren(bodyNode) : [];

  const { blocks, sectionProperties } = importBody(
    bodyChildren,
    rels,
    imageUrls
  );

  return {
    id: makeDocId(),
    filename,
    blocks,
    comments,
    styles,
    numbering,
    sectionProperties,
    imageUrls,
  };
}
