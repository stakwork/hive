"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  workflowStatus?: WorkflowStatus | null;
}

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  workflowStatus,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");

  useEffect(() => {
    const mode = localStorage.getItem("task_mode");
    setMode(mode || "live");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || disabled) return;

    const message = input.trim();
    setInput("");
    await onSend(message);
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{mode}</span>
        <span>|</span>
        <WorkflowStatusBadge status={workflowStatus} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-6 py-4 border-t bg-background sticky bottom-0 z-10"
      >
        <Input
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          autoFocus
          disabled={disabled}
        />
        <Button type="submit" disabled={!input.trim() || isLoading || disabled}>
          {isLoading ? "Sending..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
