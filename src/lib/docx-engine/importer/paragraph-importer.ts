/**
 * Imports w:p nodes into DocxParagraph using the preserveOrder OrderedNode system.
 */

import { DocxParagraph, ParagraphProperties, DocxInlineNode } from "../types/document";
import { TrackChangeMark, TrackChangeType, TrackChangeStatus } from "../types/track-changes";
import { importRunPropertiesOrdered } from "./run-importer";
import { RelationshipMap } from "../core/rels-resolver";
import {
  OrderedNode,
  orderedTagName,
  orderedChildren,
  orderedAttr,
  orderedFindChild,
  orderedTextContent,
} from "./document-importer";
import { twipsToPx } from "../core/units";
import { halfPointsToPx } from "../core/units";
import { importImages } from "./image-importer";

let paraCounter = 0;
export function resetParaCounter(): void {
  paraCounter = 0;
}

// ─── Run import ───────────────────────────────────────────────────────────────

function importRunOrdered(
  rNode: OrderedNode,
  rels: RelationshipMap,
  imageUrls: Map<string, string>,
  trackChange?: TrackChangeMark,
  commentId?: string
): DocxInlineNode[] {
  const rChildren = orderedChildren(rNode);
  const rPrNode = rChildren.find((c) => orderedTagName(c) === "w:rPr");
  const rPr = rPrNode ? importRunPropertiesOrdered(rPrNode) : {};

  const nodes: DocxInlineNode[] = [];

  for (const child of rChildren) {
    const tag = orderedTagName(child);

    if (tag === "w:t" || tag === "w:delText") {
      // Children of w:t are either a "#text" node or empty
      const tChildren = orderedChildren(child);
      const text = orderedTextContent(tChildren);
      nodes.push({
        kind: "text",
        id: `run-${++runCounter}`,
        text,
        properties: rPr,
        trackChange,
        commentId,
      });
    } else if (tag === "w:br") {
      const brType = orderedAttr(child, "w:type");
      let breakType: "line" | "page" | "column" = "line";
      if (brType === "page") breakType = "page";
      else if (brType === "column") breakType = "column";
      nodes.push({
        kind: "break",
        id: `run-${++runCounter}`,
        breakType,
        properties: rPr,
        trackChange,
      });
    } else if (tag === "w:drawing") {
      // Image handling — use relationship map
      const drawingChildren = orderedChildren(child);
      const inline = drawingChildren.find((c) =>
        orderedTagName(c) === "wp:inline" || orderedTagName(c) === "wp:anchor"
      );
      if (inline) {
        const inlineChildren = orderedChildren(inline);
        const extentNode = inlineChildren.find((c) => orderedTagName(c) === "wp:extent");
        const cx = extentNode ? Number(orderedAttr(extentNode, "cx") ?? "0") : 0;
        const cy = extentNode ? Number(orderedAttr(extentNode, "cy") ?? "0") : 0;

        // Traverse to a:blip r:embed
        let rEmbed: string | undefined;
        const graphicNode = inlineChildren.find((c) => orderedTagName(c) === "a:graphic");
        if (graphicNode) {
          const graphicChildren = orderedChildren(graphicNode);
          const graphicDataNode = graphicChildren.find((c) => orderedTagName(c) === "a:graphicData");
          if (graphicDataNode) {
            const picNode = orderedChildren(graphicDataNode).find((c) => orderedTagName(c) === "pic:pic");
            if (picNode) {
              const blipFillNode = orderedChildren(picNode).find((c) => orderedTagName(c) === "pic:blipFill");
              if (blipFillNode) {
                const blipNode = orderedChildren(blipFillNode).find((c) => orderedTagName(c) === "a:blip");
                if (blipNode) rEmbed = orderedAttr(blipNode, "r:embed");
              }
            }
          }
        }

        if (rEmbed) {
          const objectUrl = imageUrls.get(rEmbed);
          nodes.push({
            kind: "image",
            id: `run-${++runCounter}`,
            relationshipId: rEmbed,
            objectUrl,
            widthPx: cx ? cx / 914400 * 96 : undefined,
            heightPx: cy ? cy / 914400 * 96 : undefined,
            properties: rPr,
            trackChange,
          });
        }
      }
    }
  }

  // Emit empty text run if nothing found (e.g. bare tracked-change run)
  if (nodes.length === 0 && trackChange) {
    nodes.push({
      kind: "text",
      id: `run-${++runCounter}`,
      text: "",
      properties: rPr,
      trackChange,
      commentId,
    });
  }

  return nodes;
}

