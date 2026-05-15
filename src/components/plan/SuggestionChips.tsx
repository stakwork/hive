"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";

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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15, delay: index * 0.05 }}
            onClick={() => onSelect(suggestion)}
            className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-500/20 transition-all cursor-pointer"
          >
            {suggestion}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
