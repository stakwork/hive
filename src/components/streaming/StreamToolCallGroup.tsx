"use client";

import React, { useMemo, useState } from "react";
import { SquareFunction } from "lucide-react";
import type { StreamToolCall as StreamToolCallType } from "@/types/streaming";
import { cn } from "@/lib/utils";
import { StreamToolCall, TOOL_ROW_CLASS, ToolCallChevron, ToolCallMarker } from "./StreamToolCall";
import { toolCallPhase, toolLabel, type ToolCallPhase } from "./toolCallValue";

interface StreamToolCallGroupProps {
  toolCalls: StreamToolCallType[];
  /**
   * Whether tool outputs are expected to be streamed.
   * If false, tool calls are considered complete once input is available.
   * @default true
   */
  expectsOutput?: boolean;
}

/** What the header says about the burst: its state and the tools in it, in one pass. */
function summarize(toolCalls: StreamToolCallType[], expectsOutput: boolean) {
  let running = 0;
  let failed = 0;
  const names: string[] = [];
  for (const tc of toolCalls) {
    const phase = toolCallPhase(tc, expectsOutput);
    if (phase === "running") running += 1;
    else if (phase === "error") failed += 1;
    const { name } = toolLabel(tc.toolName);
    if (!names.includes(name)) names.push(name);
  }
  const phase: ToolCallPhase = running > 0 ? "running" : failed > 0 ? "error" : "complete";
  return { running, failed, phase, names: names.join(", ") };
}

/**
 * The tool calls an agent made back to back, as one row — "3 tool calls"
 * and their names — that opens into the calls themselves. A lone call is
 * its own row.
 */
export const StreamToolCallGroup = React.memo(function StreamToolCallGroup({
  toolCalls,
  expectsOutput = true,
}: StreamToolCallGroupProps) {
  const [open, setOpen] = useState(false);
  const { running, failed, phase, names } = useMemo(
    () => summarize(toolCalls, expectsOutput),
    [toolCalls, expectsOutput],
  );
  if (toolCalls.length === 1) return <StreamToolCall toolCall={toolCalls[0]} expectsOutput={expectsOutput} />;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(TOOL_ROW_CLASS, "hover:bg-muted/60")}
      >
        <ToolCallMarker phase={phase} glyph={SquareFunction} />
        <span className="shrink-0 font-medium text-foreground/90">{toolCalls.length} tool calls</span>
        <span className="min-w-0 truncate text-muted-foreground">{names}</span>
        {running > 0 && <span className="shrink-0 text-muted-foreground">· {running} running</span>}
        {failed > 0 && <span className="shrink-0 text-amber-600 dark:text-amber-400">· {failed} failed</span>}
        <ToolCallChevron open={open} />
      </button>
      {open && (
        <div className="ml-1.5 mt-0.5 border-l pl-1">
          {toolCalls.map((tc) => (
            <StreamToolCall key={tc.id} toolCall={tc} expectsOutput={expectsOutput} />
          ))}
        </div>
      )}
    </div>
  );
});
