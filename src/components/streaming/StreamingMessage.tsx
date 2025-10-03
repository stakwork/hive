"use client";

import type { BaseStreamingMessage } from "@/types/streaming";
import { StreamTextPart } from "./StreamTextPart";
import { StreamToolCall } from "./StreamToolCall";
import { StreamReasoningPart } from "./StreamReasoningPart";

interface StreamingMessageProps {
  message: BaseStreamingMessage;
  filterTextParts?: (partId: string) => boolean;
  renderTextPart?: (part: { id: string; content: string }) => React.ReactNode;
  textPartClassName?: string;
  reasoningPartClassName?: string;
  /**
   * IDs of text parts that should be considered as "final content" for showing thinking indicator
   * If specified, thinking indicator shows when streaming but these parts don't exist yet
   */
  finalContentIds?: string[];
}

/**
 * Generic streaming message renderer
 *
 * @example
 * // Basic usage
 * <StreamingMessage message={message} />
 *
 * @example
 * // With custom filtering and rendering
 * <StreamingMessage
 *   message={message}
 *   filterTextParts={(id) => id !== "final-answer"}
 *   renderTextPart={(part) => <CustomTextPart part={part} />}
 * />
 */
export function StreamingMessage({
  message,
  filterTextParts,
  renderTextPart,
  textPartClassName,
  reasoningPartClassName,
  finalContentIds = [],
}: StreamingMessageProps) {
  const textParts = filterTextParts
    ? message.textParts?.filter((part) => filterTextParts(part.id))
    : message.textParts;

  // Determine if we should show "Thinking..."
  const shouldShowThinking = () => {
    if (!message.isStreaming) return false;

    // If finalContentIds specified, check if any of those parts exist
    if (finalContentIds.length > 0) {
      const hasFinalContent = finalContentIds.some((id) =>
        message.textParts?.some((part) => part.id === id)
      );
      return !hasFinalContent;
    }

    // Default: show thinking if no textParts and no toolCalls
    return !message.textParts?.length && !message.toolCalls?.length;
  };

  return (
    <div className="flex flex-col gap-2">
      {message.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
          {message.error}
        </div>
      )}

      {message.reasoningParts?.map((part) => (
        <StreamReasoningPart
          key={part.id}
          part={part}
          className={reasoningPartClassName}
        />
      ))}

      {textParts?.map((part) =>
        renderTextPart ? (
          <div key={part.id}>{renderTextPart(part)}</div>
        ) : (
          <StreamTextPart key={part.id} part={part} className={textPartClassName} />
        )
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="bg-muted/50 border border-border/50 rounded-lg p-2 my-1">
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls.map((toolCall) => (
              <StreamToolCall key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        </div>
      )}

      {shouldShowThinking() && (
        <div className="flex items-center space-x-1 text-muted-foreground">
          <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
          <div
            className="w-1 h-1 bg-current rounded-full animate-pulse"
            style={{ animationDelay: "0.2s" }}
          ></div>
          <div
            className="w-1 h-1 bg-current rounded-full animate-pulse"
            style={{ animationDelay: "0.4s" }}
          ></div>
          <span className="ml-2 text-xs">Thinking...</span>
        </div>
      )}
    </div>
  );
}
