"use client";

import { Pencil } from "lucide-react";
import React from "react";

interface TypingIndicatorProps {
  typingUsers: string[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0]} is typing…`
      : "Several people are typing…";

  return (
    <div className="flex items-center gap-1.5 px-4 py-1 md:px-6 text-xs text-muted-foreground animate-pulse">
      <Pencil className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
