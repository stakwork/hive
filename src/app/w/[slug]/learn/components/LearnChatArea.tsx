"use client";

import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { LearnChatMessage } from "./LearnChatMessage";
import { LearnChatInput } from "./LearnChatInput";
import type { LearnMessage } from "@/types/learn";

interface LearnChatAreaProps {
  messages: LearnMessage[];
  onSend: (message: string) => Promise<void>;
  isLoading?: boolean;
}

export function LearnChatArea({
  messages,
  onSend,
  isLoading = false,
}: LearnChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <motion.div
      className="flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Learning Assistant</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions, get explanations, and learn new concepts
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 bg-muted/40">
        {messages.map((message) => (
          <LearnChatMessage key={message.id} message={message} />
        ))}

        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-[85%] bg-muted rounded-2xl px-4 py-3 shadow-sm">
              <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Learning Assistant
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
                <div
                  className="w-1 h-1 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                ></div>
                <div
                  className="w-1 h-1 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                ></div>
                <span className="ml-2 text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <LearnChatInput onSend={onSend} disabled={isLoading} />
    </motion.div>
  );
}