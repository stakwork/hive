"use client";

import React, { useMemo } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { ScrollFade } from "../chrome";
import { markdownPreviewLines } from "../lines";

/** The chat shows a document's first few lines under its title. */
const PREVIEW_LINES = 3;

/** The document without its opening heading, when that heading only repeats the title above it in the chat. */
function withoutTitleHeading(text: string, title: string): string {
  const heading = /^\s*#\s+(.+?)\s*(?:\n+|$)/.exec(text);
  return heading && heading[1] === title.trim() ? text.slice(heading[0].length) : text;
}

/** The document's first lines, plain, under its title in the chat. */
export function MarkdownPreview({ artifact, content }: ArtifactViewerProps<"markdown">) {
  const lines = useMemo(
    () => markdownPreviewLines(withoutTitleHeading(content.text, artifact.title), PREVIEW_LINES),
    [content.text, artifact.title],
  );
  return (
    <span className="block space-y-0.5 text-xs">
      {lines.map((line, i) => (
        <span key={i} className="block truncate">
          {line}
        </span>
      ))}
    </span>
  );
}

export function MarkdownPanel({ content }: ArtifactViewerProps<"markdown">) {
  return (
    <ScrollFade className="mx-auto w-full max-w-3xl px-8 py-8">
      <MarkdownRenderer className="[&>*:first-child]:!mt-0">{content.text}</MarkdownRenderer>
    </ScrollFade>
  );
}
