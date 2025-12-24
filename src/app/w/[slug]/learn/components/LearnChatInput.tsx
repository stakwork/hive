"use client";

import React, { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface LearnChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  workspaceSlug?: string;
}

export function LearnChatInput({
  onSend,
  disabled = false,
}: LearnChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } = useSpeechRecognition();

  // Auto-scroll textarea to bottom when content changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [input]);

  // Update input with transcript from speech recognition
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const message = input.trim();
    setInput("");
    resetTranscript();
    await onSend(message);

    // Keep focus on input after sending
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      startListening();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 px-6 py-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        placeholder="Ask me anything about code, concepts, or skills you want to learn..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none min-h-[40px]"
        style={{
          maxHeight: "8em", // 5 lines * 1.5 line-height
          overflowY: "auto",
        }}
        autoFocus
        disabled={disabled}
        rows={1}
        data-testid="learn-message-input"
      />
      {isSupported && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={isListening ? "default" : "outline"}
                onClick={toggleVoiceInput}
                disabled={disabled}
                className={`px-3 ${isListening ? "bg-red-500 hover:bg-red-600 animate-pulse" : ""}`}
                data-testid="learn-voice-input"
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
      <Button type="submit" size="sm" disabled={!input.trim() || disabled} className="px-3" data-testid="learn-message-send">
        <Send className="w-4 h-4" />
      </Button>
    </form>
  );
}
