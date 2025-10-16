"use client";

import type {
  BaseStreamingMessage,
  StreamTextPart as StreamTextPartType,
  StreamReasoningPart as StreamReasoningPartType,
  StreamToolCall as StreamToolCallType,
} from "@/types/streaming";
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
  // Separate final text part from regular timeline
  const finalTextPart = finalTextPartId ? message.textParts?.find((part) => part.id === finalTextPartId) : undefined;

  // Filter timeline to exclude final text part
  const regularTimeline = message.timeline?.filter((item) => !(item.type === "text" && item.id === finalTextPartId));

  // Determine if we should show "Thinking..."
  const shouldShowThinking = () => {
    if (!message.isStreaming) return false;

    // If finalTextPartId specified, show thinking until that part exists
    if (finalTextPartId) {
      return !finalTextPart;
    }

    // Default: show thinking if no timeline items
    return !message.timeline?.length;
  };

  // Render a timeline item
  const renderTimelineItem = (item: NonNullable<typeof message.timeline>[0]) => {
    // Use unique key based on type and id, not index
    const key = `${item.type}-${item.id}`;

    if (item.type === "text") {
      return <StreamTextPart key={key} part={item.data as StreamTextPartType} className={textPartClassName} />;
    } else if (item.type === "reasoning") {
      return (
        <StreamReasoningPart key={key} part={item.data as StreamReasoningPartType} className={reasoningPartClassName} />
      );
    } else if (item.type === "toolCall") {
      return (
        <div key={key} className="bg-muted/50 border border-border/50 rounded-lg p-2 my-1">
          <StreamToolCall toolCall={item.data as StreamToolCallType} />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-2">
      {message.error && <div className="text-xs text-destructive bg-destructive/10 rounded p-2">{message.error}</div>}

      {/* Render timeline items in order */}
      {regularTimeline?.map((item) => renderTimelineItem(item))}

      {shouldShowThinking() && (
        <div className="flex items-center space-x-1 text-muted-foreground">
          <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
          <div className="w-1 h-1 bg-current rounded-full animate-pulse" style={{ animationDelay: "0.2s" }}></div>
          <div className="w-1 h-1 bg-current rounded-full animate-pulse" style={{ animationDelay: "0.4s" }}></div>
          <span className="ml-2 text-xs">Thinking...</span>
        </div>
      )}

      {/* Render final text part at the end */}
      {finalTextPart && <StreamTextPart part={finalTextPart} className={textPartClassName} />}
    </div>
  );
}
