"use client";

import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { BookOpen, MessageCircle } from "lucide-react";

interface ModeToggleProps {
  mode: "learn" | "chat";
  onModeChange: (mode: "learn" | "chat") => void;
  className?: string;
}

export function ModeToggle({ mode, onModeChange, className }: ModeToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 bg-background/80 border border-border shadow-md rounded-xl px-2 py-1",
        className
      )}
    >
      <Toggle
        pressed={mode === "learn"}
        onPressedChange={() => onModeChange("learn")}
        variant={mode === "learn" ? "outline" : "default"}
        size="lg"
        aria-label="Learn mode"
      >
        <BookOpen className="mr-1 w-4 h-4" />
        Learn
      </Toggle>
      <Toggle
        pressed={mode === "chat"}
        onPressedChange={() => onModeChange("chat")}
        variant={mode === "chat" ? "outline" : "default"}
        size="lg"
        aria-label="Chat mode"
      >
        <MessageCircle className="mr-1 w-4 h-4" />
        Chat
      </Toggle>
    </div>
  );
}
