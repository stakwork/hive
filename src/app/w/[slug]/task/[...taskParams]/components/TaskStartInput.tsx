"use client";

import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";

interface TaskStartInputProps {
  onStart: (task: string) => void;
  onModeChange: (mode: string) => void;
}

export function TaskStartInput({ onStart, onModeChange }: TaskStartInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"live" | "test" | "unit">("test");

  useEffect(() => {
    const savedMode = localStorage.getItem("task_mode") as "live" | "test" | "unit";
    if (savedMode && ["live", "test", "unit"].includes(savedMode)) {
      setMode(savedMode);
    } else {
      setMode("test");
    }
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mode === "unit") {
        onStart("Find functions that need unit tests and suggest test implementations");
      } else if (value.trim()) {
        onStart(value.trim());
      }
    }
  };

  const hasText = value.trim().length > 0;

  const handleClick = () => {
    if (mode === "unit") {
      onStart("Find functions that need unit tests and suggest test implementations");
    } else if (hasText) {
      onStart(value.trim());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        What do you want to do?
      </h1>
      <Card className="relative w-full max-w-2xl p-0 bg-card rounded-3xl shadow-sm border-0 group">
        {mode === "unit" ? (
          <div className="px-8 pt-8 pb-16 min-h-[180px] flex flex-col items-center justify-center text-center">
            <h3 className="text-lg font-medium text-foreground mb-2">
              Find Functions to Test
            </h3>
            <p className="text-muted-foreground mb-6">
              I'll scan your codebase and recommend functions that would benefit from unit tests
            </p>
            <Button
              type="button"
              variant="default"
              size="default"
              className="rounded-full px-6"
              onClick={handleClick}
              tabIndex={0}
            >
              Scan for Testable Functions
            </Button>
          </div>
        ) : (
          <>
            <Textarea
              ref={textareaRef}
              placeholder="Describe a task"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
              autoFocus
            />
            <Button
              type="button"
              variant="default"
              size="icon"
              className="absolute bottom-6 right-8 z-10 rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
              style={{ width: 32, height: 32 }}
              disabled={!hasText}
              onClick={handleClick}
              tabIndex={0}
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
          </>
        )}
      </Card>
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
              checked={mode === "live"}
              onChange={() => {
                setMode("live");
                if (typeof window !== "undefined") {
                  localStorage.setItem("task_mode", "live");
                  onModeChange("live");
                }
              }}
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
              checked={mode === "test"}
              onChange={() => {
                setMode("test");
                if (typeof window !== "undefined") {
                  localStorage.setItem("task_mode", "test");
                  onModeChange("test");
                }
              }}
              className="accent-primary"
            />
            <span className="text-sm text-foreground">Test</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="unit"
              style={{
                accentColor: "var(--color-green-500)",
              }}
              checked={mode === "unit"}
              onChange={() => {
                setMode("unit");
                if (typeof window !== "undefined") {
                  localStorage.setItem("task_mode", "unit");
                  onModeChange("unit");
                }
              }}
              className="accent-primary"
            />
            <span className="text-sm text-foreground">Unit Tests</span>
          </label>
        </fieldset>
      </div>
    </div>
  );
}
