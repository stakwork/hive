"use client";
import React from "react";
import { DocxTable } from "@/lib/docx-engine/types/document";
import DocxParagraphView from "./DocxParagraphView";

interface Props {
  table: DocxTable;
  currentAuthor: string;
  activeCommentId?: string;
  onCommentActivate: (id: string) => void;
}

export default function DocxTableView({ table, currentAuthor, activeCommentId, onCommentActivate }: Props) {
  return (
    <table className="w-full border-collapse my-2 text-sm">
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.id}>
            {row.cells.map((cell) => (
              <td
                key={cell.id}
                colSpan={cell.colSpan}
                rowSpan={cell.rowSpan}
                className="border border-gray-300 px-2 py-1 align-top"
              >
                {cell.paragraphs.map((para) => (
                  <DocxParagraphView
                    key={para.id}
                    paragraph={para}
                    currentAuthor={currentAuthor}
                    activeCommentId={activeCommentId}
                    onCommentActivate={onCommentActivate}
                  />
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
