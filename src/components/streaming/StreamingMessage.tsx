"use client";

import { useMemo } from "react";
import type {
  BaseStreamingMessage,
  StreamTextPart as StreamTextPartType,
  StreamReasoningPart as StreamReasoningPartType,
} from "@/types/streaming";
import { chunkTimeline, type TimelineChunk } from "./chunkTimeline";
import { StreamTextPart } from "./StreamTextPart";
import { StreamToolCallGroup } from "./StreamToolCallGroup";
import { StreamReasoningPart } from "./StreamReasoningPart";
import { TurnTokenUsage } from "@/components/agent-logs/TurnTokenUsage";

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
  /**
   * Whether tool outputs are expected to be streamed.
   * If false, tool calls are considered complete once input is available.
   * @default true
   */
  toolCallsExpectOutput?: boolean;
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
  toolCallsExpectOutput = true,
}: StreamingMessageProps) {
  // Separate final text part from regular timeline
  const finalTextPart = finalTextPartId ? message.textParts?.find((part) => part.id === finalTextPartId) : undefined;

  // The timeline without the final text part, folded into chunks — once per
  // timeline, not per token, so settled tool groups skip re-rendering.
  const chunks = useMemo(
    () =>
      chunkTimeline((message.timeline ?? []).filter((item) => !(item.type === "text" && item.id === finalTextPartId))),
    [message.timeline, finalTextPartId],
  );

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

  const renderChunk = (chunk: TimelineChunk) => {
    if (chunk.type === "toolCalls") {
      return <StreamToolCallGroup key={chunk.key} toolCalls={chunk.toolCalls} expectsOutput={toolCallsExpectOutput} />;
    }
    const { item } = chunk;
    if (item.type === "text") {
      return <StreamTextPart key={chunk.key} part={item.data as StreamTextPartType} className={textPartClassName} />;
    }
    if (item.type === "reasoning") {
      return (
        <StreamReasoningPart
          key={chunk.key}
          part={item.data as StreamReasoningPartType}
          className={reasoningPartClassName}
        />
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-2">
      {message.error && <div className="text-xs text-destructive bg-destructive/10 rounded p-2">{message.error}</div>}

      {/* Render timeline items in order */}
      {chunks.map(renderChunk)}

      {message.usage && <TurnTokenUsage usage={message.usage} />}

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