let runCounter = 0;
export function resetRunCounter(): void {
  runCounter = 0;
}

// ─── Track change processing ──────────────────────────────────────────────────

const PAIR_WINDOW_MS = 60_000;

interface PendingChange {
  kind: "ins" | "del";
  author: string;
  date: string;
  id: string;
  nodes: DocxInlineNode[];
}

function parseDate(s: string): number {
  try { return new Date(s).getTime(); } catch { return 0; }
}

function applyReplacementType(nodes: DocxInlineNode[]): DocxInlineNode[] {
  return nodes.map((n) => {
    if (!n.trackChange) return n;
    return { ...n, trackChange: { ...n.trackChange, type: TrackChangeType.REPLACEMENT } };
  });
}

/**
 * Process ordered paragraph children (w:r, w:ins, w:del, w:hyperlink) into
 * flat inline nodes. Pairs adjacent del+ins (or ins+del) by same author
 * within 60 s as REPLACEMENT.
 */
function processParaChildren(
  paraChildren: OrderedNode[],
  rels: RelationshipMap,
  imageUrls: Map<string, string>
): DocxInlineNode[] {
  // First pass: build a list of "items" (plain runs or change groups)
  const items: Array<
    | { kind: "plain"; nodes: DocxInlineNode[] }
    | PendingChange
  > = [];

  for (const child of paraChildren) {
    const tag = orderedTagName(child);
    if (tag === "w:pPr") continue; // handled separately

    if (tag === "w:r") {
      const runs = importRunOrdered(child, rels, imageUrls);
      items.push({ kind: "plain", nodes: runs });
    } else if (tag === "w:ins") {
      const author = orderedAttr(child, "w:author") ?? "Unknown";
      const date = orderedAttr(child, "w:date") ?? new Date().toISOString();
      const id = orderedAttr(child, "w:id") ?? String(Math.random());
      const mark: TrackChangeMark = {
        id, type: TrackChangeType.INSERTION, status: TrackChangeStatus.PENDING, author, date,
      };
      const nodes: DocxInlineNode[] = [];
      for (const rNode of orderedChildren(child)) {
        if (orderedTagName(rNode) === "w:r") {
          nodes.push(...importRunOrdered(rNode, rels, imageUrls, mark));
        }
      }
      items.push({ kind: "ins", author, date, id, nodes });
    } else if (tag === "w:del") {
      const author = orderedAttr(child, "w:author") ?? "Unknown";
      const date = orderedAttr(child, "w:date") ?? new Date().toISOString();
      const id = orderedAttr(child, "w:id") ?? String(Math.random());
      const mark: TrackChangeMark = {
        id, type: TrackChangeType.DELETION, status: TrackChangeStatus.PENDING, author, date,
      };
      const nodes: DocxInlineNode[] = [];
      for (const rNode of orderedChildren(child)) {
        if (orderedTagName(rNode) === "w:r") {
          nodes.push(...importRunOrdered(rNode, rels, imageUrls, mark));
        }
      }
      items.push({ kind: "del", author, date, id, nodes });
    } else if (tag === "w:hyperlink") {
      const rIdAttr = orderedAttr(child, "r:id");
      let url = "";
      if (rIdAttr) {
        const rel = rels.get(rIdAttr);
        if (rel) url = rel.target;
      }
      const innerRuns: DocxInlineNode[] = [];
      for (const rNode of orderedChildren(child)) {
        if (orderedTagName(rNode) === "w:r") {
          innerRuns.push(...importRunOrdered(rNode, rels, imageUrls));
        }
      }
      items.push({
        kind: "plain",
        nodes: [{
          kind: "hyperlink",
          id: `run-${++runCounter}`,
          url,
          runs: innerRuns,
          properties: {},
        }],
      });
    }
    // Skip bookmarkStart, bookmarkEnd, proofErr, etc.
  }

  // Second pass: pair adjacent del+ins or ins+del by same author within 60s
  const result: DocxInlineNode[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    const nxt = i + 1 < items.length ? items[i + 1] : undefined;

    const isPairCandidate = (
      a: typeof cur,
      b: typeof nxt
    ): b is PendingChange =>
      b !== undefined &&
      (a.kind === "del" || a.kind === "ins") &&
      (b.kind === "ins" || b.kind === "del") &&
      a.kind !== b.kind &&
      (a as PendingChange).author === b.author &&
      Math.abs(parseDate((a as PendingChange).date) - parseDate(b.date)) <= PAIR_WINDOW_MS;

    if (isPairCandidate(cur, nxt)) {
      result.push(...applyReplacementType((cur as PendingChange).nodes));
      result.push(...applyReplacementType(nxt!.nodes));
      i += 2;
    } else {
      result.push(...(cur.kind === "plain" ? cur.nodes : (cur as PendingChange).nodes));
      i++;
    }
  }

  return result;
}

