"use client";

import { useState } from "react";
import type { StreamToolCall as StreamToolCallType } from "@/types/streaming";

interface StreamToolCallProps {
  toolCall: StreamToolCallType;
  /**
   * Whether tool outputs are expected to be streamed.
   * If false, tool calls are considered complete once input is available.
   * @default true
   */
  expectsOutput?: boolean;
}

const WrenchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
  </svg>
);

export function StreamToolCall({ toolCall, expectsOutput = true }: StreamToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // If outputs aren't expected, consider tool complete once input is available
  const isComplete = expectsOutput
    ? toolCall.status === "output-available"
    : toolCall.status === "output-available" || toolCall.status === "input-available";
  const isError = toolCall.status === "input-error" || toolCall.status === "output-error";
  const isRunning = !isComplete && !isError;

  // Strip "developer__" prefix from tool name for display only
  const displayName = toolCall.toolName.startsWith("developer__")
    ? toolCall.toolName.replace("developer__", "")
    : toolCall.toolName;

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors text-xs font-medium cursor-pointer"
      >
        <WrenchIcon />
        <span>{displayName}</span>
        {isRunning && <span className="text-muted-foreground animate-pulse">...</span>}
        {isComplete && <span className="text-muted-foreground">Complete</span>}
        {isError && <span className="text-destructive">Error</span>}
      </button>

      {isExpanded && (
        <div className="mt-2 ml-5 text-xs text-muted-foreground space-y-2 overflow-hidden">
          {toolCall.inputText && (
            <div>
              <div className="font-semibold mb-1">Input:</div>
              <div className="bg-muted/50 rounded p-2 font-mono text-[10px] whitespace-pre-wrap break-words">
                {toolCall.inputText}
              </div>
            </div>
          )}

          {toolCall.output !== undefined && (
            <div>
              <div className="font-semibold mb-1">Output:</div>
              <div className="bg-muted/50 rounded p-2 font-mono text-[10px] whitespace-pre-wrap break-words max-h-60 overflow-y-auto overflow-x-hidden">
                {String(
                  typeof toolCall.output === "string" ? toolCall.output : JSON.stringify(toolCall.output, null, 2),
                )}
              </div>
            </div>
          )}

          {toolCall.errorText && (
            <div>
              <div className="font-semibold mb-1 text-destructive">Error:</div>
              <div className="bg-destructive/10 rounded p-2 text-destructive break-words">{toolCall.errorText}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
