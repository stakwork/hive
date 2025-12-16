"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ArrowUp, Mic, MicOff, Bot, Workflow, Beaker, Loader2, AlertTriangle, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { isDevelopmentMode } from "@/lib/runtime";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { WorkflowNode } from "@/hooks/useWorkflowNodes";

interface TaskStartInputProps {
  onStart: (task: string) => void;
  taskMode: string;
  onModeChange: (mode: string) => void;
  isLoading?: boolean;
  hasAvailablePods?: boolean | null;
  isCheckingPods?: boolean;
  workspaceSlug?: string;
  // Workflow editor props
  workflows?: WorkflowNode[];
  onWorkflowSelect?: (workflowId: number, workflowData: WorkflowNode) => void;
  isLoadingWorkflows?: boolean;
  workflowsError?: string | null;
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
  isLoadingWorkflows = false,
  workflowsError,
}: TaskStartInputProps) {
  const [value, setValue] = useState("");
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const devMode = isDevelopmentMode();
  const isWorkflowMode = taskMode === "workflow_editor";

  // Focus appropriate input based on mode
  useEffect(() => {
    if (isWorkflowMode) {
      workflowInputRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [isWorkflowMode]);

  // Find matching workflow as user types
  const matchedWorkflow = useMemo(() => {
    if (!workflowIdValue.trim()) return null;
    const searchId = parseInt(workflowIdValue.trim(), 10);
    if (isNaN(searchId)) return null;
    return workflows.find((w) => w.properties.workflow_id === searchId) || null;
  }, [workflowIdValue, workflows]);

  const workflowName = matchedWorkflow?.properties.workflow_name || null;
  const hasValidWorkflowId = workflowIdValue.trim().length > 0 && !isNaN(parseInt(workflowIdValue.trim(), 10));
  const workflowNotFound = hasValidWorkflowId && !matchedWorkflow && !isLoadingWorkflows;

  useEffect(() => {
    if (transcript) {
      // Append transcript to the initial value
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
        onStart(value.trim());
      }
    }
  };

  const handleWorkflowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && matchedWorkflow && onWorkflowSelect) {
      e.preventDefault();
      onWorkflowSelect(matchedWorkflow.properties.workflow_id, matchedWorkflow);
    }
  };

  const hasText = value.trim().length > 0;
  const noPodsAvailable = taskMode === "agent" && hasAvailablePods === false;

  const handleClick = () => {
    if (isWorkflowMode) {
      if (matchedWorkflow && onWorkflowSelect) {
        onWorkflowSelect(matchedWorkflow.properties.workflow_id, matchedWorkflow);
      }
    } else {
      if (hasText) {
        if (isListening) {
          stopListening();
        }
        resetTranscript();
        onStart(value.trim());
      }
    }
  };

  // Determine if submit button should be enabled
  const isSubmitDisabled = isWorkflowMode
    ? !matchedWorkflow || isLoadingWorkflows || isLoading
    : !hasText || isLoading || noPodsAvailable;

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case "live":
        return { icon: Clock, label: "Async" };
      case "agent":
        return { icon: Bot, label: "Agent" };
      case "workflow_editor":
        return { icon: Workflow, label: "Workflow" };
      case "test":
        return { icon: Beaker, label: "Test" };
      default:
        return { icon: Clock, label: "Async" };
    }
  };

  const modeConfig = getModeConfig(taskMode);
  const ModeIcon = modeConfig.icon;

  const title = isWorkflowMode ? "Workflow Editor" : "Build Something";

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
                onChange={(e) => setWorkflowIdValue(e.target.value)}
                onKeyDown={handleWorkflowKeyDown}
                className="text-lg h-12 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 shadow-none"
                autoFocus
                data-testid="workflow-id-input"
              />
              {/* Workflow status messages */}
              <div className="mt-4 min-h-[24px]">
                {workflowsError && (
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
        <div className="absolute bottom-6 left-8 z-10">
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
              {workspaceSlug === "stakwork" && (
                <SelectItem value="workflow_editor">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-3.5 w-3.5" />
                    <span>Workflow</span>
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

      {/* Pod availability warning for agent mode */}
      {taskMode === "agent" && hasAvailablePods === false && !isCheckingPods && (
        <div className="w-full max-w-2xl mt-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            No pods currently available.
          </p>
        </div>
      )}
    </div>
  );
}
