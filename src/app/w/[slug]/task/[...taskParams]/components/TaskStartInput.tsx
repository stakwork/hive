"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ArrowUp, Mic, MicOff, Bot, Workflow, Beaker, Loader2 } from "lucide-react";
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

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case "live":
        return { icon: Workflow, label: "Workflow" };
      case "agent":
        return { icon: Bot, label: "Agent" };
      case "test":
        return { icon: Beaker, label: "Test" };
      default:
        return { icon: Workflow, label: "Workflow" };
    }
  };

  const modeConfig = getModeConfig(taskMode);
  const ModeIcon = modeConfig.icon;

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
        <div className="absolute bottom-6 left-8 z-10">
          <Select value={taskMode} onValueChange={onModeChange}>
            <SelectTrigger className="w-[140px] h-8 text-xs rounded-lg shadow-sm">
              <div className="flex items-center gap-2">
                <ModeIcon className="h-4 w-4" />
                <span>{modeConfig.label}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">
                <div className="flex items-center gap-2">
                  <Workflow className="h-3.5 w-3.5" />
                  <span>Workflow</span>
                </div>
              </SelectItem>
              <SelectItem value="agent">
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5" />
                  <span>Agent</span>
                </div>
              </SelectItem>
              {devMode && (
                <SelectItem value="test">
                  <div className="flex items-center gap-2">
                    <Beaker className="h-3.5 w-3.5" />
                    <span>Test</span>
                  </div>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
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
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
