/**
 * HTML → sanitized closed-node-shape projection.
 *
 * Runs SERVER-SIDE ONLY, once, at webhook ingest. Components never sanitize.
 *
 * Pipeline: parse (document mode) → discard doctype/html/head wrappers →
 * hast-util-sanitize with the pinned schema → project to `SanitizedNode`.
 *
 * Why document mode: the upstream converters emit whole documents (a full
 * `<!doctype html><html><head>…</head><body>…</body></html>`), not fragments.
 * Parsing those in fragment mode produces node types the pinned schema was
 * never written for, so we parse as a document and explicitly extract the
 * `body` children.
 */

import { fromHtml } from "hast-util-from-html";
import { sanitize } from "hast-util-sanitize";
import type { Nodes, Element, RootContent } from "hast";
import { RUN_REPORT_SANITIZE_SCHEMA, PROJECTED_ATTRIBUTES } from "./sanitize-schema";
import type { SanitizedNode } from "./types";

export interface SanitizeResult {
  nodes: SanitizedNode[];
  /** Count of elements dropped by the sanitizer — logged, never shown raw. */
  droppedCount: number;
}

/**
 * Sanitize one source document's HTML into the closed node shape.
 *
 * Returns an empty node list (not a throw) for unparseable input, so one bad
 * document can never fail the whole bundle.
 */
export function sanitizeDocumentHtml(html: string): SanitizeResult {
  if (typeof html !== "string" || html.length === 0) {
    return { nodes: [], droppedCount: 0 };
  }

  let tree: Nodes;
  try {
    tree = fromHtml(html, { fragment: false });
  } catch {
    return { nodes: [], droppedCount: 0 };
  }

  const beforeCount = countElements(tree);

  // Extract <body> children before sanitizing: the pinned schema does not list
  // html/head/body, so handing it the wrapper would drop everything inside.
  const bodyChildren = extractBodyChildren(tree);

  const sanitizedChildren: RootContent[] = [];
  for (const child of bodyChildren) {
    const clean = sanitize(child, RUN_REPORT_SANITIZE_SCHEMA) as RootContent;
    if (clean) sanitizedChildren.push(clean);
  }

  const nodes = sanitizedChildren
    .map(projectNode)
    .filter((n): n is SanitizedNode => n !== null);

  const afterCount = sanitizedChildren.reduce((sum, c) => sum + countElements(c), 0);

  return { nodes, droppedCount: Math.max(0, beforeCount - afterCount) };
}

/**
 * Pull the children of `<body>` out of a parsed document, discarding the
 * doctype / html / head wrapper nodes explicitly.
 */
function extractBodyChildren(tree: Nodes): RootContent[] {
  if (tree.type === "element" && tree.tagName === "body") {
    return tree.children;
  }

  if (tree.type === "root") {
    for (const child of tree.children) {
      // Skip doctype and stray whitespace text at document level.
      if (child.type === "doctype") continue;
      if (child.type === "element" && child.tagName === "html") {
        for (const htmlChild of child.children) {
          if (htmlChild.type === "element" && htmlChild.tagName === "body") {
            return htmlChild.children;
          }
        }
        // <html> with no <body> — fall back to its non-head children.
        return child.children.filter(
          (c) => !(c.type === "element" && c.tagName === "head"),
        );
      }
    }
    // No <html> wrapper — treat root children as the body, minus any doctype.
    return tree.children.filter((c) => c.type !== "doctype");
  }

  return [];
}

/**
 * Project a sanitized hast node into the closed wire shape.
 *
 * Anything that is not a text node or an element is dropped — comments,
 * doctypes and raw nodes never reach the client. Attribute values are coerced
 * to strings and filtered through the per-tag projection allowlist, so an
 * attribute the sanitize schema permitted but the renderer does not understand
 * cannot ride along.
 */
function projectNode(node: RootContent): SanitizedNode | null {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type !== "element") return null;

  const element = node as Element;
  const tag = element.tagName;

  // Keys are hast property names, values the HTML attribute names we emit.
  const allowedAttrs = PROJECTED_ATTRIBUTES[tag] ?? {};
  const attrs: Record<string, string> = {};
  for (const [hastProp, outputName] of Object.entries(allowedAttrs)) {
    const value = element.properties?.[hastProp];
    if (value === undefined || value === null || value === false) continue;
    attrs[outputName] = Array.isArray(value) ? value.join(" ") : String(value);
  }

  const children = (element.children ?? [])
    .map(projectNode)
    .filter((n): n is SanitizedNode => n !== null);

  const projected: SanitizedNode = { t: tag };
  if (Object.keys(attrs).length > 0) projected.a = attrs;
  if (children.length > 0) projected.c = children;
  return projected;
}

function countElements(node: Nodes | RootContent): number {
  let count = node.type === "element" ? 1 : 0;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) count += countElements(child);
  }
  return count;
}
