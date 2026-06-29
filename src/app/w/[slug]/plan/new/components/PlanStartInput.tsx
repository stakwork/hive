"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { ArrowUp, Mic, MicOff, Loader2, Sparkles, ImageIcon, Upload, X, Code2 } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useVoiceCorrectionCapture } from "@/hooks/useVoiceCorrectionCapture";
import { useVoiceLearningPreference } from "@/hooks/useVoiceLearningPreference";
import { cn } from "@/lib/utils";
import { getModelValue, getStoredPlanModelPreference, setStoredPlanModelPreference, getPlanRepoPreference, setPlanRepoPreference, type LlmModelOption } from "@/lib/ai/models";
import { TargetSelector, encodeTargetValue, type TargetSelection } from "@/components/shared/TargetSelector";
import { toast } from "sonner";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

interface PlanStartInputProps {
  onSubmit: (
    message: string,
    options?: {
      isPrototype: boolean;
      selectedRepoId: string | null;
      selectedWorkflow: { workflowId: number; workflowName: string; workflowRefId: string } | null;
      model: string;
      attachmentFiles?: File[];
      selectedRepositoryIds?: string[];
    }
  ) => void;
  isLoading?: boolean;
  loadingStatus?: string;
  initialWorkflow?: { workflowId: number; workflowName: string; workflowRefId: string };
}

