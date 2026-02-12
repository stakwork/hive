"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Image as ImageIcon,
  X,
  Sparkles,
} from "lucide-react";
import { isDevelopmentMode } from "@/lib/runtime";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { WorkflowNode } from "@/hooks/useWorkflowNodes";
import { PromptsPanel } from "@/components/prompts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  filename: string;
  mimeType: string;
  size: number;
}

import { VALID_MODELS, type ModelName } from "@/lib/ai/models";

interface TaskStartInputProps {
  onStart: (task: string, model?: ModelName, autoMerge?: boolean, images?: File[]) => void;
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
  // Project debugger props
  onProjectSelect?: (projectId: string, projectData: any) => void;
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
  onProjectSelect,
  selectedModel = "sonnet",
  onModelChange,
}: TaskStartInputProps) {
  const searchParams = useSearchParams();
  const [value, setValue] = useState("");
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const [hasInteractedWithWorkflowInput, setHasInteractedWithWorkflowInput] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [autoMerge, setAutoMerge] = useState(true);
  
  // Project debugger state
  const [projectIdValue, setProjectIdValue] = useState("");
  const [projectNotFound, setProjectNotFound] = useState(false);
  const [matchedProject, setMatchedProject] = useState<any>(null);
  const [isValidatingProject, setIsValidatingProject] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef("");
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  const devMode = isDevelopmentMode();
  const isWorkflowMode = taskMode === "workflow_editor";
  const isProjectMode = taskMode === "project_debugger";
  const isPromptsMode = taskMode === "prompts";
  const isAgentMode = taskMode === "agent";
  
  // Image upload is disabled in agent mode and workflow mode
  const isImageUploadEnabled = taskMode !== "agent" && !isWorkflowMode;
  
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
    } else if (isProjectMode) {
      projectInputRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [isWorkflowMode, isProjectMode]);

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

  // Image upload functions
  const validateFile = (file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Invalid file type: ${file.type}. Only JPEG, PNG, GIF, and WebP images are allowed.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds 10MB limit: ${(file.size / (1024 * 1024)).toFixed(2)}MB`;
    }
    return null;
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
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      });
    }

    if (newImages.length > 0) {
      setPendingImages(prev => [...prev, ...newImages]);
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
    // Only set isDragging to false if we're leaving the card element
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() || pendingImages.length > 0) {
        handleSubmit();
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

  const handleSubmit = () => {
    if (!isWorkflowMode && (hasText || pendingImages.length > 0)) {
      if (isListening) {
        stopListening();
      }
      resetTranscript();
      
      // Extract files from pending images
      const imageFiles = pendingImages.map(img => img.file);
      
      // Cleanup preview URLs
      pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
      
      // Call onStart with all parameters: text, model, autoMerge, images
      onStart(value.trim(), selectedModel, autoMerge, imageFiles.length > 0 ? imageFiles : undefined);
      
      // Clear state
      setValue("");
      setPendingImages([]);
    }
  };

  const handleClick = () => {
    if (isWorkflowMode) {
      if (isNewWorkflow && onNewWorkflow) {
        onNewWorkflow();
      } else if (matchedWorkflow && onWorkflowSelect) {
        onWorkflowSelect(matchedWorkflow.properties.workflow_id, matchedWorkflow);
      }
    } else if (isProjectMode) {
      if (matchedProject && onProjectSelect) {
        onProjectSelect(projectIdValue.trim(), matchedProject);
      }
    } else {
      handleSubmit();
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

  // Project debugger handlers
  const validateProjectId = useCallback(async (projectId: string) => {
    if (!projectId.trim()) {
      setProjectNotFound(false);
      setMatchedProject(null);
      return;
    }

    setIsValidatingProject(true);
    setProjectNotFound(false);

    try {
      const response = await fetch(`/api/stakwork/projects/${projectId}`);
      const data = await response.json();

      if (response.ok && data.success) {
        setMatchedProject(data.data);
        setProjectNotFound(false);
      } else {
        setMatchedProject(null);
        setProjectNotFound(true);
      }
    } catch (error) {
      console.error("Error validating project:", error);
      setMatchedProject(null);
      setProjectNotFound(true);
    } finally {
      setIsValidatingProject(false);
    }
  }, []);

  const handleProjectInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectIdValue(e.target.value);
    setProjectNotFound(false);
    setMatchedProject(null);
  };

  const handleProjectInputBlur = () => {
    if (projectIdValue.trim()) {
      validateProjectId(projectIdValue.trim());
    }
  };

  const handleProjectKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matchedProject && onProjectSelect) {
        onProjectSelect(projectIdValue.trim(), matchedProject);
      } else if (projectIdValue.trim()) {
        validateProjectId(projectIdValue.trim());
      }
    }
  };

  const projectName = matchedProject?.project?.name || null;

  // Determine if submit button should be enabled
  const isSubmitDisabled = isWorkflowMode
    ? (!matchedWorkflow && !isNewWorkflow) || isLoadingWorkflows || isLoading
    : isProjectMode
    ? !matchedProject || isValidatingProject || isLoading
    : (!hasText && pendingImages.length === 0) || isLoading || noPodsAvailable;

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case "live":
        return { icon: Clock, label: "Async" };
      case "agent":
        return { icon: Bot, label: "Agent" };
      case "workflow_editor":
        return { icon: Workflow, label: "Workflow" };
      case "project_debugger":
        return { icon: Workflow, label: "Project" };
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

  const title = isWorkflowMode ? "Workflow Editor" : isProjectMode ? "Project Debugger" : isPromptsMode ? "Manage Prompts" : "Build Something";

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
                  <SelectItem value="project_debugger">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-3.5 w-3.5" />
                      <span>Project</span>
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
        <div className="w-full max-w-2xl">
          {/* Hidden file input */}
          {isImageUploadEnabled && (
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIME_TYPES.join(',')}
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />
          )}

          {/* Image previews above card */}
          {isImageUploadEnabled && pendingImages.length > 0 && (
            <div className="mb-3 px-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {pendingImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative rounded-lg border overflow-hidden bg-muted aspect-square"
                  >
                    <img
                      src={image.preview}
                      alt={image.filename}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="absolute top-1 right-1 bg-background/80 hover:bg-background rounded-full p-1 transition-colors"
                      aria-label="Remove image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                      <p className="text-xs text-white truncate">{image.filename}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Card 
            className={cn(
              "relative w-full p-0 bg-card rounded-3xl shadow-sm border-0 group",
              isDragging && "ring-2 ring-primary ring-offset-2"
            )}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Drag and drop overlay */}
            {isDragging && isImageUploadEnabled && (
              <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm rounded-3xl z-20 flex items-center justify-center">
                <div className="text-center">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 text-primary" />
                  <p className="text-sm font-medium">Drop images here</p>
                </div>
              </div>
            )}

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
              ) : isProjectMode ? (
                <motion.div
                  key="project"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="min-h-[180px] px-8 pt-8 pb-16"
                >
                  <Input
                    ref={projectInputRef}
                    type="text"
                    placeholder="Enter project ID (e.g., 141652040)"
                    value={projectIdValue}
                    onChange={handleProjectInputChange}
                    onBlur={handleProjectInputBlur}
                    onKeyDown={handleProjectKeyDown}
                    className="text-lg h-12 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 shadow-none"
                    autoFocus
                    data-testid="project-id-input"
                  />
                  {/* Project status messages */}
                  <div className="mt-4 min-h-[24px]">
                    {isValidatingProject && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Validating project...</span>
                      </div>
                    )}
                    {projectNotFound && !isValidatingProject && (
                      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm">Project not found</span>
                      </div>
                    )}
                    {matchedProject && !isValidatingProject && (
                      <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-sm">
                          {projectName || `Project ${projectIdValue}`}
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
                    onPaste={handlePaste}
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
                <SelectItem value="project_debugger">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-3.5 w-3.5" />
                    <span>Project</span>
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
          {/* Image upload button */}
          {isImageUploadEnabled && !isWorkflowMode && (
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
                  >
                    <ImageIcon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add images</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
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
        </div>
      )}

      {/* Auto-merge checkbox for agent mode */}
      {isAgentMode && (
        <div className="w-full max-w-2xl mt-3">
          <TooltipProvider>
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-merge-task-start"
                checked={autoMerge}
                onCheckedChange={(checked) => setAutoMerge(checked === true)}
                data-testid="auto-merge-checkbox"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    htmlFor="auto-merge-task-start"
                    className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  >
                    Auto-merge PR when CI passes
                  </label>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Automatically merge the pull request when all CI checks pass</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
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
