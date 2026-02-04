"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  ArrowUp,
  Mic,
  MicOff,
  Bot,
  Workflow,
  Beaker,
  Loader2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
} from "lucide-react";
import { isDevelopmentMode } from "@/lib/runtime";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { WorkflowNode } from "@/hooks/useWorkflowNodes";
import { PromptsPanel } from "@/components/prompts";

import { VALID_MODELS, type ModelName } from "@/lib/ai/models";

interface TaskStartInputProps {
  onStart: (task: string, model?: ModelName) => void;
  taskMode: string;
  onModeChange: (mode: string) => void;
  isLoading?: boolean;
  hasAvailablePods?: boolean | null;
  isCheckingPods?: boolean;
  workspaceSlug?: string;
  // Workflow editor props
  workflows?: WorkflowNode[];
  onWorkflowSelect?: (workflowId: number, workflowData: WorkflowNode) => void;
  onNewWorkflow?: () => void;
  isLoadingWorkflows?: boolean;
  workflowsError?: string | null;
  // Model selection for agent mode
  selectedModel?: ModelName;
  onModelChange?: (model: ModelName) => void;
}

export function TaskStartInput({
  onStart,
  taskMode,
  onModeChange,
  isLoading = false,
  hasAvailablePods,
  isCheckingPods = false,
  workspaceSlug,
  workflows = [],
  onWorkflowSelect,
  onNewWorkflow,
  isLoadingWorkflows = false,
  workflowsError,
  selectedModel = "sonnet",
  onModelChange,
}: TaskStartInputProps) {
  const searchParams = useSearchParams();
  const [value, setValue] = useState("");
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const [hasInteractedWithWorkflowInput, setHasInteractedWithWorkflowInput] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const devMode = isDevelopmentMode();
  const isWorkflowMode = taskMode === "workflow_editor";
  const isPromptsMode = taskMode === "prompts";

  // Check URL for prompt param and switch to prompts mode if present
  useEffect(() => {
    const promptId = searchParams.get("prompt");
    if (promptId && taskMode !== "prompts") {
      onModeChange("prompts");
    }
  }, [searchParams, taskMode, onModeChange]);

  // Focus appropriate input based on mode
  useEffect(() => {
    if (isWorkflowMode) {
      workflowInputRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [isWorkflowMode]);

  // Check if user typed "new" to create a new workflow
  const isNewWorkflow = workflowIdValue.trim().toLowerCase() === "new";

  // Find matching workflow as user types
  const matchedWorkflow = useMemo(() => {
    if (!workflowIdValue.trim() || isNewWorkflow) return null;
    const searchId = parseInt(workflowIdValue.trim(), 10);
    if (isNaN(searchId)) return null;
    return workflows.find((w) => w.properties.workflow_id === searchId) || null;
  }, [workflowIdValue, workflows, isNewWorkflow]);

  const workflowName = matchedWorkflow?.properties.workflow_name || null;
  const hasValidWorkflowId = workflowIdValue.trim().length > 0 && !isNaN(parseInt(workflowIdValue.trim(), 10));
  // Only show "not found" if workflows have been successfully loaded (array is not empty)
  // and the user has interacted with the input field
  const workflowNotFound = hasValidWorkflowId && !matchedWorkflow && !isLoadingWorkflows && workflows.length > 0 && hasInteractedWithWorkflowInput;

  useEffect(() => {
    if (transcript) {
      // Append transcript to the initial value
      const newValue = initialValueRef.current ? `${initialValueRef.current} ${transcript}`.trim() : transcript;
      setValue(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      // Store the current value when starting to listen
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onStart(value.trim(), selectedModel);
      }
    }
  };

  const handleWorkflowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isNewWorkflow && onNewWorkflow) {
        onNewWorkflow();
      } else if (matchedWorkflow && onWorkflowSelect) {
        onWorkflowSelect(matchedWorkflow.properties.workflow_id, matchedWorkflow);
      }
    }
  };

  const hasText = value.trim().length > 0;
  const noPodsAvailable = taskMode === "agent" && hasAvailablePods === false;

  const handleClick = () => {
    if (isWorkflowMode) {
      if (isNewWorkflow && onNewWorkflow) {
        onNewWorkflow();
      } else if (matchedWorkflow && onWorkflowSelect) {
        onWorkflowSelect(matchedWorkflow.properties.workflow_id, matchedWorkflow);
      }
    } else {
      if (hasText) {
        if (isListening) {
          stopListening();
        }
        resetTranscript();
        onStart(value.trim(), selectedModel);
      }
    }
  };

  // Check for prefilled workflow ID from localStorage (set when opening from Prompts)
  useEffect(() => {
    const prefillId = localStorage.getItem("prefill_workflow_id");
    if (prefillId) {
      setWorkflowIdValue(prefillId);
      localStorage.removeItem("prefill_workflow_id");
    }
  }, []);

  // Reset interaction state when mode changes
  useEffect(() => {
    setHasInteractedWithWorkflowInput(false);
  }, [isWorkflowMode]);

  // Handle workflow input change
  const handleWorkflowInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkflowIdValue(e.target.value);
    setHasInteractedWithWorkflowInput(true);
  };

  // Handle workflow input blur
  const handleWorkflowInputBlur = () => {
    setHasInteractedWithWorkflowInput(true);
  };

  // Determine if submit button should be enabled
  const isSubmitDisabled = isWorkflowMode
    ? (!matchedWorkflow && !isNewWorkflow) || isLoadingWorkflows || isLoading
    : !hasText || isLoading || noPodsAvailable;

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case "live":
        return { icon: Clock, label: "Async" };
      case "agent":
        return { icon: Bot, label: "Agent" };
      case "workflow_editor":
        return { icon: Workflow, label: "Workflow" };
      case "prompts":
        return { icon: FileText, label: "Prompts" };
      case "test":
        return { icon: Beaker, label: "Test" };
      default:
        return { icon: Clock, label: "Async" };
    }
  };

  const modeConfig = getModeConfig(taskMode);
  const ModeIcon = modeConfig.icon;

  const title = isWorkflowMode ? "Workflow Editor" : isPromptsMode ? "Manage Prompts" : "Build Something";

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
      {isPromptsMode ? (
        <div className="w-full max-w-4xl relative">
          <PromptsPanel variant="fullpage" workspaceSlug={workspaceSlug} />
          <div className="absolute -bottom-12 left-0 z-10">
            <Select value={taskMode} onValueChange={onModeChange}>
              <SelectTrigger className="w-[140px] h-8 text-xs rounded-lg shadow-sm bg-card">
                <div className="flex items-center gap-2">
                  <ModeIcon className="h-4 w-4" />
                  <span>{modeConfig.label}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Async</span>
                  </div>
                </SelectItem>
                <SelectItem value="agent">
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5" />
                    <span>Agent</span>
                  </div>
                </SelectItem>
                {(workspaceSlug === "stakwork" || devMode) && (
                  <SelectItem value="workflow_editor">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-3.5 w-3.5" />
                      <span>Workflow</span>
                    </div>
                  </SelectItem>
                )}
                {(workspaceSlug === "stakwork" || devMode) && (
                  <SelectItem value="prompts">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      <span>Prompts</span>
                    </div>
                  </SelectItem>
                )}
                {devMode && (
                  <SelectItem value="test">
                    <div className="flex items-center gap-2">
                      <Beaker className="h-3.5 w-3.5" />
                      <span>Test</span>
                    </div>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <Card className="relative w-full max-w-2xl p-0 bg-card rounded-3xl shadow-sm border-0 group">
          <AnimatePresence mode="wait">
            {isWorkflowMode ? (
              <motion.div
                key="workflow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="min-h-[180px] px-8 pt-8 pb-16"
              >
                <Input
                  ref={workflowInputRef}
                  type="text"
                  placeholder="Enter workflow ID (e.g., 47607)"
                  value={workflowIdValue}
                  onChange={handleWorkflowInputChange}
                  onBlur={handleWorkflowInputBlur}
                  onKeyDown={handleWorkflowKeyDown}
                  className="text-lg h-12 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 shadow-none"
                  autoFocus
                  data-testid="workflow-id-input"
                />
                {/* Workflow status messages */}
                <div className="mt-4 min-h-[24px]">
                  {workflowsError && !isNewWorkflow && !matchedWorkflow && (
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">{workflowsError}</span>
                    </div>
                  )}
                  {workflowNotFound && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">Workflow not found</span>
                    </div>
                  )}
                  {isNewWorkflow && (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm">New Workflow</span>
                    </div>
                  )}
                  {matchedWorkflow && (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm">
                        {workflowName || `Workflow ${matchedWorkflow.properties.workflow_id}`}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="task"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Textarea
                  ref={textareaRef}
                  placeholder={isListening ? "Listening..." : "Describe a task"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
                  autoFocus
                  data-testid="task-start-input"
                />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="absolute bottom-6 left-8 z-10 flex gap-2">
          <Select value={taskMode} onValueChange={onModeChange}>
            <SelectTrigger className="w-[140px] h-8 text-xs rounded-lg shadow-sm">
              <div className="flex items-center gap-2">
                <ModeIcon className="h-4 w-4" />
                <span>{modeConfig.label}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Async</span>
                </div>
              </SelectItem>
              <SelectItem value="agent">
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5" />
                  <span>Agent</span>
                </div>
              </SelectItem>
              {(workspaceSlug === "stakwork" || devMode) && (
                <SelectItem value="workflow_editor">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-3.5 w-3.5" />
                    <span>Workflow</span>
                  </div>
                </SelectItem>
              )}
              {(workspaceSlug === "stakwork" || devMode) && (
                <SelectItem value="prompts">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Prompts</span>
                  </div>
                </SelectItem>
              )}
              {devMode && (
                <SelectItem value="test">
                  <div className="flex items-center gap-2">
                    <Beaker className="h-3.5 w-3.5" />
                    <span>Test</span>
                  </div>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {taskMode === "agent" && onModelChange && (
            <Select value={selectedModel} onValueChange={(value) => onModelChange(value as ModelName)}>
              <SelectTrigger className="w-[120px] h-8 text-xs rounded-lg shadow-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span>{selectedModel}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {VALID_MODELS.map((model) => (
                  <SelectItem key={model} value={model}>
                    <div className="flex items-center gap-2">
                      <span>{model}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="absolute bottom-6 right-8 z-10 flex gap-2">
          {isSupported && !isWorkflowMode && (
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
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
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
            disabled={isSubmitDisabled}
            onClick={handleClick}
            tabIndex={0}
            data-testid="task-start-submit"
          >
            {isLoading || isLoadingWorkflows ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </Button>
        </div>
        </Card>
      )}

      {/* Pod availability warning for agent mode */}
      {taskMode === "agent" && hasAvailablePods === false && !isCheckingPods && (
        <div className="w-full max-w-2xl mt-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">No pods currently available.</p>
        </div>
      )}
    </div>
  );
}
