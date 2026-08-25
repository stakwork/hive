"use client";

import React from "react";

/**
 * Minimal markdown renderer for LLM-authored prose (agent final answers,
 * judge notes/disputes in benchmark reports).
 *
 * Everything renders as ESCAPED REACT TEXT per this directory's rule — no
 * dangerouslySetInnerHTML, no MarkdownRenderer/MermaidDiagram (HTML sinks).
 * Supports: #/##/### headings, -/* bullets, 1. numbered lists, **bold**,
 * `inline code`, ``` fenced blocks. Everything else is a paragraph.
 */

function inline(text: string, key: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // **bold** and `code` — alternating split, escaped by construction
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<b key={`${key}-${i++}`}>{tok.slice(2, -2)}</b>);
    } else {
      parts.push(
        <code key={`${key}-${i++}`} className="font-mono text-[0.92em] bg-muted/60 rounded px-1">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function SafeMarkdown({
  text,
  className = "text-[13px] text-muted-foreground",
}: {
  text: string;
  /** Replaces the default wrapper classes (size + color) when provided. */
  className?: string;
}) {
  const out: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: React.ReactNode[] } | null = null;
  let fence: string[] | null = null;

  const flushList = (key: number) => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{it}</li>);
    out.push(
      list.ordered ? (
        <ol key={`l${key}`} className="list-decimal pl-5 space-y-0.5 my-1.5">{items}</ol>
      ) : (
        <ul key={`l${key}`} className="list-disc pl-5 space-y-0.5 my-1.5">{items}</ul>
      ),
    );
    list = null;
  };

  lines.forEach((line, n) => {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push(
          <pre key={`f${n}`} className="font-mono text-[0.9em] bg-muted/40 border border-border rounded p-2 my-1.5 whitespace-pre-wrap overflow-x-auto">
            {fence.join("\n")}
          </pre>,
        );
        fence = null;
      } else {
        fence.push(line);
      }
      return;
    }
    if (/^\s*```/.test(line)) {
      flushList(n);
      fence = [];
      return;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushList(n);
      const level = h[1].length;
      const cls =
        level === 1
          ? "text-[1.1em] font-semibold mt-3 mb-1"
          : level === 2
            ? "text-[1.04em] font-semibold mt-2.5 mb-1"
            : "font-semibold mt-2 mb-0.5";
      out.push(<div key={n} className={cls}>{inline(h[2], n)}</div>);
      return;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) {
        flushList(n);
        list = { ordered: false, items: [] };
      }
      list.items.push(inline(bullet[1], n));
      return;
    }
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (num) {
      if (!list || !list.ordered) {
        flushList(n);
        list = { ordered: true, items: [] };
      }
      list.items.push(inline(num[1], n));
      return;
    }
    flushList(n);
    if (line.trim()) out.push(<p key={n} className="my-1">{inline(line, n)}</p>);
  });
  flushList(lines.length);
  if (fence !== null) {
    out.push(
      <pre key="tail" className="font-mono text-[0.9em] bg-muted/40 border border-border rounded p-2 my-1.5 whitespace-pre-wrap overflow-x-auto">
        {(fence as string[]).join("\n")}
      </pre>,
    );
  }
  return <div className={className}>{out}</div>;
}
