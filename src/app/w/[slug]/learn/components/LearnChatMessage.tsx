"use client";

import { motion } from "framer-motion";
import { BookOpen, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { LearnMessage } from "@/types/learn";

interface LearnChatMessageProps {
  message: LearnMessage;
}

export function LearnChatMessage({ message }: LearnChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
        isUser
          ? "bg-primary text-primary-foreground ml-12"
          : "bg-muted mr-12"
      }`}>
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
        <div
          className={`text-sm ${isUser ? "text-primary-foreground" : ""}`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&>*]:!text-foreground [&_*]:!text-foreground">
              <ReactMarkdown>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}