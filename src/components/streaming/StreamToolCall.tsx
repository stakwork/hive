"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code,
  FileText,
  Globe,
  Loader2,
  Pencil,
  ScrollText,
  Search,
  Send,
  SquareFunction,
  Terminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { StreamToolCall as StreamToolCallType } from "@/types/streaming";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { CopyButton } from "@/components/ui/copy-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  isPlainObject,
  isPrimitive,
  tableColumns,
  toJsonText,
  toolCallInput,
  toolCallPhase,
  toolIconKey,
  toolLabel,
  type ToolCallPhase,
  type ToolIconKey,
} from "./toolCallValue";

/** The glyph for each kind of tool; a function call is the generic one. */
const TOOL_ICONS: Record<ToolIconKey, LucideIcon> = {
  web: Globe,
  graph: Waypoints,
  search: Search,
  file: FileText,
  edit: Pencil,
  docs: BookOpen,
  send: Send,
  shell: Terminal,
  logs: ScrollText,
  code: Code,
  generic: SquareFunction,
};

/** State first — a spinner while the call runs, amber when it failed — else the resting glyph. */
export function ToolCallMarker({ phase, glyph: Glyph }: { phase: ToolCallPhase; glyph: LucideIcon }) {
  if (phase === "running") {
    return <Loader2 aria-label="Running" className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />;
  }
  if (phase === "error") {
    return <AlertTriangle aria-label="Failed" className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }
  return <Glyph aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function ToolCallChevron({ open }: { open: boolean }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

/** The row buttons share one shape: content-wide, so the chevron sits right after the words. */
export const TOOL_ROW_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors";

// ─── Values, laid out for reading ───────────────────────────────────────

const TABLE_PREVIEW_ROWS = 8;
const NESTING_LIMIT = 2;

function cellText(cell: unknown): string {
  return cell === undefined || cell === null ? "—" : String(cell);
}

function ValueTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TABLE_PREVIEW_ROWS);
  return (
    <div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column} className="h-auto px-0 pb-1 pr-3">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {columns.map((column) => (
                <TableCell key={column} className="px-0 py-1 pr-3 align-top break-words">
                  {cellText(row[column])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          Show all {rows.length}
        </button>
      )}
    </div>
  );
}

function KeyValueList({ entries, depth }: { entries: [string, unknown][]; depth: number }) {
  if (entries.length === 0) return <span className="text-muted-foreground">empty</span>;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="min-w-0">
            <ToolValue value={value} depth={depth + 1} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * A tool's input or output as something to read rather than parse: fields
 * as a key/value list, a list of records as a table, a list of words as a
 * line; anything deeper or stranger falls back to JSON. Memoised because a
 * streaming turn re-renders every open detail many times a second.
 */
const ToolValue = React.memo(function ToolValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const columns = useMemo(() => tableColumns(value), [value]);
  if (value === undefined) return null;
  if (isPrimitive(value)) {
    return <span className="whitespace-pre-wrap break-words">{cellText(value)}</span>;
  }
  if (columns) return <ValueTable rows={value as Record<string, unknown>[]} columns={columns} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">empty</span>;
    if (value.every(isPrimitive)) return <span className="break-words">{value.map(String).join(", ")}</span>;
    if (depth < NESTING_LIMIT) {
      return (
        <ol className="list-decimal space-y-1 pl-4">
          {value.map((item, i) => (
            <li key={i}>
              <ToolValue value={item} depth={depth + 1} />
            </li>
          ))}
        </ol>
      );
    }
  }
  if (isPlainObject(value) && depth < NESTING_LIMIT) {
    return <KeyValueList entries={Object.entries(value)} depth={depth} />;
  }
  return <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{toJsonText(value)}</pre>;
});

// ─── The detail under a row ─────────────────────────────────────────────

/** One part of a call — Input, Output, Error — with its copy button and a raw JSON view. */
function DetailSection({
  label,
  text,
  rawAvailable = true,
  children,
}: {
  label: string;
  /** The part as text, for the clipboard and the raw view. */
  text: string;
  rawAvailable?: boolean;
  children: React.ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  return (
    <section className="min-w-0">
      <header className="flex items-center gap-2">
        <span className="mr-auto font-medium text-muted-foreground">{label}</span>
        {rawAvailable && (
          <button
            type="button"
            onClick={() => setRaw((r) => !r)}
            aria-pressed={raw}
            className={cn(
              "rounded px-1 text-[11px] transition-colors hover:text-foreground",
              raw ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Raw
          </button>
        )}
        <CopyButton value={text} label={`Copy ${label.toLowerCase()}`} />
      </header>
      <div className="mt-1 max-h-64 overflow-auto">
        {raw ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{text}</pre> : children}
      </div>
    </section>
  );
}

function ToolCallDetail({ toolCall }: { toolCall: StreamToolCallType }) {
  const { output, errorText } = toolCall;
  const input = useMemo(() => toolCallInput(toolCall), [toolCall]);
  const inputText = useMemo(() => toJsonText(input), [input]);
  const outputText = useMemo(() => toJsonText(output), [output]);
  return (
    <div className="ml-1.5 mt-1 space-y-3 rounded-md bg-muted/30 px-3 py-2 text-xs">
      {input !== undefined && (
        <DetailSection label="Input" text={inputText} rawAvailable={typeof input !== "string"}>
          <ToolValue value={input} />
        </DetailSection>
      )}
      {output !== undefined && (
        <DetailSection label="Output" text={outputText} rawAvailable={typeof output !== "string"}>
          {typeof output === "string" ? (
            <MarkdownRenderer variant="assistant" size="compact">
              {output}
            </MarkdownRenderer>
          ) : (
            <ToolValue value={output} />
          )}
        </DetailSection>
      )}
      {errorText && (
        <DetailSection label="Error" text={errorText} rawAvailable={false}>
          <p className="break-words text-amber-600 dark:text-amber-400">{errorText}</p>
        </DetailSection>
      )}
    </div>
  );
}

// ─── The row ────────────────────────────────────────────────────────────

interface StreamToolCallProps {
  toolCall: StreamToolCallType;
  /**
   * Whether tool outputs are expected to be streamed.
   * If false, tool calls are considered complete once input is available.
   * @default true
   */
  expectsOutput?: boolean;
}

/** One tool call as a row — its name, its state — that opens into its input, output and error. */
export const StreamToolCall = React.memo(function StreamToolCall({
  toolCall,
  expectsOutput = true,
}: StreamToolCallProps) {
  const [open, setOpen] = useState(false);
  const phase = toolCallPhase(toolCall, expectsOutput);
  const { name, scope } = toolLabel(toolCall.toolName);
  const hasDetail =
    toolCall.input !== undefined || !!toolCall.inputText || toolCall.output !== undefined || !!toolCall.errorText;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasDetail}
        className={cn(TOOL_ROW_CLASS, hasDetail ? "hover:bg-muted/60" : "cursor-default")}
      >
        <ToolCallMarker phase={phase} glyph={TOOL_ICONS[toolIconKey(toolCall.toolName)]} />
        <span className="min-w-0 truncate text-foreground/90">{name}</span>
        {scope && <span className="shrink-0 text-muted-foreground">· {scope}</span>}
        {hasDetail && <ToolCallChevron open={open} />}
      </button>
      {open && <ToolCallDetail toolCall={toolCall} />}
    </div>
  );
});
