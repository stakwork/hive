"use client";

import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { AIButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "@/components/ui/image-preview";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useImageUpload } from "@/hooks/useImageUpload";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { Brain, Check, Edit, Eye, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SaveIndicator } from "./SaveIndicator";

interface GeneratedContent {
  content: string;
}

interface AITextareaSectionProps {
  id: string;
  label: string;
  description: string;
  type: "requirements" | "architecture";
  featureId: string;
  value: string | null;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onBlur: (value: string | null) => void;
  rows?: number;
  className?: string;
}

export function AITextareaSection({
  id,
  label,
  description,
  type,
  featureId,
  value,
  savedField,
  saving,
  saved,
  onChange,
  onBlur,
  rows = 8,
  className,
}: AITextareaSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [generatedContent, setGeneratedContent] = useState<string>("");
  const [isStakworkResult, setIsStakworkResult] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [quickGenerating, setQuickGenerating] = useState(false);
  // Default to edit mode when empty, preview mode when has content
  const [mode, setMode] = useState<"edit" | "preview">(value ? "preview" : "edit");

  const { workspace } = useWorkspace();
  const {
    latestRun,
    loading: stakworkLoading,
    createRun,
    acceptRun,
    rejectRun,
  } = useStakworkGeneration({
    featureId,
    type: "ARCHITECTURE", // Only valid type currently
    enabled: type === "architecture",
  });

  // When stakwork run completes, display result
  useEffect(() => {
    if (latestRun?.status === "COMPLETED" && !latestRun.decision && latestRun.result) {
      setGeneratedContent(latestRun.result);
      setIsStakworkResult(true);
      setCurrentRunId(latestRun.id);
    }
  }, [latestRun]);

  const {
    isDragging,
    isUploading,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  } = useImageUpload({
    featureId,
    onImageInserted: (markdownImage) => {
      console.log('Image inserted:', markdownImage);
    },
    onError: (error) => {
      console.error('Image upload error:', error);
      // TODO: Show toast notification
    },
  });

  const handleAccept = async () => {
    if (!generatedContent) return;

    // Optimistic update: Update UI immediately for instant feedback
    onChange(generatedContent);
    onBlur(generatedContent);

    // If stakwork, persist decision to database (async in background)
    if (isStakworkResult && currentRunId) {
      await acceptRun(currentRunId, featureId);
    }

    // Clear state
    setGeneratedContent("");
    setIsStakworkResult(false);
    setCurrentRunId(null);
  };

  const handleReject = async () => {
    if (isStakworkResult && currentRunId) {
      // Stakwork flow: call decision endpoint
      await rejectRun(currentRunId);
    }

    // Clear state
    setGeneratedContent("");
    setIsStakworkResult(false);
    setCurrentRunId(null);
  };

  const handleGenerated = (results: GeneratedContent[]) => {
    if (results.length > 0) {
      setGeneratedContent(results[0].content);
      setIsStakworkResult(false);
      setCurrentRunId(null);
    }
  };

  const handleDeepThink = async () => {
    if (!workspace?.id) return;

    await createRun({
      type: "ARCHITECTURE",
      featureId,
      workspaceId: workspace.id,
    });
  };

  const handleRetry = async () => {
    if (!workspace?.id) return;

    // Mark old run as rejected (cleanup)
    if (currentRunId) {
      await rejectRun(currentRunId, "Retrying after failure");
    }

    // Create new run
    await createRun({
      type: "ARCHITECTURE",
      featureId,
      workspaceId: workspace.id,
    });
  };

  const handleModeSwitch = (newMode: "edit" | "preview") => {
    // If switching from edit to preview, trigger save
    if (mode === "edit" && newMode === "preview") {
      onBlur(value);
    }
    setMode(newMode);
  };

  const isErrorState = latestRun?.status &&
    ["FAILED", "ERROR", "HALTED"].includes(latestRun.status);

  const isLoadingState = latestRun?.status &&
    ["PENDING", "IN_PROGRESS"].includes(latestRun.status);

  // Only show badge for error states (not loading states)
  const showWorkflowBadge = !!(
    latestRun &&
    !latestRun.decision &&
    isErrorState
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <AIButton<GeneratedContent>
          endpoint={`/api/features/${featureId}/generate`}
          params={{ type }}
          onGenerated={handleGenerated}
          onGeneratingChange={setQuickGenerating}
          disabled={isLoadingState || showWorkflowBadge}
          iconOnly
        />
        {type === "architecture" && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDeepThink}
                    disabled={stakworkLoading || isLoadingState || showWorkflowBadge || quickGenerating}
                    className="h-6 w-6 p-0"
                  >
                    {isLoadingState ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
                    ) : (
                      <Brain className="h-3.5 w-3.5 text-purple-600" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Deep Research</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {showWorkflowBadge && (
              <div className="flex items-center gap-2">
                <WorkflowStatusBadge
                  status={isErrorState ? "FAILED" : latestRun.status}
                />
                {isErrorState && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetry}
                    disabled={stakworkLoading}
                    className="h-6 text-xs px-2"
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        <SaveIndicator
          field={id}
          savedField={savedField}
          saving={saving}
          saved={saved}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {description}
      </p>

      {/* AI Suggestion Preview */}
      {generatedContent ? (
        <div className="rounded-md border border-border bg-muted/50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-1" />
            <div className="flex-1 text-sm whitespace-pre-wrap">
              {generatedContent}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAccept}
            >
              <Check className="h-4 w-4 mr-2 text-green-600" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReject}
            >
              <X className="h-4 w-4 mr-2 text-red-600" />
              Reject
            </Button>
          </div>
        </div>
      ) : (
        /* Content Area - Toggle between Edit and Preview */
        <div className="space-y-2">
          <div className="relative">
            {mode === "edit" ? (
              <Textarea
                ref={textareaRef}
                id={id}
                placeholder={`Type your ${label.toLowerCase()} here...`}
                value={value || ""}
                onChange={(e) => onChange(e.target.value)}
                onBlur={(e) => onBlur(e.target.value || null)}
                rows={rows}
                className={cn("resize-y font-mono text-sm min-h-[200px] pr-10", className)}
                isDragging={isDragging}
                isUploading={isUploading}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onPaste={handlePaste}
              />
            ) : (
              <div className={cn(
                "rounded-md border border-border bg-muted/30 p-4 min-h-[200px]",
                !value && "flex items-center justify-center text-sm text-muted-foreground",
                className
              )}>
                {value ? (
                  <MarkdownRenderer size="compact">{value}</MarkdownRenderer>
                ) : (
                  <p>No content yet. Click Edit to add {label.toLowerCase()}.</p>
                )}
              </div>
            )}

            {/* Toggle Buttons - positioned inside content area */}
            <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm border border-border/50 rounded-md p-0.5">
              <Button
                size="sm"
                variant={mode === "preview" ? "secondary" : "ghost"}
                onClick={() => handleModeSwitch("preview")}
                className="h-6 w-6 p-0"
                title="Preview"
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant={mode === "edit" ? "secondary" : "ghost"}
                onClick={() => handleModeSwitch("edit")}
                className="h-6 w-6 p-0"
                title="Edit"
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Image Preview - Only show in edit mode */}
          {mode === "edit" && <ImagePreview content={value} />}
        </div>
      )}
    </div>
  );
}
