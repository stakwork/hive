"use client";

import React, { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

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

  // Auto-scroll textarea to bottom when content changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [input]);

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
      />
      <Button type="submit" size="sm" disabled={!input.trim() || disabled} className="px-3">
        <Send className="w-4 h-4" />
      </Button>
    </form>
  );
}
