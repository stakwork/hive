"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff, Bot, Workflow, ArrowUp, AlertTriangle, Plus, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
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
  workspaceSlug?: string;
  taskMode?: string;
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
  workspaceSlug,
  taskMode,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // On mobile, return key adds line breaks (user taps send button to submit)
    // On desktop, Enter submits, Shift+Enter for new lines
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSubmit(e);
    }
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

  // Show simplified ended state for terminal workflow statuses
  const isTerminalState = workflowStatus === WorkflowStatus.COMPLETED ||
    workflowStatus === WorkflowStatus.HALTED ||
    workflowStatus === WorkflowStatus.FAILED ||
    workflowStatus === WorkflowStatus.ERROR;

  const getTerminalMessage = () => {
    if (taskMode === "agent") {
      return "Session ended.";
    }
    switch (workflowStatus) {
      case WorkflowStatus.COMPLETED:
        return "Workflow completed.";
      case WorkflowStatus.HALTED:
        return "Workflow halted.";
      case WorkflowStatus.FAILED:
        return "Workflow failed.";
      case WorkflowStatus.ERROR:
        return "Workflow error.";
      default:
        return "Workflow ended.";
    }
  };

  if (isTerminalState) {
    const isCompleted = workflowStatus === WorkflowStatus.COMPLETED;
    const StatusIcon = isCompleted ? CheckCircle2 : AlertTriangle;
    const iconColor = isCompleted ? "text-green-500" : "text-amber-500";

    return (
      <div className={cn(
        "px-4 py-4 border-t bg-background",
        isMobile && "fixed bottom-0 left-0 right-0 z-10 pb-[env(safe-area-inset-bottom)]"
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusIcon className={cn("h-4 w-4 flex-shrink-0", iconColor)} />
            <span>{getTerminalMessage()}</span>
          </div>
          {workspaceSlug && (
            <Button asChild size="sm">
              <Link href={`/w/${workspaceSlug}/task/new`}>
                <Plus className="h-3 w-3 mr-1" />
                New Task
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      isMobile && "fixed bottom-0 left-0 right-0 z-10 bg-background border-t pt-2 pb-[env(safe-area-inset-bottom)]"
    )}>
      <div className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        isMobile && "px-4"
      )}>
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
          <InputDebugAttachment
            attachment={pendingDebugAttachment}
            onRemove={onRemoveDebugAttachment || (() => {})}
          />
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-2 px-4 py-3 md:px-6 md:py-4 border-t bg-background",
          !isMobile && "sticky bottom-0 z-10"
        )}
      >
        <Textarea
          ref={textareaRef}
          placeholder={isListening ? "Listening..." : "Type your message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none min-h-[56px] md:min-h-[40px]"
          style={{
            maxHeight: "8em", // About 5 lines
            overflowY: "auto",
          }}
          autoFocus
          disabled={disabled}
          rows={1}
          data-testid="chat-message-input"
        />
        <div className="flex gap-2 shrink-0">
          {isSupported && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={isListening ? "default" : "outline"}
                    onClick={toggleListening}
                    disabled={disabled}
                    className="h-11 w-11 rounded-full shrink-0"
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
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
            size={isMobile ? "icon" : "default"}
            disabled={
              (!input.trim() && !pendingDebugAttachment) || isLoading || disabled
            }
            className={isMobile ? "h-11 w-11 rounded-full shrink-0" : ""}
            data-testid="chat-message-submit"
          >
            {isMobile ? (
              <ArrowUp className="w-5 h-5" />
            ) : (
              isLoading ? "Sending..." : "Send"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
