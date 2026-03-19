"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { ArrowUp, Mic, MicOff, Loader2, FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface PlanStartInputProps {
  onSubmit: (
    message: string,
    options?: { isPrototype: boolean; selectedRepoId: string | null },
    pendingFiles?: Array<{ file: File; filename: string; mimeType: string; size: number }>,
  ) => void;
  isLoading?: boolean;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function PlanStartInput({ onSubmit, isLoading = false }: PlanStartInputProps) {
  const [value, setValue] = useState("");
  const [isPrototype, setIsPrototype] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const { workspace, workspaces } = useWorkspace();
  const repositories = workspace?.repositories ?? [];

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const filteredWorkspaces =
    mentionQuery !== null
      ? workspaces.filter(
          (ws) =>
            ws.slug !== workspace?.slug &&
            ws.slug.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];
  const showRepositoryDropdown = repositories.length > 1;
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(
    repositories[0]?.id ?? null,
  );

  // Keep selectedRepositoryId in sync when repositories load
  useEffect(() => {
    if (repositories.length > 0 && !selectedRepositoryId) {
      setSelectedRepositoryId(repositories[0].id);
    }
  }, [repositories, selectedRepositoryId]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (transcript) {
      const newValue = initialValueRef.current
        ? `${initialValueRef.current} ${transcript}`.trim()
        : transcript;
      setValue(newValue);
    }
  }, [transcript]);

  // Revoke object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImages]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      initialValueRef.current = value;
      startListening();
    }
  }, [isListening, stopListening, startListening, value]);

  const handleStartListening = useCallback(() => {
    initialValueRef.current = value;
    startListening();
  }, [value, startListening]);

  useControlKeyHold({
    onStart: handleStartListening,
    onStop: stopListening,
    enabled: isSupported && !isLoading,
  });

  const insertMention = useCallback(
    (slug: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const replaced = before.replace(/\B@[\w-]*$/, `@${slug}`);
      const newValue = replaced + after;
      setValue(newValue);
      setMentionQuery(null);
      setMentionIndex(0);
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = replaced.length;
        textarea.setSelectionRange(pos, pos);
      });
    },
    [value],
  );

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `${file.name} is not a supported image type. Allowed: JPEG, PNG, GIF, WebP`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `${file.name} is too large. Maximum size is 10MB`;
    }
    return null;
  };

  const handleFiles = (files: FileList | File[]) => {
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
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      });
    }

    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
  };

  const removeImage = (id: string) => {
    setPendingImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
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
      e.target.value = "";
    }
  };

  const hasText = value.trim().length > 0;

  const handleSubmit = () => {
    if (hasText) {
      if (isListening) {
        stopListening();
      }
      resetTranscript();
      const filesToSend = pendingImages.map((img) => ({
        file: img.file,
        filename: img.filename,
        mimeType: img.mimeType,
        size: img.size,
      }));
      onSubmit(value.trim(), { isPrototype, selectedRepoId: selectedRepositoryId }, filesToSend);
      // Revoke URLs and clear pending images
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPendingImages([]);
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isLoading && mentionQuery !== null && filteredWorkspaces.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredWorkspaces.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredWorkspaces.length) % filteredWorkspaces.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertMention(filteredWorkspaces[mentionIndex].slug);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredWorkspaces[mentionIndex].slug);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const title = "What job are you trying to solve?";

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {title}
          </motion.span>
        </AnimatePresence>
      </h1>
      <div className="w-full max-w-2xl">
        <Card
          className={cn(
            "relative w-full p-0 bg-card rounded-3xl shadow-sm border-0 group",
            isDragging && "ring-2 ring-primary ring-offset-2",
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-3xl flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center">
                <ImageIcon className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium text-primary">Drop images here</p>
              </div>
            </div>
          )}

          <motion.div
            key="plan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <div className="relative">
              {!isLoading && mentionQuery !== null && filteredWorkspaces.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
                  <Command className="rounded-lg border shadow-md bg-popover">
                    <CommandList>
                      {filteredWorkspaces.map((ws, idx) => (
                        <CommandItem
                          key={ws.slug}
                          value={ws.slug}
                          onSelect={() => insertMention(ws.slug)}
                          className={cn(
                            "cursor-pointer px-3 py-2 text-sm",
                            idx === mentionIndex && "bg-accent text-accent-foreground",
                          )}
                          data-testid={`mention-item-${ws.slug}`}
                        >
                          <span className="font-medium">@{ws.slug}</span>
                          {ws.name && ws.name !== ws.slug && (
                            <span className="ml-2 text-muted-foreground">{ws.name}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </div>
              )}
              <Textarea
                ref={textareaRef}
                placeholder={isListening ? "Listening..." : "Describe a feature or problem"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  const cursor = e.target.selectionStart ?? e.target.value.length;
                  const before = e.target.value.slice(0, cursor);
                  const match = before.match(/\B@([\w-]*)$/);
                  if (match) {
                    setMentionQuery(match[1]);
                    setMentionIndex(0);
                  } else {
                    setMentionQuery(null);
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-4 rounded-3xl shadow-none"
                autoFocus
                data-testid="plan-start-input"
              />
            </div>
          </motion.div>

          {/* Pending image thumbnails */}
          {pendingImages.length > 0 && (
            <div className="px-8 pb-2 flex flex-wrap gap-2" data-testid="pending-images-grid">
              {pendingImages.map((image) => (
                <div key={image.id} className="relative group/thumb w-16 h-16 rounded-lg overflow-hidden border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.preview}
                    alt={image.filename}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    data-testid={`remove-image-${image.id}`}
                    aria-label={`Remove ${image.filename}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bottom row */}
          <div className="px-8 pb-6 flex items-center gap-4 flex-wrap" data-testid="bottom-row">
            <div className="flex items-center gap-2">
              <Switch
                id="prototype-toggle"
                checked={isPrototype}
                onCheckedChange={setIsPrototype}
                data-testid="prototype-toggle"
              />
              <Label htmlFor="prototype-toggle" className="text-sm cursor-pointer select-none">
                Prototype
              </Label>
            </div>

            {isPrototype && showRepositoryDropdown && (
              <Select
                value={selectedRepositoryId || undefined}
                onValueChange={(value) => setSelectedRepositoryId(value)}
              >
                <SelectTrigger className="w-[180px] h-8 text-xs rounded-lg shadow-sm">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    <span className="truncate">
                      {repositories.find((r) => r.id === selectedRepositoryId)?.name ||
                        "Select repository"}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {repositories.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>{repo.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto flex gap-2">
              {/* Image upload button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
                      style={{ width: 32, height: 32 }}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      data-testid="image-upload-button"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Attach image</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {isSupported && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={isListening ? "default" : "outline"}
                        size="icon"
                        className="rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
                        style={{ width: 32, height: 32 }}
                        onClick={toggleListening}
                        disabled={isLoading}
                      >
                        {isListening ? (
                          <MicOff className="w-4 h-4" />
                        ) : (
                          <Mic className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isListening ? "Stop recording" : "Start voice input (or hold Ctrl)"}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button
                type="button"
                variant="default"
                size="icon"
                className="rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
                style={{ width: 32, height: 32 }}
                disabled={!hasText || isLoading}
                onClick={handleSubmit}
                tabIndex={0}
                data-testid="plan-start-submit"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            data-testid="file-input"
          />
        </Card>
      </div>
    </div>
  );
}
