"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
}

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
}: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow sending if we have either text or a pending debug attachment
    if ((!input.trim() && !pendingDebugAttachment) || isLoading || disabled) return;

    const message = input.trim();
    setInput("");
    await onSend(message);
  };

  return (
    <div>
      {/* Only show workflow status if it exists */}
      {workflowStatus && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <WorkflowStatusBadge status={workflowStatus} />
        </div>
      )}

      {/* Keep our debug attachment feature but add it to the master structure */}
      {pendingDebugAttachment && (
        <div className="px-6 pt-3">
          <InputDebugAttachment
            attachment={pendingDebugAttachment}
            onRemove={onRemoveDebugAttachment || (() => {})}
          />
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-6 py-4"
      >
        <Input
          placeholder={pendingDebugAttachment ? "Add context about the bug (optional)..." : "Type your message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          autoFocus
          disabled={disabled}
        />
        <Button type="submit" disabled={(!input.trim() && !pendingDebugAttachment) || isLoading || disabled}>
          {isLoading ? "Sending..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
