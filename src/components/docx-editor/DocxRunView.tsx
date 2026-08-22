"use client";
import React from "react";
import { DocxTextRun } from "@/lib/docx-engine/types/document";
import { TrackChangeType, TrackChangeStatus } from "@/lib/docx-engine/types/track-changes";

interface Props {
  run: DocxTextRun;
  currentAuthor: string;
}

export default function DocxRunView({ run, currentAuthor }: Props) {
  const { properties: p, trackChange } = run;

  // Build className for run formatting
  const classes: string[] = [];
  if (p.bold) classes.push("font-bold");
  if (p.italic) classes.push("italic");
  if (p.underline) classes.push("underline");
  if (p.strikethrough) classes.push("line-through");
  if (p.vertAlign === "superscript") classes.push("align-super text-xs");
  if (p.vertAlign === "subscript") classes.push("align-sub text-xs");

  // Track-change styling
  let tcClassName = "";
  if (trackChange && trackChange.status === TrackChangeStatus.PENDING) {
    const isOwn = trackChange.author === currentAuthor;
    if (trackChange.type === TrackChangeType.INSERTION) {
      tcClassName = isOwn
        ? "underline decoration-green-400/50 text-green-600/50"
        : "underline decoration-green-500 text-green-700";
    } else if (trackChange.type === TrackChangeType.DELETION) {
      tcClassName = isOwn
        ? "line-through decoration-red-400/50 text-red-500/50"
        : "line-through decoration-red-500 text-red-700";
    } else if (trackChange.type === TrackChangeType.REPLACEMENT) {
      tcClassName = isOwn
        ? "underline decoration-green-400/50 text-green-600/50"
        : "underline decoration-green-500 text-green-700";
    }
  }

  const inlineStyle: React.CSSProperties = {};
  if (p.fontSize) inlineStyle.fontSize = p.fontSize;
  if (p.fontFamily) inlineStyle.fontFamily = p.fontFamily;
  if (p.color) inlineStyle.color = `#${p.color}`;

  return (
    <span
      data-run-id={run.id}
      className={[...classes, tcClassName].filter(Boolean).join(" ") || undefined}
      style={Object.keys(inlineStyle).length > 0 ? inlineStyle : undefined}
    >
      {run.text}
    </span>
  );
}
