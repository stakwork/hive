/**
 * Imports comments from word/comments.xml into DocxComment[].
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { DocxComment } from "../types/document";
import { findChildren, attrValue, textContent } from "../core/xml-access";
import { OoxmlNode } from "../types/ooxml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: (tagName: string) => tagName === "w:comment",
});

/**
 * Extract a text string from a w:t value.
 * fast-xml-parser with isArray produces either a plain string or an object
 * with a "#text" key, depending on whether the element has attributes.
 */
function extractWtText(tItem: unknown): string {
  if (typeof tItem === "string") return tItem;
  if (typeof tItem === "number") return String(tItem);
  if (tItem && typeof tItem === "object") {
    const raw = (tItem as Record<string, unknown>)["#text"];
    return raw !== undefined ? String(raw) : "";
  }
  return "";
}

/**
 * Extract plain text from all w:t nodes within a comment body.
 */
function extractCommentText(commentNode: OoxmlNode): string {
  const parts: string[] = [];
  const paragraphs = findChildren(commentNode, "w:p");
  for (const p of paragraphs) {
    const runs = findChildren(p, "w:r");
    for (const r of runs) {
      // w:t may be an array of strings or objects (fast-xml-parser isArray)
      const rawT = r["w:t"];
      const tItems: unknown[] = Array.isArray(rawT)
        ? rawT
        : rawT !== undefined && rawT !== null
          ? [rawT]
          : [];
      for (const t of tItems) {
        parts.push(extractWtText(t));
      }
    }
  }
  return parts.join("").trim();
}

/**
 * Parse word/comments.xml from ZIP and return DocxComment[].
 */
export async function importComments(zip: JSZip): Promise<DocxComment[]> {
  const comments: DocxComment[] = [];

  const commentsFile = zip.file("word/comments.xml");
  if (!commentsFile) return comments;

  const xml = await commentsFile.async("string");
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return comments;
  }

  const root = parsed["w:comments"] as OoxmlNode | undefined;
  if (!root) return comments;

  const commentNodes = findChildren(root, "w:comment");

  for (const commentNode of commentNodes) {
    const id = attrValue(commentNode, "w:id");
    if (!id) continue;

    const author = attrValue(commentNode, "w:author") ?? "Unknown";
    const date = attrValue(commentNode, "w:date") ?? new Date().toISOString();
    const body = extractCommentText(commentNode);

    comments.push({
      id,
      author,
      date,
      body,
    });
  }

  return comments;
}
