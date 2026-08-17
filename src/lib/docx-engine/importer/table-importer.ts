/**
 * Imports w:tbl nodes into DocxTable using the preserveOrder OrderedNode system.
 */

import { DocxTable, DocxTableRow, DocxTableCell } from "../types/document";
import { RelationshipMap } from "../core/rels-resolver";
import {
  OrderedNode,
  orderedTagName,
  orderedChildren,
} from "./document-importer";
import { importParagraphOrdered } from "./paragraph-importer";

let tableCounter = 0;
let rowCounter = 0;
let cellCounter = 0;

export function resetTableCounters(): void {
  tableCounter = 0;
  rowCounter = 0;
  cellCounter = 0;
}

function importTableCellOrdered(
  tcNode: OrderedNode,
  rels: RelationshipMap,
  imageUrls: Map<string, string>
): DocxTableCell {
  const id = `cell-${++cellCounter}`;
  const paragraphs = orderedChildren(tcNode)
    .filter((c) => orderedTagName(c) === "w:p")
    .map((p) => importParagraphOrdered(p, rels, imageUrls));
  return { kind: "tableCell", id, paragraphs };
}

function importTableRowOrdered(
  trNode: OrderedNode,
  rels: RelationshipMap,
  imageUrls: Map<string, string>
): DocxTableRow {
  const id = `row-${++rowCounter}`;
  const cells = orderedChildren(trNode)
    .filter((c) => orderedTagName(c) === "w:tc")
    .map((tc) => importTableCellOrdered(tc, rels, imageUrls));
  return { kind: "tableRow", id, cells };
}

export function importTableOrdered(
  tblNode: OrderedNode,
  rels: RelationshipMap,
  imageUrls: Map<string, string>
): DocxTable {
  const id = `table-${++tableCounter}`;
  const rows = orderedChildren(tblNode)
    .filter((c) => orderedTagName(c) === "w:tr")
    .map((tr) => importTableRowOrdered(tr, rels, imageUrls));
  return { kind: "table", id, rows };
}