export function PlanStartInput({ onSubmit, isLoading = false, loadingStatus, initialWorkflow }: PlanStartInputProps) {
  const [value, setValue] = useState("");
  const [isPrototype, setIsPrototype] = useState(false);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const { workspace, workspaces, id: workspaceId } = useWorkspace();
  const repositories = workspace?.repositories ?? [];
  const workspaceSlug = workspace?.slug ?? "";
  const { nudgeIfNeeded } = useVoiceLearningPreference();
  const { capture } = useVoiceCorrectionCapture({ surface: "plan_start", workspaceId: workspaceId ?? undefined });

  // Repo context selector state — initialised from localStorage per workspace slug
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>(() => {
    return getPlanRepoPreference(workspaceSlug) ?? repositories.map((r) => r.id);
  });

  // Keep in sync when repositories first load (SSR: repositories may be empty on first render)
  useEffect(() => {
    if (repositories.length > 0 && selectedRepoIds.length === 0) {
      setSelectedRepoIds(getPlanRepoPreference(workspaceSlug) ?? repositories.map((r) => r.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories]);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // File attachment state
  const [selectedFiles, setSelectedFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredWorkspaces =
    mentionQuery !== null
      ? workspaces.filter(
          (ws) =>
            ws.slug !== workspace?.slug &&
            ws.slug.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];

  // Unified target selection: either a repo or a workflow
  const [selectedTarget, setSelectedTarget] = useState<TargetSelection | null>(
    repositories[0] ? { type: "repo", repositoryId: repositories[0].id } : null
  );

  // Keep target in sync when repositories first load (if no selection yet)
  useEffect(() => {
    if (!selectedTarget && repositories.length > 0) {
      setSelectedTarget({ type: "repo", repositoryId: repositories[0].id });
    }
  }, [repositories, selectedTarget]);

  // Pre-seed workflow target from URL params (e.g., navigating from inspector)
  useEffect(() => {
    if (initialWorkflow) {
      setSelectedTarget({
        type: "workflow",
        workflowId: initialWorkflow.workflowId,
        workflowName: initialWorkflow.workflowName,
        workflowRefId: initialWorkflow.workflowRefId,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkflow]);

  const showTargetSelector = repositories.length > 1 || workspace?.slug === "stakwork";

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      selectedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const fetchLlmModels = async () => {
      try {
        const response = await fetch("/api/llm-models");
        if (response.ok) {
          const data = await response.json();
          const models: LlmModelOption[] = data.models ?? [];
          setLlmModels(models);
          if (models.length > 0) {
            const storedPreference = getStoredPlanModelPreference();
            const storedModel = storedPreference
              ? models.find((m: LlmModelOption) => getModelValue(m) === storedPreference)
              : null;
            const defaultModel = models.find((m: LlmModelOption) => m.isPlanDefault);
            setSelectedModel(getModelValue(storedModel ?? defaultModel ?? models[0]));
          }
        }
      } catch (error) {
        console.error("Error fetching LLM models:", error);
      }
    };
    fetchLlmModels();
  }, []);

  useEffect(() => {
    if (transcript) {
      const newValue = initialValueRef.current
        ? `${initialValueRef.current} ${transcript}`.trim()
        : transcript;
      setValue(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      nudgeIfNeeded();
      initialValueRef.current = value;
      startListening();
    }
  }, [isListening, stopListening, startListening, value, nudgeIfNeeded]);

  const handleStartListening = useCallback(() => {
    nudgeIfNeeded();
    initialValueRef.current = value;
    startListening();
  }, [value, startListening, nudgeIfNeeded]);

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
      const newValue = replaced + ' ' + after;
      setValue(newValue);
      setMentionQuery(null);
      setMentionIndex(0);
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = replaced.length + 1;
        textarea.setSelectionRange(pos, pos);
      });
    },
    [value],
  );

  // File validation and attachment
  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newEntries: { file: File; previewUrl: string }[] = [];
    for (const file of fileArray) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" is not a valid image type. Please use JPEG, PNG, GIF, or WebP.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds the 10MB size limit.`);
        continue;
      }
      newEntries.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (newEntries.length > 0) {
      setSelectedFiles((prev) => [...prev, ...newEntries]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  // Paste handler for the textarea
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFiles(imageFiles);
    }
  };

  const hasText = value.trim().length > 0;

  const handleSubmit = () => {
    if (hasText && !isLoading) {
      if (isListening) {
        stopListening();
      }
      capture({
        rawTranscript: transcript,
        preVoiceText: initialValueRef.current,
        finalText: value.trim(),
      });
      resetTranscript();
      setStoredPlanModelPreference(selectedModel);
      setPlanRepoPreference(workspaceSlug, selectedRepoIds);
      onSubmit(value.trim(), {
        isPrototype,
        selectedRepoId: selectedTarget?.type === "repo" ? selectedTarget.repositoryId : null,
        selectedWorkflow:
          selectedTarget?.type === "workflow"
            ? {
                workflowId: selectedTarget.workflowId,
                workflowName: selectedTarget.workflowName,
                workflowRefId: selectedTarget.workflowRefId,
              }
            : null,
        model: selectedModel,
        attachmentFiles: selectedFiles.map((s) => s.file),
        selectedRepositoryIds: selectedRepoIds,
      });
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

  const fileInputId = "plan-start-file-input";
  const title = "What job are you trying to solve?";

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background overflow-hidden">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        {title}
      </h1>
      <div className="w-full max-w-2xl">
        <Card className="relative w-full p-0 bg-card rounded-3xl shadow-sm border-0 group">
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
                disabled={isLoading}
                className="resize-none min-h-[180px] max-h-[40vh] overflow-y-auto text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-4 rounded-3xl shadow-none"
                autoFocus
                data-testid="plan-start-input"
              />
            </div>
          </motion.div>

          {/* File attachment area */}
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            multiple
            data-testid="file-input"
          />
          <div className="mx-8 mb-4">
            {selectedFiles.length === 0 ? (
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleImageDrop}
              >
                <label htmlFor={fileInputId} className="cursor-pointer">
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-md p-4 text-center transition-colors",
                      isDragging
                        ? "border-primary bg-primary/10"
                        : "border-muted-foreground/25 hover:border-muted-foreground/50",
                    )}
                    data-testid="drop-zone"
                  >
                    <Upload className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted-foreground mt-1">JPEG, PNG, GIF, WebP (max 10MB)</p>
                  </div>
                </label>
              </div>
            ) : (
              <div
                className="flex flex-wrap gap-2"
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleImageDrop}
                data-testid="file-preview"
              >
                {selectedFiles.map((entry, index) => (
                  <div
                    key={entry.previewUrl}
                    className="flex items-center gap-1.5 border rounded-md p-1.5 bg-muted/30"
                    data-testid={`file-chip-${index}`}
                  >
                    <img
                      src={entry.previewUrl}
                      alt="Preview"
                      className="w-10 h-10 object-cover rounded"
                    />
                    <div className="min-w-0 max-w-[120px]">
                      <p className="text-xs font-medium truncate">{entry.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(entry.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => handleRemoveFile(index)}
                      data-testid={`remove-file-${index}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <label
                  htmlFor={fileInputId}
                  className="flex items-center justify-center w-10 h-[60px] border-2 border-dashed rounded-md cursor-pointer text-muted-foreground hover:border-muted-foreground/50 transition-colors"
                  title="Add more images"
                >
                  <Upload className="w-4 h-4" />
                </label>
              </div>
            )}
          </div>

          {/* Prototype toggle row */}
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

            {isPrototype && showTargetSelector && (
              <TargetSelector
                value={selectedTarget ? encodeTargetValue(selectedTarget) : undefined}
                onChange={setSelectedTarget}
                repositories={repositories.map((r) => ({ id: r.id, name: r.name }))}
                size="default"
                className="w-[200px]"
                placeholder="Select target"
              />
            )}

            {llmModels.length > 0 && (
              <Select value={selectedModel} onValueChange={(v) => { setSelectedModel(v); setStoredPlanModelPreference(v); }}>
                <SelectTrigger className="w-auto h-8 text-xs rounded-lg shadow-sm whitespace-nowrap" data-testid="model-selector">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span>{selectedModel ? (llmModels.find(m => getModelValue(m) === selectedModel)?.name || selectedModel) : "Model"}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {llmModels.map((m) => (
                    <SelectItem key={m.id} value={getModelValue(m)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto flex items-center gap-2">
              {isLoading && loadingStatus && (
                <span
                  className="text-xs text-muted-foreground animate-pulse self-center mr-1"
                  data-testid="loading-status"
                >
                  {loadingStatus}
                </span>
              )}
              {/* Repo context selector */}
              <DropdownMenu>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          style={{ width: 32, height: 32 }}
                          className="rounded-full shadow-lg"
                          disabled={isLoading}
                          data-testid="repo-selector-button"
                        >
                          <Code2
                            className={cn(
                              "w-4 h-4",
                              selectedRepoIds.length !== repositories.length && "text-primary"
                            )}
                          />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent><p>Select repositories</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuContent align="end" className="w-[220px]">
                  <DropdownMenuLabel>Repositories</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {repositories.map((repo) => (
                    <DropdownMenuCheckboxItem
                      key={repo.id}
                      checked={selectedRepoIds.includes(repo.id)}
                      onCheckedChange={(checked) =>
                        setSelectedRepoIds((prev) =>
                          checked ? [...prev, repo.id] : prev.filter((id) => id !== repo.id)
                        )
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {repo.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Attach image button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      style={{ width: 32, height: 32 }}
                      className="rounded-full shadow-lg"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      data-testid="attach-image-button"
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
        </Card>
      </div>
    </div>
  );
}
