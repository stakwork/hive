import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";

interface Props {
  isStreaming: boolean;
  userScrolledUp: boolean;
  showBackButton: boolean;
  onStreamingClick: () => void;
  onLatestClick: () => void;
  onBackClick: () => void;
}

export function StreamScrollIndicator({
  isStreaming,
  userScrolledUp,
  showBackButton,
  onStreamingClick,
  onLatestClick,
  onBackClick,
}: Props) {
  const show = userScrolledUp || showBackButton;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="scroll-indicator"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-auto absolute bottom-3 right-3 z-10"
        >
          {showBackButton ? (
            <button
              onClick={onBackClick}
              className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm hover:border-border hover:text-foreground transition-all"
            >
              <ArrowUp className="w-3 h-3" />
              Back
            </button>
          ) : isStreaming ? (
            <button
              onClick={onStreamingClick}
              className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm hover:border-border hover:text-foreground transition-all"
            >
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              />
              Streaming…
              <ArrowDown className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={onLatestClick}
              className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm hover:border-border hover:text-foreground transition-all"
            >
              Latest response…
              <ArrowDown className="w-3 h-3" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
