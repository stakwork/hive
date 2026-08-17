/**
 * DocxDocument and all block/inline/property types.
 */

import { TrackChangeMark } from "./track-changes";

// ─── Section / Page Properties ──────────────────────────────────────────────

export interface SectionProperties {
  pageWidth?: number; // px
  pageHeight?: number; // px
  marginTop?: number; // px
  marginRight?: number; // px
  marginBottom?: number; // px
  marginLeft?: number; // px
}

// ─── Run (inline) properties ─────────────────────────────────────────────────

export interface RunProperties {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number; // px
  fontFamily?: string;
  color?: string; // hex without #
  highlight?: string;
  vertAlign?: "superscript" | "subscript" | "baseline";
  styleId?: string;
}

// ─── Paragraph properties ────────────────────────────────────────────────────

export type ParagraphAlignment = "left" | "center" | "right" | "both" | "distribute";

export interface ParagraphProperties {
  alignment?: ParagraphAlignment;
  spacingBefore?: number; // px
  spacingAfter?: number; // px
  lineSpacing?: number; // multiplier or pt
  indentLeft?: number; // px
  indentRight?: number; // px
  indentHanging?: number; // px
  indentFirstLine?: number; // px
  styleId?: string;
  outlineLevel?: number;
  numId?: number;
  numLevel?: number;
}

// ─── Inline nodes ────────────────────────────────────────────────────────────

export interface DocxTextRun {
  kind: "text";
  id: string;
  text: string;
  properties: RunProperties;
  trackChange?: TrackChangeMark;
  commentId?: string; // anchor for a comment
}

export interface DocxImageRun {
  kind: "image";
  id: string;
  relationshipId: string;
  objectUrl?: string; // blob URL after import
  altText?: string;
  widthPx?: number;
  heightPx?: number;
  properties: RunProperties;
  trackChange?: TrackChangeMark;
}

export interface DocxHyperlinkRun {
  kind: "hyperlink";
  id: string;
  url: string;
  runs: DocxInlineNode[];
  properties: RunProperties;
  trackChange?: TrackChangeMark;
}

export interface DocxBreakRun {
  kind: "break";
  id: string;
  breakType: "line" | "page" | "column";
  properties: RunProperties;
  trackChange?: TrackChangeMark;
}

export type DocxInlineNode =
  | DocxTextRun
  | DocxImageRun
  | DocxHyperlinkRun
  | DocxBreakRun;

// ─── Block nodes ─────────────────────────────────────────────────────────────

export interface DocxParagraph {
  kind: "paragraph";
  id: string;
  properties: ParagraphProperties;
  runs: DocxInlineNode[];
  listMarker?: string; // resolved text e.g. "1.", "(a)"
}

export interface DocxTableCell {
  kind: "tableCell";
  id: string;
  paragraphs: DocxParagraph[];
  colSpan?: number;
  rowSpan?: number;
}

export interface DocxTableRow {
  kind: "tableRow";
  id: string;
  cells: DocxTableCell[];
}

export interface DocxTable {
  kind: "table";
  id: string;
  rows: DocxTableRow[];
}

export type DocxBlock = DocxParagraph | DocxTable;

// ─── Comments ────────────────────────────────────────────────────────────────

export interface DocxComment {
  id: string;
  author: string;
  date: string; // ISO 8601
  paragraphId?: string; // paragraph the comment is anchored to
  anchorText?: string; // text snippet the comment references
  body: string; // plain text of comment content
}

// ─── Style definitions ───────────────────────────────────────────────────────

export interface DocxStyleDef {
  styleId: string;
  name: string;
  type: "paragraph" | "character" | "table" | "numbering";
  basedOn?: string;
  runProperties?: RunProperties;
  paragraphProperties?: ParagraphProperties;
}

// ─── Numbering definitions ───────────────────────────────────────────────────

export interface NumberingLevelDef {
  level: number;
  numFmt: string; // decimal, bullet, lowerLetter, etc.
  lvlText: string; // "%1.", "•", etc.
  start: number;
  indent?: number;
}

export interface NumberingAbstractDef {
  abstractNumId: number;
  levels: NumberingLevelDef[];
}

export interface NumberingDef {
  numId: number;
  abstractNumId: number;
  levelOverrides?: Partial<NumberingLevelDef>[];
}

export interface NumberingMap {
  abstractDefs: Map<number, NumberingAbstractDef>;
  numDefs: Map<number, NumberingDef>;
}

// ─── Root document ───────────────────────────────────────────────────────────

export interface DocxDocument {
  /** Unique ID for this document instance */
  id: string;
  /** Original filename */
  filename: string;
  /** All top-level block content */
  blocks: DocxBlock[];
  /** All comments keyed by comment id */
  comments: DocxComment[];
  /** Style definitions */
  styles: Map<string, DocxStyleDef>;
  /** Numbering definitions */
  numbering: NumberingMap;
  /** Section/page layout properties */
  sectionProperties: SectionProperties;
  /** Image blob URLs keyed by relationship id */
  imageUrls: Map<string, string>;
}
