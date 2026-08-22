"use client";
import React from "react";
import { DocxDocument } from "@/lib/docx-engine/types/document";
import { DocxBlock } from "@/lib/docx-engine/types/document";
import DocxParagraphView from "./DocxParagraphView";
import DocxTableView from "./DocxTableView";

interface DocxPageProps {
  doc: DocxDocument;
  currentAuthor: string;
  activeCommentId?: string;
  onCommentActivate: (id: string) => void;
  zoom?: number; // percentage, default 100
}

export default function DocxPage({ doc, currentAuthor, activeCommentId, onCommentActivate, zoom = 100 }: DocxPageProps) {
  const { sectionProperties } = doc;
  const scale = zoom / 100;
  
  // A4: 210mm × 297mm = 794px × 1123px at 96dpi
  const pageWidth = sectionProperties.pageWidth ?? 794;
  const pageHeight = sectionProperties.pageHeight ?? 1123;
  const marginTop = sectionProperties.marginTop ?? 96;
  const marginRight = sectionProperties.marginRight ?? 96;
  const marginBottom = sectionProperties.marginBottom ?? 96;
  const marginLeft = sectionProperties.marginLeft ?? 96;

  return (
    <div
      className="mx-auto bg-white shadow-lg"
      style={{
        width: pageWidth,
        minHeight: pageHeight,
        paddingTop: marginTop,
        paddingRight: marginRight,
        paddingBottom: marginBottom,
        paddingLeft: marginLeft,
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        marginBottom: scale !== 1 ? `${(scale - 1) * pageHeight}px` : undefined,
      }}
    >
      {doc.blocks.map((block) =>
        block.kind === "paragraph" ? (
          <DocxParagraphView
            key={block.id}
            paragraph={block}
            currentAuthor={currentAuthor}
            activeCommentId={activeCommentId}
            onCommentActivate={onCommentActivate}
          />
        ) : (
          <DocxTableView
            key={block.id}
            table={block}
            currentAuthor={currentAuthor}
            activeCommentId={activeCommentId}
            onCommentActivate={onCommentActivate}
          />
        )
      )}
    </div>
  );
}
