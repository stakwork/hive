"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (s: string) => void;
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-row flex-wrap gap-1.5">
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
              "group inline-flex items-center gap-1 rounded-md cursor-pointer",
              "border border-primary/30 bg-primary/10 px-2.5 py-1",
              "text-xs font-medium text-primary",
              "transition-all duration-150",
              "hover:bg-primary/20 hover:border-primary/50",
            )}
          >
            <CornerDownLeft className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
            {suggestion}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
