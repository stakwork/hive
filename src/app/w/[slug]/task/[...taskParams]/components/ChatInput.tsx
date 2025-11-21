"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff, Bot, Workflow } from "lucide-react";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";

interface ChatInputProps {
  logs: LogEntry[];
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  hasPrArtifact?: boolean;
}

export function ChatInput({
  logs,
  onSend,
  disabled = false,
  isLoading = false,
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
  hasPrArtifact = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  useEffect(() => {
    const mode = localStorage.getItem("task_mode");
    setMode(mode || "live");
  }, []);

  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  // Auto-scroll textarea to bottom when content changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [input]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening]);

  useControlKeyHold({
    onStart: startListening,
    onStop: stopListening,
    enabled: isSupported && !disabled,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow sending if we have either text or a pending debug attachment
    if ((!input.trim() && !pendingDebugAttachment) || isLoading || disabled) return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    setInput("");
    resetTranscript();
    await onSend(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow Shift+Enter for new lines, Enter alone submits
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    // Shift+Enter will naturally insert a new line (no preventDefault)
  };

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case "live":
        return { icon: Workflow, label: "Workflow" };
      case "agent":
        return { icon: Bot, label: "Agent" };
      default:
        return { icon: Workflow, label: "Workflow" };
    }
  };

  const modeConfig = getModeConfig(mode);
  const ModeIcon = modeConfig.icon;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ModeIcon className="h-4 w-4" />
        <span>{modeConfig.label}</span>
        {!hasPrArtifact && (
          <>
            <span>|</span>
            <WorkflowStatusBadge status={workflowStatus} />
          </>
        )}
      </div>

      {/* Debug attachment display */}
      {pendingDebugAttachment && (
        <div className="px-6 pt-3">
          <InputDebugAttachment attachment={pendingDebugAttachment} onRemove={onRemoveDebugAttachment || (() => {})} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 px-6 py-4 border-t bg-background sticky bottom-0 z-10">
        <Textarea
          ref={textareaRef}
          placeholder={isListening ? "Listening..." : "Type your message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none min-h-[40px]"
          style={{
            maxHeight: "8em", // About 5 lines
            overflowY: "auto",
          }}
          autoFocus
          disabled={disabled}
          rows={1}
          data-testid="chat-message-input"
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
        <Button
          type="submit"
          disabled={(!input.trim() && !pendingDebugAttachment) || isLoading || disabled}
          data-testid="chat-message-submit"
        >
          {isLoading ? "Sending..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
