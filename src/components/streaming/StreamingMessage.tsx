"use client";

import type { BaseStreamingMessage } from "@/types/streaming";
import { StreamTextPart } from "./StreamTextPart";
import { StreamToolCall } from "./StreamToolCall";
import { StreamReasoningPart } from "./StreamReasoningPart";

interface StreamingMessageProps {
  message: BaseStreamingMessage;
  textPartClassName?: string;
  reasoningPartClassName?: string;
  /**
   * ID of text part that should be rendered last (e.g., "final-answer")
   * This part will be filtered from the main content and rendered at the end
   * Also controls "Thinking..." indicator - shown when streaming but this part doesn't exist yet
   */
  finalTextPartId?: string;
}

/**
 * Generic streaming message renderer
 *
 * @example
 * // Basic usage
 * <StreamingMessage message={message} />
 *
 * @example
 * // With final answer rendered separately
 * <StreamingMessage message={message} finalTextPartId="final-answer" />
 */
export function StreamingMessage({
  message,
  textPartClassName,
  reasoningPartClassName,
  finalTextPartId,
}: StreamingMessageProps) {
  // Separate final text part from regular text parts
  const regularTextParts = finalTextPartId
    ? message.textParts?.filter((part) => part.id !== finalTextPartId)
    : message.textParts;

  const finalTextPart = finalTextPartId
    ? message.textParts?.find((part) => part.id === finalTextPartId)
    : undefined;

  // Determine if we should show "Thinking..."
  const shouldShowThinking = () => {
    if (!message.isStreaming) return false;

    // If finalTextPartId specified, show thinking until that part exists
    if (finalTextPartId) {
      return !finalTextPart;
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

      {regularTextParts?.map((part) => (
        <StreamTextPart key={part.id} part={part} className={textPartClassName} />
      ))}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="bg-muted/50 border border-border/50 rounded-lg p-2 my-1">
          <div className="flex flex-col gap-1.5">
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

      {/* Render final text part at the end */}
      {finalTextPart && (
        <StreamTextPart part={finalTextPart} className={textPartClassName} />
      )}
    </div>
  );
}
