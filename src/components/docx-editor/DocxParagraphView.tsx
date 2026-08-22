"use client";
import React from "react";
import { DocxParagraph } from "@/lib/docx-engine/types/document";
import DocxRunView from "./DocxRunView";
import DocxImageView from "./DocxImageView";
import DocxCommentAnchor from "./DocxCommentAnchor";

interface Props {
  paragraph: DocxParagraph;
  currentAuthor: string;
  activeCommentId?: string;
  onCommentActivate: (id: string) => void;
}

export default function DocxParagraphView({ paragraph, currentAuthor, activeCommentId, onCommentActivate }: Props) {
  const p = paragraph.properties;

  const alignClass =
    p.alignment === "center" ? "text-center" :
    p.alignment === "right" ? "text-right" :
    p.alignment === "both" ? "text-justify" :
    "text-left";

  return (
    <p
      data-para-id={paragraph.id}
      className={`${alignClass} min-h-[1.4em]`}
      style={{
        marginTop: p.spacingBefore,
        marginBottom: p.spacingAfter,
        paddingLeft: p.indentLeft,
        paddingRight: p.indentRight,
        textIndent: p.indentFirstLine ?? (p.indentHanging ? -p.indentHanging : undefined),
        lineHeight: p.lineSpacing ?? undefined,
      }}
    >
      {paragraph.listMarker && (
        <span className="mr-2 select-none">{paragraph.listMarker}</span>
      )}
      {paragraph.runs.map((run) => {
        if (run.kind === "image") {
          return (
            <DocxImageView key={run.id} run={run} />
          );
        }
        if (run.kind === "hyperlink") {
          return (
            <a
              key={run.id}
              href={run.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              {run.runs.map((innerRun) =>
                innerRun.kind === "text" ? (
                  <DocxRunView key={innerRun.id} run={innerRun} currentAuthor={currentAuthor} />
                ) : null
              )}
            </a>
          );
        }
        if (run.kind === "break") {
          return run.breakType === "line" ? <br key={run.id} /> : null;
        }
        // text run
        const node = (
          <DocxRunView key={run.id} run={run} currentAuthor={currentAuthor} />
        );
        // if this run has a comment anchor, wrap it
        if (run.kind === "text" && run.commentId) {
          return (
            <span key={run.id} className="relative inline">
              {node}
              <DocxCommentAnchor
                commentId={run.commentId}
                isActive={activeCommentId === run.commentId}
                onActivate={onCommentActivate}
              />
            </span>
          );
        }
        return node;
      })}
    </p>
  );
}
