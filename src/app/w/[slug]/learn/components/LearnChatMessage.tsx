"use client";

import { motion } from "framer-motion";
import { BookOpen, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { LearnMessage } from "@/types/learn";
import { StreamingMessage, StreamErrorBoundary } from "@/components/streaming";
import { FINAL_ANSWER_ID } from "../lib/streaming-config";
import { Graph } from "@/components/graph";

interface LearnChatMessageProps {
  message: LearnMessage;
  workspaceSlug?: string;
}

export function LearnChatMessage({ message, workspaceSlug }: LearnChatMessageProps) {
  const isUser = message.role === "user";

  // Check if final answer is present (for smoother UX)
  const hasFinalAnswer = message.textParts?.some((part) => part.id === FINAL_ANSWER_ID);

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-3`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm overflow-hidden ${
            isUser ? "bg-primary text-primary-foreground ml-12" : "bg-muted mr-12"
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

      {/* Show graph if ref_id is present, final answer exists, and it's an assistant message */}
      {!isUser && message.ref_id && hasFinalAnswer && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="max-w-[85%] mr-12"
        >
          <Graph
            endpoint="/api/subgraph"
            params={{
              ref_id: message.ref_id,
              workspace: workspaceSlug || "",
            }}
            height={400}
            title="Related Knowledge"
            showStats={true}
            emptyMessage="No related knowledge graph available"
          />
        </motion.div>
      )}
    </div>
  );
}
