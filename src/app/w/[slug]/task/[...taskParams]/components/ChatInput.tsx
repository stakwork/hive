"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff, Bot, Workflow, ArrowUp, AlertTriangle, Plus, ImageIcon, X } from "lucide-react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { InputStepAttachment } from "@/components/InputStepAttachment";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { useChatImageUpload } from "@/hooks/useChatImageUpload";

interface UploadedImage {
  file: File;
  s3Path: string;
}

interface ChatInputProps {
  logs: LogEntry[];
  onSend: (message: string, attachments?: UploadedImage[]) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  pendingStepAttachment?: WorkflowTransition | null;
  onRemoveStepAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  hasPrArtifact?: boolean;
  workspaceSlug?: string;
  taskMode?: string;
  taskId?: string;
  onOpenBountyRequest?: () => void;
}

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  pendingStepAttachment = null,
  onRemoveStepAttachment,
  workflowStatus,
  hasPrArtifact = false,
  workspaceSlug,
  taskMode,
  taskId,
  onOpenBountyRequest,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Image upload hook - only enabled if taskId is provided
  const imageUpload = taskId ? useChatImageUpload({
    taskId,
    onImageAdded: (file, s3Path) => {
      setUploadedImages(prev => [...prev, { file, s3Path }]);
    },
    onError: (error) => {
      console.error('Image upload error:', error);
    },
  }) : null;

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
    // Allow sending if we have either text, uploaded images, or a pending attachment (debug or step)
    if ((!input.trim() && uploadedImages.length === 0 && !pendingDebugAttachment && !pendingStepAttachment) || isLoading || disabled)
      return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    const imagesToSend = [...uploadedImages];
    setInput("");
    setUploadedImages([]);
    resetTranscript();
    await onSend(message, imagesToSend);
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
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
  const isTerminalState = workflowStatus === WorkflowStatus.HALTED ||
    workflowStatus === WorkflowStatus.FAILED ||
    workflowStatus === WorkflowStatus.ERROR;

  const getTerminalMessage = () => {
    if (taskMode === "agent") {
      return "Session expired.";
    }
    switch (workflowStatus) {
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
    return (
      <div className={cn(
        "px-4 py-4 border-t bg-background",
        isMobile && "fixed bottom-0 left-0 right-0 z-10 pb-[env(safe-area-inset-bottom)]"
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
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
        {!hasPrArtifact && workflowStatus !== WorkflowStatus.COMPLETED && (
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

      {/* Step attachment display */}
      {pendingStepAttachment && (
        <div className="px-6 pt-3">
          <InputStepAttachment
            step={pendingStepAttachment}
            onRemove={onRemoveStepAttachment || (() => {})}
          />
        </div>
      )}

      {/* Uploaded images preview */}
      {uploadedImages.length > 0 && (
        <div className="px-4 md:px-6 pt-2 flex flex-wrap gap-2">
          {uploadedImages.map((img, index) => (
            <div key={index} className="relative group">
              <div className="w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <button
                type="button"
                onClick={() => handleRemoveImage(index)}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 truncate rounded-b-lg">
                {img.file.name}
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-2 px-4 py-3 md:px-6 md:py-4 border-t bg-background relative",
          !isMobile && "sticky bottom-0 z-10"
        )}
      >
        {/* Drag overlay */}
        {imageUpload?.isDragging && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-20 pointer-events-none">
            <div className="text-center">
              <ImageIcon className="h-12 w-12 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium text-primary">Drop image here</p>
            </div>
          </div>
        )}

        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            placeholder={
              imageUpload?.isUploading 
                ? "Uploading image..." 
                : isListening 
                ? "Listening..." 
                : "Type your message..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onDragEnter={imageUpload?.handleDragEnter}
            onDragLeave={imageUpload?.handleDragLeave}
            onDragOver={imageUpload?.handleDragOver}
            onDrop={imageUpload?.handleDrop}
            onPaste={imageUpload?.handlePaste}
            className={cn(
              "flex-1 resize-none min-h-[56px] md:min-h-[40px]",
              imageUpload?.isDragging && "border-primary border-2"
            )}
            style={{
              maxHeight: "8em", // About 5 lines
              overflowY: "auto",
            }}
            autoFocus
            disabled={disabled || imageUpload?.isUploading}
            rows={1}
            data-testid="chat-message-input"
          />
        </div>
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
              (!input.trim() && uploadedImages.length === 0 && !pendingDebugAttachment && !pendingStepAttachment) || 
              isLoading || 
              disabled || 
              imageUpload?.isUploading
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

      {/* Bounty request link */}
      {onOpenBountyRequest && (
        <div className="flex justify-end px-4 pb-2 md:px-6">
          <button
            type="button"
            onClick={onOpenBountyRequest}
            className="text-xs"
          >
            <span className="text-muted-foreground">Stuck? </span>
            <span className="text-blue-600 hover:underline">Post a bounty</span>
          </button>
        </div>
      )}
    </div>
  );
}
