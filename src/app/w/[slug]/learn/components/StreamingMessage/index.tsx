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
    <div className="flex flex-col gap-2">
      {message.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
          {message.error}
        </div>
      )}
      {message.reasoningParts?.map((part) => (
        <StreamReasoningPart key={part.id} part={part} />
      ))}
      {regularTextParts.map((part) => (
        <StreamTextPart key={part.id} part={part} />
      ))}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="bg-muted/50 border border-border/50 rounded-lg p-2 my-1">
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls.map((toolCall) => (
              <StreamToolCall key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        </div>
      )}
      {finalAnswerPart ? (
        <StreamTextPart key={finalAnswerPart.id} part={finalAnswerPart} />
      ) : message.isStreaming && (
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
