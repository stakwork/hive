"use client";

import { GraphComponent } from "@/components/knowledge-graph";
import { StreamErrorBoundary, StreamingMessage } from "@/components/streaming";
import { StoreProvider } from "@/stores/StoreProvider";
import type { LearnMessage } from "@/types/learn";
import { motion } from "framer-motion";
import { BookOpen, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FINAL_ANSWER_ID } from "../lib/streaming-config";

interface LearnChatMessageProps {
  message: LearnMessage;
}

export function LearnChatMessage({ message }: LearnChatMessageProps) {
  const isUser = message.role === "user";

  // Check if this is a streaming message (Chat mode) or a regular message (Learn mode)
  const isStreamingMessage = !!(message.textParts || message.toolCalls || message.reasoningParts);
  const hasFinalAnswer = message.textParts?.some((part) => part.id === FINAL_ANSWER_ID);

  // Show graph for Learn mode (non-streaming, message is complete)
  // OR Chat mode when final answer exists
  const shouldShowGraph = !isUser && message.ref_id && (!isStreamingMessage || hasFinalAnswer);

  // Generate a unique store ID for each graph instance
  const storeId = `learn-chat-${message.id || message.ref_id}`;

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-3`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm overflow-hidden ${isUser ? "bg-primary text-primary-foreground ml-12" : "bg-muted mr-12"
            }`}
        >
          {!isUser && (
            <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Learning Assistant
            </div>
          )}
          {isUser && (
            <div className="font-medium text-sm text-primary-foreground/80 mb-1 flex items-center gap-2 justify-end">
              <span>You</span>
              <User className="w-4 h-4" />
            </div>
          )}
          <div className={`text-sm ${isUser ? "text-primary-foreground" : ""}`}>
            {isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : message.textParts || message.toolCalls || message.reasoningParts ? (
              <StreamErrorBoundary>
                <StreamingMessage message={message} finalTextPartId={FINAL_ANSWER_ID} />
              </StreamErrorBoundary>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&>*]:!text-foreground [&_*]:!text-foreground">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Show graph if ref_id is present and message is complete */}
      {shouldShowGraph && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="w-full"
        >
          <StoreProvider storeId={storeId}>
            <GraphComponent
              title="Related Knowledge"
              endpoint={`/graph/subgraph?include_properties=true&start_node=${message.ref_id}&depth=1&min_depth=0&limit=100&sort_by=date_added_to_graph&order_by=desc`}
              height="h-96"
              width="w-full"
            />
          </StoreProvider>
        </motion.div>
      )}
    </div>
  );
}
