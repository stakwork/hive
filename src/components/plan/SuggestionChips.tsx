"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (s: string) => void;
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-row flex-wrap gap-2 px-4 pb-2">
      <AnimatePresence>
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={suggestion}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15, delay: index * 0.04 }}
            onClick={() => onSelect(suggestion)}
            className={cn(
              "rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground cursor-pointer",
              "transition-all duration-150",
              "hover:bg-accent/80 hover:scale-[1.03]",
              "active:scale-100",
            )}
          >
            {suggestion}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
