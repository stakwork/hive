"use client";

import { LearnMessage } from "@/types/learn";
import { StreamTextPart } from "./StreamTextPart";
import { StreamToolCall } from "./StreamToolCall";
import { StreamReasoningPart } from "./StreamReasoningPart";

interface StreamingMessageProps {
  message: LearnMessage;
}

export function StreamingMessage({ message }: StreamingMessageProps) {
  // Separate final answer from other text parts
  const regularTextParts = message.textParts?.filter(part => part.id !== "final-answer") || [];
  const finalAnswerPart = message.textParts?.find(part => part.id === "final-answer");

  return (
    <div className="flex flex-col gap-3">
      {message.error && (
        <div className="rounded-lg p-3 border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">❌</span>
            <div className="font-semibold text-sm text-red-700 dark:text-red-300">Error</div>
          </div>
          <div className="text-xs text-red-600 dark:text-red-400">{message.error}</div>
        </div>
      )}
      {message.reasoningParts?.map((part) => (
        <StreamReasoningPart key={part.id} part={part} />
      ))}
      {regularTextParts.map((part) => (
        <StreamTextPart key={part.id} part={part} />
      ))}
      {message.toolCalls?.map((toolCall) => (
        <StreamToolCall key={toolCall.id} toolCall={toolCall} />
      ))}
      {finalAnswerPart && (
        <StreamTextPart key={finalAnswerPart.id} part={finalAnswerPart} />
      )}
    </div>
  );
}
