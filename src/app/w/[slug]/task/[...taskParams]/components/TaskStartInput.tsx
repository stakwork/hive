"use client";

import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import { isDevelopmentMode } from "@/lib/runtime";

interface TaskStartInputProps {
  onStart: (task: string) => void;
  taskMode: string;
  onModeChange: (mode: string) => void;
  isLoading?: boolean;
}

export function TaskStartInput({ onStart, taskMode, onModeChange, isLoading = false }: TaskStartInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const devMode = isDevelopmentMode();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onStart(value.trim());
      }
    }
  };

  const hasText = value.trim().length > 0;

  const handleClick = () => {
    if (hasText) {
      onStart(value.trim());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        Build Something
      </h1>
      <Card className="relative w-full max-w-2xl p-0 bg-card rounded-3xl shadow-sm border-0 group">
        <Textarea
          ref={textareaRef}
          placeholder="Describe a task"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
          autoFocus
          data-testid="task-start-input"
        />
        <Button
          type="button"
          variant="default"
          size="icon"
          className="absolute bottom-6 right-8 z-10 rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ width: 32, height: 32 }}
          disabled={!hasText || isLoading}
          onClick={handleClick}
          tabIndex={0}
          data-testid="task-start-submit"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </Card>
      {devMode && (
        <div className="flex justify-center mt-6">
          <fieldset className="flex gap-6 items-center bg-muted rounded-xl px-4 py-2">
            <legend className="sr-only">Mode</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="live"
                style={{
                  accentColor: "var(--color-green-500)",
                }}
                checked={taskMode === "live"}
                onChange={() => onModeChange("live")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Live</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="test"
                style={{
                  accentColor: "var(--color-green-500)",
                }}
                checked={taskMode === "test"}
                onChange={() => onModeChange("test")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Artifact Test</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="agent"
                style={{
                  accentColor: "var(--color-green-500)",
                }}
                checked={taskMode === "agent"}
                onChange={() => onModeChange("agent")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Agent</span>
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
