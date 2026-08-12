"use client";

import React, { createElement, Fragment, type ReactNode } from "react";
import type { SanitizedNode } from "@/lib/run-report/types";

/**
 * Render the closed sanitized-node shape as React elements.
 *
 * There is NO `dangerouslySetInnerHTML` in this directory — this only ever
 * calls `createElement` with a tag name and an allowlisted attribute bag.
 *
 * `highlights` are character ranges into the flattened text index, applied by
 * walking the tree in the same order, so a range can span several nodes.
 */

interface Props {
  nodes: SanitizedNode[];
  highlights?: Array<{ start: number; end: number }>;
}

/** Tags that must not receive children (React throws if they do). */
const VOID_TAGS = new Set(["br", "hr", "col"]);

export function SanitizedContent({ nodes, highlights = [] }: Props) {
  // A single mutable cursor threaded through the walk keeps text offsets
  // aligned with `flattenText`, which numbers text nodes in the same order.
  const cursor = { offset: 0 };
  return <>{renderList(nodes, highlights, cursor, "n")}</>;
}

function renderList(
  nodes: SanitizedNode[],
  highlights: Array<{ start: number; end: number }>,
  cursor: { offset: number },
  keyPrefix: string,
): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, highlights, cursor, `${keyPrefix}-${i}`));
}

function renderNode(
  node: SanitizedNode,
  highlights: Array<{ start: number; end: number }>,
  cursor: { offset: number },
  key: string,
): ReactNode {
  if (typeof node === "string") {
    const start = cursor.offset;
    cursor.offset += node.length;
    return <Fragment key={key}>{applyHighlights(node, start, highlights)}</Fragment>;
  }

  const children = node.c ? renderList(node.c, highlights, cursor, key) : null;

  if (VOID_TAGS.has(node.t)) {
    return createElement(node.t, { key, ...(node.a ?? {}) });
  }

  return createElement(node.t, { key, ...(node.a ?? {}) }, children);
}

/** Split a text node against overlapping ranges; bare string if none overlap. */
function applyHighlights(
  text: string,
  nodeStart: number,
  highlights: Array<{ start: number; end: number }>,
): ReactNode {
  if (highlights.length === 0) return text;

  const nodeEnd = nodeStart + text.length;
  const overlapping = highlights.filter((h) => h.start < nodeEnd && h.end > nodeStart);
  if (overlapping.length === 0) return text;

  const parts: ReactNode[] = [];
  let position = 0;

  for (const range of overlapping) {
    const from = Math.max(0, range.start - nodeStart);
    const to = Math.min(text.length, range.end - nodeStart);
    if (from > position) parts.push(text.slice(position, from));
    if (to > from) {
      parts.push(
        <mark
          key={`${nodeStart}-${from}`}
          className="bg-amber-200 text-amber-950 dark:bg-amber-500/40 dark:text-amber-50 rounded-sm px-0.5"
        >
          {text.slice(from, to)}
        </mark>,
      );
    }
    position = Math.max(position, to);
  }

  if (position < text.length) parts.push(text.slice(position));
  return parts;
}
