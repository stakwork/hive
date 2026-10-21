/**
 * A .docx deliverable as report HTML and plain text, server-side.
 *
 * Reads `word/document.xml` only: paragraphs (headings by their Heading /
 * Title style), line breaks, tabs and tables. Tracked changes are accepted —
 * insertions kept, deletions and moved-from text dropped — which is the text
 * the judge scored. Formatting, numbering and images are not carried.
 *
 * Not built on `src/lib/docx-engine`: its importer turns every image into a
 * blob URL, which on a server render would be registered and never revoked.
 * The HTML produced here only ever reaches the report sanitizer.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type XmlNode = Record<string, unknown>;

/** A body larger than this is not converted (the deliverable shows as absent). */
export const MAX_DOCX_BYTES = 20 * 1024 * 1024;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  processEntities: true,
});

/** Subtrees whose text is not part of the accepted document. */
const SKIP = new Set(["w:del", "w:moveFrom", "w:delText", "w:instrText", "w:pPr", "w:rPr", "w:tblPr", "w:trPr", "w:tcPr"]);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tagOf(node: XmlNode): string | null {
  for (const key of Object.keys(node)) if (key !== ":@") return key;
  return null;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function attrOf(node: XmlNode | undefined, name: string): string | undefined {
  const attrs = node?.[":@"];
  if (!attrs || typeof attrs !== "object") return undefined;
  const value = (attrs as Record<string, unknown>)[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

function childTagged(node: XmlNode, tag: string): XmlNode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

function collectText(nodes: XmlNode[], out: string[]) {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "#text") {
      out.push(String(node["#text"] ?? ""));
      continue;
    }
    if (!tag || SKIP.has(tag)) continue;
    if (tag === "w:tab") out.push("\t");
    else if (tag === "w:br" || tag === "w:cr") out.push("\n");
    else if (tag === "w:noBreakHyphen") out.push("-");
    else if (tag === "w:t") collectText(childrenOf(node), out);
    // Runs, insertions, hyperlinks, fields, smart tags, content controls…
    else if (tag !== "w:tbl" && tag !== "w:p") collectText(childrenOf(node), out);
  }
}

function headingLevel(paragraph: XmlNode): number | null {
  const pPr = childTagged(paragraph, "w:pPr");
  const style = pPr ? attrOf(childTagged(pPr, "w:pStyle"), "w:val") : undefined;
  if (!style) return null;
  if (/^title$/i.test(style)) return 1;
  if (/^subtitle$/i.test(style)) return 2;
  const m = /^heading\s*([1-6])$/i.exec(style);
  return m ? Number(m[1]) : null;
}

interface Converted {
  html: string[];
  text: string[];
}

function paragraphText(paragraph: XmlNode): string {
  const parts: string[] = [];
  collectText(childrenOf(paragraph), parts);
  return parts.join("");
}

function convertBlocks(nodes: XmlNode[], out: Converted) {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "w:p") {
      const text = paragraphText(node);
      if (!text.trim()) continue;
      const level = headingLevel(node);
      const body = escapeHtml(text).replace(/\n/g, "<br>");
      out.html.push(level ? `<h${level}>${body}</h${level}>` : `<p>${body}</p>`);
      out.text.push(text);
    } else if (tag === "w:tbl") {
      convertTable(node, out);
    } else if (tag === "w:sdt") {
      const content = childTagged(node, "w:sdtContent");
      if (content) convertBlocks(childrenOf(content), out);
    } else if (tag === "w:customXml" || tag === "w:ins") {
      convertBlocks(childrenOf(node), out);
    }
  }
}

/** A table's cells as their paragraphs' text (a nested table flattens into its cell). */
function cellText(cell: XmlNode): string {
  const lines: string[] = [];
  const visit = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === "w:p") {
        const text = paragraphText(node);
        if (text.trim()) lines.push(text);
      } else if (tag && !SKIP.has(tag) && tag !== "#text") {
        visit(childrenOf(node));
      }
    }
  };
  visit(childrenOf(cell));
  return lines.join("\n");
}

function convertTable(table: XmlNode, out: Converted) {
  const rows: string[][] = [];
  for (const row of childrenOf(table)) {
    if (tagOf(row) !== "w:tr") continue;
    rows.push(childrenOf(row).filter((c) => tagOf(c) === "w:tc").map(cellText));
  }
  if (rows.length === 0) return;
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`)
    .join("");
  out.html.push(`<table><tbody>${body}</tbody></table>`);
  out.text.push(rows.map((cells) => cells.join(" | ")).join("\n"));
}

/** The document as HTML and text; null when it is not a readable .docx. */
export async function docxToHtml(body: ArrayBuffer | Uint8Array): Promise<{ html: string; text: string } | null> {
  if (body.byteLength > MAX_DOCX_BYTES) return null;
  try {
    const zip = await JSZip.loadAsync(body);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return null;
    const root = parser.parse(xml) as XmlNode[];
    const document = root.find((n) => tagOf(n) === "w:document");
    const docBody = document ? childrenOf(document).find((n) => tagOf(n) === "w:body") : undefined;
    if (!docBody) return null;
    const out: Converted = { html: [], text: [] };
    convertBlocks(childrenOf(docBody), out);
    return { html: out.html.join("\n"), text: out.text.join("\n") };
  } catch {
    return null;
  }
}
