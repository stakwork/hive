"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  };
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  // Only render assistant messages
  if (message.role === "user") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-center w-full"
    >
      <div className="max-w-[600px] w-full">
        <div className="bg-muted/40 rounded-2xl px-4 py-3 shadow-sm backdrop-blur-sm">
          {isStreaming ? (
            <div className="text-sm text-foreground/90 whitespace-pre-wrap">
              {message.content}
            </div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&>*]:!text-foreground/90 [&_*]:!text-foreground/90">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
