"use client";

import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { BookOpen, MessageCircle, Mic } from "lucide-react";

interface ModeToggleProps {
  mode: "learn" | "chat" | "mic";
  onModeChange: (mode: "learn" | "chat" | "mic") => void;
  className?: string;
  showMicMode?: boolean;
}

export function ModeToggle({ mode, onModeChange, className, showMicMode = false }: ModeToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 bg-background/80 border border-border shadow-md rounded-xl px-2 py-1",
        className,
      )}
    >
      <Toggle
        pressed={mode === "chat"}
        onPressedChange={() => onModeChange("chat")}
        variant={mode === "chat" ? "outline" : "default"}
        size="lg"
        aria-label="Chat mode"
        className={cn(mode === "chat" ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")}
      >
        <MessageCircle className={cn("mr-1 w-4 h-4", mode === "chat" ? "text-foreground" : "text-muted-foreground")} />
        Chat
      </Toggle>
      <Toggle
        pressed={mode === "learn"}
        onPressedChange={() => onModeChange("learn")}
        variant={mode === "learn" ? "outline" : "default"}
        size="lg"
        aria-label="Learn mode"
        className={cn(mode === "learn" ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")}
      >
        <BookOpen className={cn("mr-1 w-4 h-4", mode === "learn" ? "text-foreground" : "text-muted-foreground")} />
        Learn
      </Toggle>
      {showMicMode && (
        <Toggle
          pressed={mode === "mic"}
          onPressedChange={() => onModeChange("mic")}
          variant={mode === "mic" ? "outline" : "default"}
          size="lg"
          aria-label="Mic mode"
          className={cn(mode === "mic" ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")}
        >
          <Mic className={cn("mr-1 w-4 h-4", mode === "mic" ? "text-foreground" : "text-muted-foreground")} />
          Mic
        </Toggle>
      )}
    </div>
  );
}
