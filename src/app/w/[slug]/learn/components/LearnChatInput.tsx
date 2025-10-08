"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";

interface LearnChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  onInputChange?: (input: string) => void;
  onRefetchLearnings?: () => void;
  mode?: "learn" | "chat" | "mic";
}

export function LearnChatInput({
  onSend,
  disabled = false,
  onInputChange,
  onRefetchLearnings,
  mode = "learn",
}: LearnChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      onInputChange?.(transcript);
    }
  }, [transcript, onInputChange]);

  // Auto-start recording when in mic mode
  useEffect(() => {
    if (mode === "mic" && isSupported && !isListening) {
      startListening();
    } else if (mode !== "mic" && isListening) {
      stopListening();
    }
  }, [mode, isSupported, isListening, startListening, stopListening]);

  // Auto-scroll textarea to bottom when content changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [input]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      onRefetchLearnings?.();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening, onRefetchLearnings]);

  useControlKeyHold({
    onStart: startListening,
    onStop: useCallback(() => {
      stopListening();
      onRefetchLearnings?.();
    }, [stopListening, onRefetchLearnings]),
    enabled: isSupported && !disabled,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    setInput("");
    resetTranscript();
    await onSend(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isMicMode = mode === "mic";

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 px-6 py-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        placeholder={
          isMicMode
            ? "Recording transcript..."
            : isListening
              ? "Listening..."
              : "Ask me anything about code, concepts, or skills you want to learn..."
        }
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none min-h-[40px]"
        style={{
          maxHeight: "8em", // 5 lines * 1.5 line-height
          overflowY: "auto",
        }}
        autoFocus
        disabled={disabled || isMicMode}
        rows={1}
      />
      {isSupported && !isMicMode && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={isListening ? "default" : "outline"}
                onClick={toggleListening}
                disabled={disabled}
                className="px-3"
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isListening ? "Stop recording" : "Start voice input"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {!isMicMode && (
        <Button type="submit" size="sm" disabled={!input.trim() || disabled} className="px-3">
          <Send className="w-4 h-4" />
        </Button>
      )}
    </form>
  );
}
