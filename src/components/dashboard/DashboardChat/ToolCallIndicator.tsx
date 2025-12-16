"use client";

import { motion } from "framer-motion";

interface ToolCall {
  id: string;
  toolName: string;
  status: string;
}

interface ToolCallIndicatorProps {
  toolCalls: ToolCall[];
}

export function ToolCallIndicator({ toolCalls }: ToolCallIndicatorProps) {
  // Don't show if no active tool calls
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex justify-center w-full"
    >
      <div className="pointer-events-auto max-w-[70vw] sm:max-w-[450px] md:max-w-[500px] lg:max-w-[600px] w-full">
        <div className="rounded-2xl px-4 py-3 shadow-sm backdrop-blur-sm bg-muted/10">
          <div className="flex items-center gap-2 text-foreground/60">
            <span className="text-sm">Researching</span>
            <div className="flex gap-1">
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
              >
                .
              </motion.span>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
              >
                .
              </motion.span>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
              >
                .
              </motion.span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
