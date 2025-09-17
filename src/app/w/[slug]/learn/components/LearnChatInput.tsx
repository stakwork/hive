"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface LearnChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  onInputChange?: (input: string) => void;
}

export function LearnChatInput({ onSend, disabled = false, onInputChange }: LearnChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const message = input.trim();
    setInput("");
    await onSend(message);
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
        placeholder="Ask me anything about code, concepts, or skills you want to learn..."
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
      <Button type="submit" size="sm" disabled={!input.trim() || disabled} className="px-3">
        <Send className="w-4 h-4" />
      </Button>
    </form>
  );
}
