"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff, Bot, Workflow, ArrowUp, AlertTriangle, Plus, Image as ImageIcon, X, Loader2, RefreshCw, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { InputStepAttachment } from "@/components/InputStepAttachment";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { toast } from "sonner";

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  s3Path?: string;
  uploading: boolean;
  error?: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: Array<{path: string, filename: string, mimeType: string, size: number}>) => Promise<void>;
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
  featureId?: string;
  onOpenBountyRequest?: () => void;
  awaitingFeedback?: boolean;
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
  featureId,
  onOpenBountyRequest,
  awaitingFeedback = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isMobile = useIsMobile();
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Image upload is disabled in agent mode
  const isImageUploadEnabled = taskMode !== "agent";

  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [pendingImages]);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Invalid file type: ${file.type}. Only JPEG, PNG, GIF, and WebP images are allowed.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds 10MB limit: ${(file.size / (1024 * 1024)).toFixed(2)}MB`;
    }
    return null;
  };

  const uploadToS3 = async (image: PendingImage): Promise<string> => {
    if (!taskId) {
      throw new Error("Task ID is required for image upload");
    }

    // Request presigned URL
    const presignedResponse = await fetch("/api/upload/presigned-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        filename: image.filename,
        contentType: image.mimeType,
        size: image.size,
      }),
    });

    if (!presignedResponse.ok) {
      const error = await presignedResponse.json();
      throw new Error(error.error || "Failed to get presigned URL");
    }

    const { presignedUrl, s3Path } = await presignedResponse.json();

    // Upload to S3
    const uploadResponse = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": image.mimeType },
      body: image.file,
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload to S3");
    }

    return s3Path;
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newImages: PendingImage[] = [];
    
    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        continue;
      }

      const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const preview = URL.createObjectURL(file);

      newImages.push({
        id,
        file,
        preview,
        uploading: false,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      });
    }

    if (newImages.length > 0) {
      setPendingImages(prev => [...prev, ...newImages]);
      // Start uploading immediately
      newImages.forEach(img => uploadImage(img));
    }
  };

  const uploadImage = async (image: PendingImage) => {
    setPendingImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, uploading: true, error: undefined } : img
    ));

    try {
      const s3Path = await uploadToS3(image);
      setPendingImages(prev => prev.map(img => 
        img.id === image.id ? { ...img, uploading: false, s3Path } : img
      ));
    } catch (error) {
      console.error("Upload error:", error);
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      setPendingImages(prev => prev.map(img => 
        img.id === image.id ? { ...img, uploading: false, error: errorMessage } : img
      ));
      toast.error(`Failed to upload ${image.filename}`, { description: errorMessage });
    }
  };

  const removeImage = (id: string) => {
    setPendingImages(prev => {
      const image = prev.find(img => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter(img => img.id !== id);
    });
  };

  const retryUpload = (id: string) => {
    const image = pendingImages.find(img => img.id === id);
    if (image) {
      uploadImage(image);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isImageUploadEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isImageUploadEnabled) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isImageUploadEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the form element
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isImageUploadEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!isImageUploadEnabled) return;
    
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      // Reset input value to allow selecting the same file again
      e.target.value = '';
    }
  };

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
    
    // Check if any images are still uploading
    const uploadingImages = pendingImages.filter(img => img.uploading);
    if (uploadingImages.length > 0) {
      toast.error("Please wait for all images to finish uploading");
      return;
    }

    // Check if any images have errors
    const errorImages = pendingImages.filter(img => img.error);
    if (errorImages.length > 0) {
      toast.error("Please remove or retry failed uploads before sending");
      return;
    }

    // Allow sending if we have text, images, or other attachments
    if (!input.trim() && pendingImages.length === 0 && !pendingDebugAttachment && !pendingStepAttachment) {
      return;
    }

    if (isLoading || disabled) return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    
    // Construct attachments from pending images
    const attachments = pendingImages
      .filter(img => img.s3Path)
      .map(img => ({
        path: img.s3Path!,
        filename: img.filename,
        mimeType: img.mimeType,
        size: img.size,
      }));

    // Cleanup preview URLs
    pendingImages.forEach(img => URL.revokeObjectURL(img.preview));

    // Clear state
    setInput("");
    resetTranscript();
    setPendingImages([]);

    // Send message with attachments
    await onSend(message, attachments.length > 0 ? attachments : undefined);
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
    if (mode === "agent") {
      return { icon: Bot, label: "Agent" };
    }
    return { icon: Workflow, label: "Workflow" };
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

  if (isTerminalState && !featureId) {
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
        {awaitingFeedback && workflowStatus === WorkflowStatus.COMPLETED && (
          <>
            <span>|</span>
            <div className="flex items-center gap-1.5 text-sm text-amber-600">
              <MessageSquare className="h-3 w-3" />
              <span>Awaiting your response</span>
            </div>
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

      {/* Image previews */}
      {isImageUploadEnabled && pendingImages.length > 0 && (
        <div className="px-4 md:px-6 pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {pendingImages.map((image, index) => (
              <div
                key={image.id}
                className={cn(
                  "relative rounded-lg border overflow-hidden bg-muted",
                  image.error && "border-red-500"
                )}
              >
                <div className="aspect-square relative">
                  <img
                    src={image.preview}
                    alt={image.filename}
                    className="w-full h-full object-cover"
                  />
                  {image.uploading && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  )}
                  {image.error && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <div className="text-center p-2">
                        <p className="text-xs text-red-500 mb-2">Upload failed</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => retryUpload(image.id)}
                          className="h-7"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-background/80 hover:bg-background"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="p-1 text-xs truncate text-center">
                  Image #{index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file input */}
      {isImageUploadEnabled && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex items-end gap-2 px-4 py-3 md:px-6 md:py-4 border-t bg-background",
          !isMobile && "sticky bottom-0 z-10",
          isDragging && "ring-2 ring-primary ring-offset-2"
        )}
      >
        {/* Drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-md flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center">
              <ImageIcon className="h-8 w-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium text-primary">Drop images here</p>
            </div>
          </div>
        )}

        <Textarea
          ref={textareaRef}
          placeholder={isListening ? "Listening..." : awaitingFeedback ? "Type your response..." : "Type your message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 resize-none min-h-[56px] md:min-h-[40px]"
          style={{
            maxHeight: "8em", // About 5 lines
            overflowY: "auto",
          }}
          disabled={disabled}
          autoFocus
          rows={1}
          data-testid="chat-message-input"
        />
        <div className="flex gap-2 shrink-0">
          {isImageUploadEnabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className="h-11 w-11 rounded-full shrink-0"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Upload images</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
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
              (!input.trim() && pendingImages.length === 0 && !pendingDebugAttachment && !pendingStepAttachment) || 
              isLoading || 
              disabled ||
              pendingImages.some(img => img.uploading || img.error)
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
