"use client";

import React from "react";
import { motion } from "framer-motion";
import type { AgentStreamingMessage } from "@/types/agent";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { StreamingMessage, StreamErrorBoundary } from "@/components/streaming";
import { FINAL_ANSWER_ID } from "../lib/streaming-config";

interface AgentChatMessageProps {
  message: AgentStreamingMessage;
}

export function AgentChatMessage({ message }: AgentChatMessageProps) {
  const isUser = message.role === "user";

  // Check if this is a streaming message (has streaming data)
  const isStreamingMessage = !!(message.textParts || message.toolCalls || message.reasoningParts);

  // Check if we have any visible content (tool calls or text with actual content)
  const hasVisibleContent =
    (message.toolCalls && message.toolCalls.length > 0) ||
    (message.textParts && message.textParts.some(part => part.content.trim().length > 0));

  // Show "Thinking..." ONLY if streaming but no visible content yet (no tool calls, no text)
  const showThinking = message.isStreaming && !hasVisibleContent && !isUser;

  return (
    <motion.div
      key={message.id}
      className="space-y-3 relative"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className={`flex items-end gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`px-4 py-1 rounded-md max-w-full shadow-sm relative ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-background text-foreground rounded-bl-md border"
          }`}
        >
          {isUser ? (
            <MarkdownRenderer variant="user">{message.content}</MarkdownRenderer>
          ) : showThinking ? (
            <div className="text-sm text-muted-foreground italic flex items-center gap-2">
              <div className="flex space-x-1">
                <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
                <div
                  className="w-1 h-1 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                ></div>
                <div
                  className="w-1 h-1 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                ></div>
              </div>
              <span>Thinking...</span>
            </div>
          ) : isStreamingMessage ? (
            <StreamErrorBoundary>
              <StreamingMessage
                message={message}
                finalTextPartId={FINAL_ANSWER_ID}
                toolCallsExpectOutput={false}
              />
            </StreamErrorBoundary>
          ) : (
            <MarkdownRenderer variant="assistant">{message.content}</MarkdownRenderer>
          )}
        </div>
      </div>
    </motion.div>
  );
}
