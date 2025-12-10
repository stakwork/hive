"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { X } from "lucide-react";

interface ChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    imageData?: string;
  };
  isStreaming?: boolean;
  onDelete?: (messageId: string) => void;
}

export function ChatMessage({ message, isStreaming = false, onDelete }: ChatMessageProps) {
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
      <div className="max-w-[70vw] sm:max-w-[450px] md:max-w-[500px] lg:max-w-[600px] w-full pointer-events-auto">
        <div className="bg-muted/10 rounded-2xl px-4 py-3 pr-10 shadow-sm backdrop-blur-sm relative group">
          {isStreaming ? (
            <div className="text-sm text-foreground/90 whitespace-pre-wrap">
              {message.content}
            </div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&>*]:!text-foreground/90 [&_*]:!text-foreground/90">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
          {/* Delete button */}
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="absolute top-2 right-2 p-1 rounded-full opacity-30 hover:opacity-90 transition-opacity"
              aria-label="Delete message"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
