"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowUp, Mic, MicOff, Loader2 } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";

interface PlanStartInputProps {
  onSubmit: (message: string) => void;
  isLoading?: boolean;
}

export function PlanStartInput({ onSubmit, isLoading = false }: PlanStartInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (transcript) {
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

  const hasText = value.trim().length > 0;

  const handleSubmit = () => {
    if (hasText) {
      if (isListening) {
        stopListening();
      }
      resetTranscript();
      onSubmit(value.trim());
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const title = "What job are you trying to solve?";

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {title}
          </motion.span>
        </AnimatePresence>
      </h1>
      <div className="w-full max-w-2xl">
        <Card className="relative w-full p-0 bg-card rounded-3xl shadow-sm border-0 group">
          <motion.div
            key="plan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <Textarea
              ref={textareaRef}
              placeholder={isListening ? "Listening..." : "Describe a feature or problem"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
              autoFocus
              data-testid="plan-start-input"
            />
          </motion.div>
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
              onClick={handleSubmit}
              tabIndex={0}
              data-testid="plan-start-submit"
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
    </div>
  );
}
