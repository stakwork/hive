"use client";

import { StreamToolCall as StreamToolCallType } from "@/types/learn";

interface StreamToolCallProps {
  toolCall: StreamToolCallType;
}

export function StreamToolCall({ toolCall }: StreamToolCallProps) {
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "input-start":
        return { emoji: "⏳", label: "Starting..." };
      case "input-delta":
        return { emoji: "⌨️", label: "Inputting..." };
      case "input-available":
        return { emoji: "🔧", label: "Running..." };
      case "input-error":
        return { emoji: "❌", label: "Input Error" };
      case "output-available":
        return { emoji: "✅", label: "Complete" };
      case "output-error":
        return { emoji: "⚠️", label: "Error" };
      default:
        return { emoji: "🔨", label: "Processing..." };
    }
  };

  const hasError = toolCall.status === "input-error" || toolCall.status === "output-error";
  const status = getStatusDisplay(toolCall.status);

  return (
    <div
      className={`rounded-lg p-3 border ${
        hasError
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
          : "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{status.emoji}</span>
        <div className="flex-1">
          <div className="font-semibold text-sm">{toolCall.toolName}</div>
          <div className="text-xs text-muted-foreground">{status.label}</div>
        </div>
      </div>

      {toolCall.inputText && (
        <div className="text-xs bg-white/50 dark:bg-black/20 rounded p-2 mt-2 font-mono">{toolCall.inputText}</div>
      )}

      {toolCall.output !== undefined && (
        <div className="text-xs bg-white/50 dark:bg-black/20 rounded p-2 mt-2">
          {String(
            typeof toolCall.output === "string"
              ? toolCall.output.length > 200
                ? toolCall.output.substring(0, 200) + "..."
                : toolCall.output
              : JSON.stringify(toolCall.output, null, 2).substring(0, 200) +
                  (JSON.stringify(toolCall.output).length > 200 ? "..." : ""),
          )}
        </div>
      )}

      {toolCall.errorText && (
        <div className="text-xs bg-red-100 dark:bg-red-900/30 rounded p-2 mt-2 text-red-700 dark:text-red-300">
          {toolCall.errorText}
        </div>
      )}
    </div>
  );
}
