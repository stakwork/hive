"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface LearnChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  onInputChange?: (input: string) => void;
  onRefetchLearnings?: () => void;
}

export function LearnChatInput({ onSend, disabled = false, onInputChange, onRefetchLearnings }: LearnChatInputProps) {
  const [input, setInput] = useState("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      onInputChange?.(transcript);
    }
  }, [transcript, onInputChange]);

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

  const toggleListening = () => {
    if (isListening) {
      stopListening();
      onRefetchLearnings?.();
    } else {
      startListening();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 px-6 py-4 border-t bg-background" style={{ maxHeight: 70 }}>
      <Input
        placeholder={
          isListening ? "Listening..." : "Ask me anything about code, concepts, or skills you want to learn..."
        }
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        className="flex-1"
        autoFocus
        disabled={disabled}
      />
      {isSupported && (
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
      <Button type="submit" size="sm" disabled={!input.trim() || disabled} className="px-3">
        <Send className="w-4 h-4" />
      </Button>
    </form>
  );
}
