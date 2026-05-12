"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { ArrowUp, Mic, MicOff, Loader2, Sparkles } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { getModelValue, getStoredPlanModelPreference, setStoredPlanModelPreference, type LlmModelOption } from "@/lib/ai/models";
import { TargetSelector, encodeTargetValue, type TargetSelection } from "@/components/shared/TargetSelector";

interface PlanStartInputProps {
  onSubmit: (
    message: string,
    options?: {
      isPrototype: boolean;
      selectedRepoId: string | null;
      selectedWorkflow: { workflowId: number; workflowName: string; workflowRefId: string } | null;
      model: string;
    }
  ) => void;
  isLoading?: boolean;
}

export function PlanStartInput({ onSubmit, isLoading = false }: PlanStartInputProps) {
  const [value, setValue] = useState("");
  const [isPrototype, setIsPrototype] = useState(false);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const showTargetSelector = repositories.length > 1 || workspace?.slug === "stakwork";

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

  const hasText = value.trim().length > 0;

  const handleSubmit = () => {
    if (hasText && !isLoading) {
      if (isListening) {
        stopListening();
      }
      resetTranscript();
      setStoredPlanModelPreference(selectedModel);
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

  const title = "What job are you trying to solve?";

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
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
                disabled={isLoading}
                className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-4 rounded-3xl shadow-none"
                autoFocus
                data-testid="plan-start-input"
              />
            </div>
          </motion.div>

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

            <div className="ml-auto flex gap-2">
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
