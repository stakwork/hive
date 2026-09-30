"use client";

import React, { useMemo } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { InlineClamp, ScrollFade } from "../chrome";
import { markdownExcerpt } from "../lines";

/** The card's clamp shows a handful of lines; the document past this many is never drawn there. */
const EXCERPT_LINES = 60;

/**
 * The renderer's compact size is made for a chat bubble. An excerpt on a
 * card sits a step below that: every heading the size of the card's title
 * or smaller, body text at the card's own size.
 */
const EXCERPT_CLASS = [
  "[&>*:first-child]:!mt-0",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:!mb-1 [&_:is(h1,h2,h3,h4,h5,h6)]:!mt-3",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:!border-0 [&_:is(h1,h2,h3,h4,h5,h6)]:!pb-0",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:!text-[13px]",
  "[&_:is(p,li,td,th,blockquote)]:!text-xs [&_:is(p,li)]:!leading-5",
].join(" ");

/** The document without its opening heading, when that heading only repeats the card's title above it. */
function withoutTitleHeading(text: string, title: string): string {
  const heading = /^\s*#\s+(.+?)\s*(?:\n+|$)/.exec(text);
  return heading && heading[1] === title.trim() ? text.slice(heading[0].length) : text;
}

export function MarkdownInline({ artifact, content }: ArtifactViewerProps<"markdown">) {
  const excerpt = useMemo(
    () => markdownExcerpt(withoutTitleHeading(content.text, artifact.title), EXCERPT_LINES),
    [content.text, artifact.title],
  );
  return (
    <InlineClamp className="px-3 py-2.5">
      <MarkdownRenderer size="compact" className={EXCERPT_CLASS}>
        {excerpt}
      </MarkdownRenderer>
    </InlineClamp>
  );
}

export function MarkdownPanel({ content }: ArtifactViewerProps<"markdown">) {
  return (
    <ScrollFade className="mx-auto w-full max-w-3xl px-8 py-8">
      <MarkdownRenderer className="[&>*:first-child]:!mt-0">{content.text}</MarkdownRenderer>
    </ScrollFade>
  );
}
