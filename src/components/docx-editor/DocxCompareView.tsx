"use client";
import React from "react";

import { useRef } from "react";
import { diffArrays } from "diff";
import { DocxDocument, DocxParagraph, DocxTextRun } from "@/lib/docx-engine/types/document";

interface DocxCompareViewProps {
  docA: DocxDocument;
  docB: DocxDocument;
}

type DiffKind = "equal" | "added" | "removed" | "changed";

interface DiffRow {
  kind: DiffKind;
  left?: string;
  right?: string;
}

function extractParaTexts(doc: DocxDocument): { id: string; text: string }[] {
  const result: { id: string; text: string }[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      const text = block.runs
        .filter((r) => r.kind === "text")
        .map((r) => (r as DocxTextRun).text)
        .join("");
      result.push({ id: block.id, text });
    }
  }
  return result;
}

function buildDiffRows(docA: DocxDocument, docB: DocxDocument): DiffRow[] {
  const parasA = extractParaTexts(docA);
  const parasB = extractParaTexts(docB);

  const textsA = parasA.map((p) => p.text);
  const textsB = parasB.map((p) => p.text);

  const changes = diffArrays(textsA, textsB);
  const rows: DiffRow[] = [];

  for (const change of changes) {
    if (change.removed) {
      change.value.forEach((t) => rows.push({ kind: "removed", left: t, right: undefined }));
    } else if (change.added) {
      change.value.forEach((t) => rows.push({ kind: "added", left: undefined, right: t }));
    } else {
      change.value.forEach((t) => rows.push({ kind: "equal", left: t, right: t }));
    }
  }
  return rows;
}

const borderColor: Record<DiffKind, string> = {
  equal: "border-transparent",
  added: "border-l-4 border-green-500",
  removed: "border-l-4 border-red-500",
  changed: "border-l-4 border-amber-500",
};

const bgColor: Record<DiffKind, string> = {
  equal: "",
  added: "bg-green-50 dark:bg-green-950/20",
  removed: "bg-red-50 dark:bg-red-950/20",
  changed: "bg-amber-50 dark:bg-amber-950/20",
};

export default function DocxCompareView({ docA, docB }: DocxCompareViewProps) {
  const rows = buildDiffRows(docA, docB);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const syncScroll = (source: "left" | "right") => (e: React.UIEvent<HTMLDivElement>) => {
    const target = source === "left" ? rightRef.current : leftRef.current;
    if (target) target.scrollTop = (e.target as HTMLDivElement).scrollTop;
  };

  const addedCount = rows.filter((r) => r.kind === "added").length;
  const removedCount = rows.filter((r) => r.kind === "removed").length;

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b text-xs flex-none bg-muted/40">
        <span className="font-medium">Compare</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-green-500 rounded-sm" />
          {addedCount} added
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-red-500 rounded-sm" />
          {removedCount} removed
        </span>
      </div>

      {/* Two-pane diff */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane — docA */}
        <div
          ref={leftRef}
          className="flex-1 overflow-y-auto border-r"
          onScroll={syncScroll("left")}
        >
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted sticky top-0 border-b">
            {docA.filename}
          </div>
          {rows.map((row, i) => {
            const kind = row.kind === "added" ? "equal" : row.kind;
            const text = row.left ?? "";
            return (
              <div
                key={i}
                className={`px-3 py-1 text-sm min-h-[1.75rem] ${bgColor[kind]} ${borderColor[kind]} ${
                  row.kind === "removed" ? "line-through text-red-700 dark:text-red-400" : ""
                }`}
              >
                {text || <span className="text-transparent select-none">·</span>}
              </div>
            );
          })}
        </div>

        {/* Right pane — docB */}
        <div
          ref={rightRef}
          className="flex-1 overflow-y-auto"
          onScroll={syncScroll("right")}
        >
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted sticky top-0 border-b">
            {docB.filename}
          </div>
          {rows.map((row, i) => {
            const kind = row.kind === "removed" ? "equal" : row.kind;
            const text = row.right ?? "";
            return (
              <div
                key={i}
                className={`px-3 py-1 text-sm min-h-[1.75rem] ${bgColor[kind]} ${borderColor[kind]}`}
              >
                {text || <span className="text-transparent select-none">·</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
