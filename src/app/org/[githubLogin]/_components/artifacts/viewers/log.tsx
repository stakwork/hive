"use client";

import React, { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, WrapText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { PanelToolbar, ScrollFade, ToolbarButton } from "../chrome";
import { lastLines, parseLogLines, plural, type LogLevel, type LogLine } from "../lines";

/** A card shows the end of a log: the last thing that happened is the first thing asked about. */
const INLINE_LINES = 6;
/** Lines the panel draws at once. A longer log shows its end; the filters reach the rest. */
const PANEL_LINES = 2000;

/** The level word carries the colour; a debug line steps back as a whole. */
const LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-rose-600 [.dark_&]:text-rose-400",
  warn: "text-amber-600 [.dark_&]:text-amber-400",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

export function LogInline({ content }: ArtifactViewerProps<"log">) {
  // Only the end is shown, so only the end is read.
  const { tail, more } = useMemo(() => {
    const text = content.text.trimEnd();
    const end = lastLines(text, INLINE_LINES);
    return { tail: parseLogLines(end), more: end.length < text.length };
  }, [content.text]);
  const hasLevel = tail.some((line) => line.level);
  if (tail.length === 0) return <p className="px-3 py-2.5 text-xs text-muted-foreground">No output.</p>;
  return (
    <div className="relative px-3 py-2.5 font-mono text-[11px] leading-5">
      {tail.map((line) => (
        <div key={line.number} className={cn("flex gap-2", line.level === "debug" && "text-muted-foreground")}>
          {hasLevel && (
            <span className={cn("w-[5ch] shrink-0 uppercase", line.level && LEVEL_CLASS[line.level])}>
              {line.level ?? ""}
            </span>
          )}
          <span className="min-w-0 truncate">{line.text}</span>
        </div>
      ))}
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-card to-transparent"
        />
      )}
    </div>
  );
}

type LevelFilter = "all" | "warn" | "error";

function matchesLevel(line: LogLine, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "error") return line.group === "error";
  return line.group === "error" || line.group === "warn";
}

/**
 * The whole log: time and level in columns, a level filter and a search
 * that narrow it, opened at the end where the newest lines are.
 */
export function LogPanel({ content }: ArtifactViewerProps<"log">) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // The box keeps up with typing; the list follows when it can.
  const needle = useDeferredValue(query).trim().toLowerCase();
  const [level, setLevel] = useState<LevelFilter>("all");
  const [wrap, setWrap] = useState(false);

  const lines = useMemo(() => parseLogLines(content.text), [content.text]);
  const hasTime = useMemo(() => lines.some((line) => line.time), [lines]);
  const hasLevel = useMemo(() => lines.some((line) => line.level), [lines]);
  const errors = useMemo(() => lines.filter((line) => line.level === "error").length, [lines]);
  const warnings = useMemo(() => lines.filter((line) => line.level === "warn").length, [lines]);
  const shown = useMemo(
    () => lines.filter((line) => matchesLevel(line, level) && (!needle || line.text.toLowerCase().includes(needle))),
    [lines, level, needle],
  );
  const drawn = shown.length > PANEL_LINES ? shown.slice(-PANEL_LINES) : shown;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content.text]);

  const numberWidth = `${String(lines.length).length}ch`;

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter lines"
            aria-label="Filter lines"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>
        {hasLevel && (
          <Select value={level} onValueChange={(value) => setLevel(value as LevelFilter)}>
            <SelectTrigger aria-label="Level" className="h-7 w-auto shrink-0 gap-1.5 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="warn">Warnings and errors ({warnings + errors})</SelectItem>
              <SelectItem value="error">Errors ({errors})</SelectItem>
            </SelectContent>
          </Select>
        )}
        <span className="shrink-0 px-1.5 tabular-nums text-muted-foreground">
          {shown.length === lines.length
            ? plural(lines.length, "line")
            : `${shown.length.toLocaleString("en-US")} of ${plural(lines.length, "line")}`}
        </span>
        <ToolbarButton label="Wrap lines" onClick={() => setWrap((w) => !w)} pressed={wrap}>
          <WrapText className="h-4 w-4" />
        </ToolbarButton>
      </PanelToolbar>
      <div className="min-h-0 flex-1">
        <ScrollFade
          viewportRef={viewportRef}
          className={cn("py-3 font-mono text-[11px] leading-5", !wrap && "w-max min-w-full")}
        >
          {drawn.length < shown.length && (
            <p className="px-4 pb-2 font-sans text-xs text-muted-foreground">
              The last {drawn.length.toLocaleString("en-US")} of {plural(shown.length, "line")}. Filter to reach the
              rest.
            </p>
          )}
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center font-sans text-xs text-muted-foreground">
              {lines.length === 0 ? "No output." : "No lines match."}
            </p>
          ) : (
            drawn.map((line) => (
              <div
                key={line.number}
                className={cn("flex gap-3 px-4 hover:bg-muted/40", line.level === "debug" && "text-muted-foreground")}
              >
                <span
                  className="shrink-0 select-none text-right tabular-nums text-muted-foreground/60"
                  style={{ width: numberWidth }}
                >
                  {line.number}
                </span>
                {hasTime && <span className="w-[8ch] shrink-0 text-muted-foreground">{line.time ?? ""}</span>}
                {hasLevel && (
                  <span className={cn("w-[5ch] shrink-0 uppercase", line.level && LEVEL_CLASS[line.level])}>
                    {line.level ?? ""}
                  </span>
                )}
                <span className={cn("min-w-0", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                  {line.text}
                </span>
              </div>
            ))
          )}
        </ScrollFade>
      </div>
    </div>
  );
}
