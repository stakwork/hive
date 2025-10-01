"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";
import { StreamToolCall as StreamToolCallType } from "@/types/learn";

interface StreamToolCallProps {
  toolCall: StreamToolCallType;
}

export function StreamToolCall({ toolCall }: StreamToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isComplete = toolCall.status === "output-available";
  const isError = toolCall.status === "input-error" || toolCall.status === "output-error";
  const isRunning = !isComplete && !isError;

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors text-xs font-medium cursor-pointer"
      >
        <Wrench className="w-3 h-3" />
        <span>{toolCall.toolName}</span>
        {isRunning && (
          <span className="text-muted-foreground animate-pulse">...</span>
        )}
        {isComplete && (
          <span className="text-muted-foreground">Complete</span>
        )}
        {isError && (
          <span className="text-destructive">Error</span>
        )}
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
                  typeof toolCall.output === "string"
                    ? toolCall.output
                    : JSON.stringify(toolCall.output, null, 2)
                )}
              </div>
            </div>
          )}

          {toolCall.errorText && (
            <div>
              <div className="font-semibold mb-1 text-destructive">Error:</div>
              <div className="bg-destructive/10 rounded p-2 text-destructive break-words">
                {toolCall.errorText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
