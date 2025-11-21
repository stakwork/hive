"use client";

import React from "react";
import { motion } from "framer-motion";
import type { AgentStreamingMessage } from "@/types/agent";
import type { ChatMessage } from "@/lib/chat";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { StreamingMessage, StreamErrorBoundary } from "@/components/streaming";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { PullRequestArtifact } from "../artifacts/pull-request";
import { FINAL_ANSWER_ID } from "../lib/streaming-config";

interface AgentChatMessageProps {
  message: ChatMessage | AgentStreamingMessage;
}

// Type guard to check if message is AgentStreamingMessage
function isAgentStreamingMessage(msg: ChatMessage | AgentStreamingMessage): msg is AgentStreamingMessage {
  return "content" in msg && ("textParts" in msg || "toolCalls" in msg || "isStreaming" in msg);
}

export function AgentChatMessage({ message }: AgentChatMessageProps) {
  const isUser = message.role === "USER" || message.role === "user";

  // Get the text content - use 'content' for streaming messages, 'message' for ChatMessage
  const textContent = isAgentStreamingMessage(message) ? message.content : message.message;

  // Check if this is a streaming message (has streaming data)
  const isStreamingMessage =
    isAgentStreamingMessage(message) && !!(message.textParts || message.toolCalls || message.reasoningParts);

  // Check if we have any visible content (tool calls or text with actual content)
  const hasVisibleContent =
    isAgentStreamingMessage(message) &&
    ((message.toolCalls && message.toolCalls.length > 0) ||
      (message.textParts && message.textParts.some((part) => part.content.trim().length > 0)));

  // Show "Thinking..." ONLY if streaming but no visible content yet (no tool calls, no text)
  const showThinking = isAgentStreamingMessage(message) && message.isStreaming && !hasVisibleContent && !isUser;

  // Check if message is ChatMessage with artifacts
  const chatMessage = !isAgentStreamingMessage(message) ? (message as ChatMessage) : null;

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
            <MarkdownRenderer variant="user">{textContent}</MarkdownRenderer>
          ) : showThinking ? (
            <ThinkingIndicator />
          ) : isStreamingMessage ? (
            <StreamErrorBoundary>
              <StreamingMessage
                message={message as AgentStreamingMessage}
                finalTextPartId={FINAL_ANSWER_ID}
                toolCallsExpectOutput={false}
              />
            </StreamErrorBoundary>
          ) : (
            <MarkdownRenderer variant="assistant">{textContent}</MarkdownRenderer>
          )}
        </div>
      </div>

      {/* Render PULL_REQUEST artifacts */}
      {chatMessage?.artifacts
        ?.filter((a) => a.type === "PULL_REQUEST")
        .map((artifact) => (
          <div key={artifact.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div className="max-w-md w-full">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <PullRequestArtifact artifact={artifact} />
              </motion.div>
            </div>
          </div>
        ))}
    </motion.div>
  );
}