// ─── Paragraph properties ─────────────────────────────────────────────────────

function importParagraphPropertiesOrdered(
  pPrNode: OrderedNode
): ParagraphProperties {
  const children = orderedChildren(pPrNode);
  const props: ParagraphProperties = {};

  const pStyleNode = children.find((c) => orderedTagName(c) === "w:pStyle");
  if (pStyleNode) props.styleId = orderedAttr(pStyleNode, "w:val");

  const jcNode = children.find((c) => orderedTagName(c) === "w:jc");
  if (jcNode) {
    const val = orderedAttr(jcNode, "w:val");
    if (val === "center" || val === "right" || val === "both" || val === "distribute") {
      props.alignment = val;
    } else if (val === "left" || val === "start") {
      props.alignment = "left";
    }
  }

  const spacingNode = children.find((c) => orderedTagName(c) === "w:spacing");
  if (spacingNode) {
    const before = orderedAttr(spacingNode, "w:before");
    const after = orderedAttr(spacingNode, "w:after");
    const line = orderedAttr(spacingNode, "w:line");
    if (before) props.spacingBefore = twipsToPx(Number(before));
    if (after) props.spacingAfter = twipsToPx(Number(after));
    if (line) props.lineSpacing = Number(line) / 240;
  }

  const indNode = children.find((c) => orderedTagName(c) === "w:ind");
  if (indNode) {
    const left = orderedAttr(indNode, "w:left") ?? orderedAttr(indNode, "w:start");
    const right = orderedAttr(indNode, "w:right") ?? orderedAttr(indNode, "w:end");
    const hanging = orderedAttr(indNode, "w:hanging");
    const firstLine = orderedAttr(indNode, "w:firstLine");
    if (left) props.indentLeft = twipsToPx(Number(left));
    if (right) props.indentRight = twipsToPx(Number(right));
    if (hanging) props.indentHanging = twipsToPx(Number(hanging));
    if (firstLine) props.indentFirstLine = twipsToPx(Number(firstLine));
  }

  const outlineLvlNode = children.find((c) => orderedTagName(c) === "w:outlineLvl");
  if (outlineLvlNode) {
    const val = orderedAttr(outlineLvlNode, "w:val");
    if (val !== undefined) props.outlineLevel = Number(val);
  }

  const numPrNode = children.find((c) => orderedTagName(c) === "w:numPr");
  if (numPrNode) {
    const numPrChildren = orderedChildren(numPrNode);
    const ilvlNode = numPrChildren.find((c) => orderedTagName(c) === "w:ilvl");
    const numIdNode = numPrChildren.find((c) => orderedTagName(c) === "w:numId");
    if (ilvlNode) props.numLevel = Number(orderedAttr(ilvlNode, "w:val") ?? "0");
    if (numIdNode) props.numId = Number(orderedAttr(numIdNode, "w:val") ?? "0");
  }

  return props;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Import a w:p OrderedNode into a DocxParagraph.
 */
export function importParagraphOrdered(
  pNode: OrderedNode,
  rels: RelationshipMap,
  imageUrls: Map<string, string>
): DocxParagraph {
  const id = `para-${++paraCounter}`;
  const paraChildren = orderedChildren(pNode);

  const pPrNode = paraChildren.find((c) => orderedTagName(c) === "w:pPr");
  const props: ParagraphProperties = pPrNode
    ? importParagraphPropertiesOrdered(pPrNode)
    : {};

  const runs = processParaChildren(paraChildren, rels, imageUrls);

  return { kind: "paragraph", id, properties: props, runs };
}

// Keep old export names for backward compat with tests that import from styles-importer
export { importParagraphPropertiesOrdered as importParagraphPropertiesOrd };
