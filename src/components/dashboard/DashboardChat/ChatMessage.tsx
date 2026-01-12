"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    imageData?: string;
  };
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === "user";

  // Don't show message if there's no content (for both user and assistant)
  if (!message.content.trim()) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-center w-full"
    >
      <div
        className={`pointer-events-auto max-w-[70vw] sm:max-w-[450px] md:max-w-[500px] lg:max-w-[600px] ${
          isUser ? "" : "w-full"
        }`}
      >
        <div
          className={`rounded-2xl px-4 py-3 shadow-sm backdrop-blur-sm ${
            isUser ? "bg-white/90 dark:bg-white/10 text-gray-900 dark:text-white inline-block" : "bg-muted/10"
          }`}
        >
          {isStreaming ? (
            <div
              className={`text-sm whitespace-pre-wrap ${
                isUser ? "text-gray-900 dark:text-white" : "text-foreground/90"
              }`}
            >
              {message.content}
            </div>
          ) : (
            <div
              className={`prose prose-sm max-w-none prose-gray ${
                isUser
                  ? "dark:prose-invert [&>*]:!text-gray-900 dark:[&>*]:!text-white [&_*]:!text-gray-900 dark:[&_*]:!text-white"
                  : "dark:prose-invert [&>*]:!text-foreground/90 [&_*]:!text-foreground/90"
              }`}
            >
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
