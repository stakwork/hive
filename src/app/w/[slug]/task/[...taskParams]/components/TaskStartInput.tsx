"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowUp, Mic, MicOff } from "lucide-react";
import { isDevelopmentMode } from "@/lib/runtime";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";

interface TaskStartInputProps {
  onStart: (task: string) => void;
  taskMode: string;
  onModeChange: (mode: string) => void;
  isLoading?: boolean;
}

export function TaskStartInput({ onStart, taskMode, onModeChange, isLoading = false }: TaskStartInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();
  
  const devMode = isDevelopmentMode();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (transcript) {
      // Append transcript to the initial value
      const newValue = initialValueRef.current 
        ? `${initialValueRef.current} ${transcript}`.trim()
        : transcript;
      setValue(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      // Store the current value when starting to listen
      initialValueRef.current = value;
      startListening();
    }
  }, [isListening, stopListening, startListening, value]);

  const handleStartListening = useCallback(() => {
    initialValueRef.current = value;
    startListening();
  }, [value, startListening]);

  useControlKeyHold({
    onStart: handleStartListening,
    onStop: stopListening,
    enabled: isSupported && !isLoading,
  });

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
      if (isListening) {
        stopListening();
      }
      resetTranscript();
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
          placeholder={isListening ? "Listening..." : "Describe a task"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
          autoFocus
          data-testid="task-start-input"
        />
        <div className="absolute bottom-6 right-8 z-10 flex gap-2">
          {isSupported && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isListening ? "default" : "outline"}
                    size="icon"
                    className="rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
                    style={{ width: 32, height: 32 }}
                    onClick={toggleListening}
                    disabled={isLoading}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isListening ? "Stop recording" : "Start voice input (or hold Ctrl)"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            type="button"
            variant="default"
            size="icon"
            className="rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ width: 32, height: 32 }}
            disabled={!hasText || isLoading}
            onClick={handleClick}
            tabIndex={0}
            data-testid="task-start-submit"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        </div>
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
              checked={taskMode === "live"}
              onChange={() => onModeChange("live")}
              className="accent-primary"
            />
            <span className="text-sm text-foreground">Live</span>
          </label>
          {devMode && (
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
          )}
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
    </div>
  );
}
