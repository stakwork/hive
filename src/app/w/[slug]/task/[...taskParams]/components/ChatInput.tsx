"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff, ImagePlus, X } from "lucide-react";
import { Artifact, WorkflowStatus } from "@/lib/chat";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { InputDebugAttachment } from "@/components/InputDebugAttachment";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import Image from "next/image";

export interface ImageAttachment {
  file: File;
  preview: string;
  s3Url?: string;
  s3Path?: string;
}

interface ChatInputProps {
  logs: LogEntry[];
  onSend: (message: string, images?: ImageAttachment[]) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  hasPrArtifact?: boolean;
  taskId?: string;
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
  taskId,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("live");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    // Allow sending if we have text, images, or a pending debug attachment
    if ((!input.trim() && images.length === 0 && !pendingDebugAttachment) || isLoading || disabled)
      return;

    if (isListening) {
      stopListening();
    }

    const message = input.trim();
    const imagesToSend = [...images];
    
    setInput("");
    setImages([]);
    resetTranscript();
    
    await onSend(message, imagesToSend.length > 0 ? imagesToSend : undefined);
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0 || !taskId) return;

    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!validImageTypes.includes(file.type)) {
        alert(`Invalid file type: ${file.name}. Only images are allowed.`);
        continue;
      }

      // Validate file size
      if (file.size > maxSize) {
        alert(`File too large: ${file.name}. Maximum size is 10MB.`);
        continue;
      }

      // Create preview
      const preview = URL.createObjectURL(file);

      // Add to images array
      setImages(prev => [...prev, { file, preview }]);

      // Upload to S3 in background
      uploadImage(file, preview);
    }
  };

  const uploadImage = async (file: File, preview: string) => {
    if (!taskId) return;

    try {
      setIsUploading(true);

      // Get presigned URL
      const presignedResponse = await fetch('/api/upload/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          taskId,
        }),
      });

      if (!presignedResponse.ok) {
        throw new Error('Failed to get presigned URL');
      }

      const { presignedUrl, s3Path } = await presignedResponse.json();

      // Upload to S3
      const uploadResponse = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      // Generate download URL (we'll use the same S3 service to get it)
      const downloadUrlResponse = await fetch(`/api/upload/presigned-url?s3Path=${encodeURIComponent(s3Path)}&action=download`);
      const { url: s3Url } = await downloadUrlResponse.json();

      // Update image with S3 URL
      setImages(prev =>
        prev.map(img =>
          img.preview === preview
            ? { ...img, s3Url, s3Path }
            : img
        )
      );
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
      // Remove failed image
      setImages(prev => prev.filter(img => img.preview !== preview));
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeImage = (preview: string) => {
    setImages(prev => {
      const image = prev.find(img => img.preview === preview);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter(img => img.preview !== preview);
    });
  };

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [images]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow Shift+Enter for new lines, Enter alone submits
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    // Shift+Enter will naturally insert a new line (no preventDefault)
  };

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{mode}</span>
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

      {/* Image previews */}
      {images.length > 0 && (
        <div className="px-6 pt-3">
          <div className="flex gap-2 flex-wrap">
            {images.map((image) => (
              <div key={image.preview} className="relative group">
                <Image
                  src={image.preview}
                  alt="Upload preview"
                  width={100}
                  height={100}
                  className="rounded-md object-cover border"
                />
                <button
                  type="button"
                  onClick={() => removeImage(image.preview)}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
                {!image.s3Url && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-md">
                    <span className="text-white text-xs">Uploading...</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-6 py-4 border-t bg-background sticky bottom-0 z-10"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || !taskId}
                className="px-3"
              >
                <ImagePlus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Add images (drag & drop or click)</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
          disabled={
            (!input.trim() && images.length === 0 && !pendingDebugAttachment) || 
            isLoading || 
            disabled ||
            isUploading
          }
          data-testid="chat-message-submit"
        >
          {isLoading ? "Sending..." : isUploading ? "Uploading..." : "Send"}
        </Button>
      </form>
    </div>
  );
}
