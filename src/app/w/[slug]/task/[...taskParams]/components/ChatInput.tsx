"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff } from "lucide-react";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface ChatInputProps {
  logs: LogEntry[];
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
}

export function ChatInput({
  logs,
  onSend,
  disabled = false,
  isLoading = false,
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
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

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening]);

  useEffect(() => {
    if (!isSupported || disabled) return;

    let holdTimer: NodeJS.Timeout | null = null;
    const HOLD_DURATION = 500; // ms

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" && !e.repeat) {
        holdTimer = setTimeout(() => {
          if (!isListening) {
            startListening();
          }
        }, HOLD_DURATION);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (isListening) {
          stopListening();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [isSupported, disabled, isListening, startListening, stopListening]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow sending if we have either text or a pending debug attachment
    if ((!input.trim() && !pendingDebugAttachment) || isLoading || disabled)
      return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    setInput("");
    resetTranscript();
    await onSend(message);
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{mode}</span>
        <span>|</span>
        <WorkflowStatusBadge logs={logs} status={workflowStatus} />
      </div>

      {/* Debug attachment display */}
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
        className="flex gap-2 px-6 py-4 border-t bg-background sticky bottom-0 z-10"
      >
        <Input
          placeholder={isListening ? "Listening..." : "Type your message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          autoFocus
          disabled={disabled}
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
          disabled={
            (!input.trim() && !pendingDebugAttachment) || isLoading || disabled
          }
          data-testid="chat-message-submit"
        >
          {isLoading ? "Sending..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
