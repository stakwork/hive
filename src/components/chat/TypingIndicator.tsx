"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pencil } from "lucide-react";

interface TypingIndicatorProps {
  typingUsers: string[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  const hasTypingUsers = typingUsers.length > 0;
  const label =
    typingUsers.length === 1
      ? `${typingUsers[0]} is typing…`
      : "Several people are typing…";

  return (
    <AnimatePresence initial={false}>
      {hasTypingUsers && (
        <motion.div
          key="typing-indicator"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-1.5 px-4 py-1 md:px-6 text-xs text-muted-foreground animate-pulse">
            <Pencil className="h-3 w-3 shrink-0" />
            <span>{label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
