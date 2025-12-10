"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";
import { GenerationControls } from "@/components/features/GenerationControls";
import { GenerationPreview } from "@/components/features/GenerationPreview";
import { DeepResearchProgress } from "@/components/features/DeepResearchProgress";
import { DiagramViewer } from "@/components/features/DiagramViewer";
import { AIButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "@/components/ui/image-preview";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { useImageUpload } from "@/hooks/useImageUpload";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { isClarifyingQuestions, type ClarifyingQuestionsResponse } from "@/types/stakwork";
import { Edit, Eye } from "lucide-react";
import { toast } from "sonner";
import { SaveIndicator } from "./SaveIndicator";

interface GeneratedContent {
  content: string;
}

interface AITextareaSectionProps {
  id: string;
  label: string;
  description?: string;
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
  initialDiagramUrl?: string | null;
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
  initialDiagramUrl = null,
}: AITextareaSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [quickGenerating, setQuickGenerating] = useState(false);
  const [initiatingDeepThink, setInitiatingDeepThink] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">(value ? "preview" : "edit");
  const [diagramUrl, setDiagramUrl] = useState<string | null>(initialDiagramUrl);
  const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);

  const { workspace } = useWorkspace();
  const { latestRun, refetch } = useStakworkGeneration({
    featureId,
    type: "ARCHITECTURE",
    enabled: type === "architecture",
  });

  const aiGeneration = useAIGeneration({
    featureId,
    workspaceId: workspace?.id || "",
    type: "ARCHITECTURE",
    displayName: type, // Pass the actual type for correct toast messages
    enabled: true, // Enable for both requirements and architecture (accept/reject for quick generation)
  });

  useEffect(() => {
    if (latestRun?.status === "COMPLETED" && !latestRun.decision && latestRun.result) {
      aiGeneration.setContent(latestRun.result, "deep", latestRun.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun]); // aiGeneration.setContent is stable (useCallback), safe to omit

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
    },
  });

  const handleAccept = async () => {
    if (!aiGeneration.content) return;

    onChange(aiGeneration.content);
    onBlur(aiGeneration.content);

    await aiGeneration.accept();
  };

  const handleReject = async () => {
    await aiGeneration.reject();
  };

  const handleProvideFeedback = async (feedback: string) => {
    await aiGeneration.provideFeedback(feedback);
  };

  const handleGenerated = (results: GeneratedContent[]) => {
    if (results.length > 0) {
      aiGeneration.setContent(results[0].content, "quick");
    }
  };

  const handleDeepThink = async () => {
    try {
      setInitiatingDeepThink(true);
      // Use aiGeneration.regenerate() to ensure runId is captured for accept/reject
      await aiGeneration.regenerate(false);
      // Immediately fetch the newly created run to show loading state
      await refetch();
    } catch (error) {
      console.error("Deep think failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
  };

  const handleRetry = async () => {
    try {
      setInitiatingDeepThink(true);
      await aiGeneration.regenerate(true);
      // Immediately fetch the newly created run to show loading state
      await refetch();
    } catch (error) {
      console.error("Retry failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
  };

  const handleModeSwitch = (newMode: "edit" | "preview") => {
    if (mode === "edit" && newMode === "preview") {
      onBlur(value);
    }
    setMode(newMode);
  };

  const handleGenerateDiagram = async (retryCount = 0) => {
    if (!featureId || !value?.trim()) {
      toast.error("Cannot generate diagram", { 
        description: "Architecture text is required to generate a diagram." 
      });
      return;
    }

    setIsGeneratingDiagram(true);
    try {
      const response = await fetch(`/api/features/${featureId}/diagram/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        let errorMessage = "Failed to generate diagram";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const error = await response.json();
            errorMessage = error.message || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = text || `Server error: ${response.status} ${response.statusText}`;
          }
        } catch (parseError) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setDiagramUrl(data.diagramUrl);
      
      toast("Diagram generated successfully", { 
        description: "Your architecture diagram is ready." 
      });
    } catch (error) {
      console.error("Diagram generation error:", error);
      
      // Retry mechanism - max 2 retries
      if (retryCount < 2) {
        toast("Retrying diagram generation", { 
          description: `Attempt ${retryCount + 2} of 3...` 
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        return handleGenerateDiagram(retryCount + 1);
      }
      
      toast.error("Failed to generate diagram", { 
        description: error instanceof Error ? error.message : "An unexpected error occurred. Please try again." 
      });
    } finally {
      setIsGeneratingDiagram(false);
    }
  };

  const isErrorState = latestRun?.status &&
    ["FAILED", "ERROR", "HALTED"].includes(latestRun.status);

  const isLoadingState = initiatingDeepThink || (latestRun?.status &&
    ["PENDING", "IN_PROGRESS"].includes(latestRun.status));

  const showWorkflowBadge = !!(
    latestRun &&
    !latestRun.decision &&
    isErrorState
  );

  // Detect if the content is clarifying questions from StakWork
  const parsedContent = useMemo(() => {
    if (!aiGeneration.content) return null;
    try {
      const parsed = JSON.parse(aiGeneration.content);
      if (isClarifyingQuestions(parsed)) {
        return { type: "questions" as const, data: parsed as ClarifyingQuestionsResponse };
      }
    } catch {
      // Not JSON, treat as regular content
    }
    return { type: "content" as const, data: aiGeneration.content };
  }, [aiGeneration.content]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="text-base font-semibold">
            {label}
          </Label>
          <SaveIndicator
            field={id}
            savedField={savedField}
            saving={saving}
            saved={saved}
          />
        </div>
        <div className="flex items-center gap-2">
          <AIButton<GeneratedContent>
            endpoint={`/api/features/${featureId}/generate`}
            params={{ type }}
            onGenerated={handleGenerated}
            onGeneratingChange={setQuickGenerating}
            disabled={isLoadingState || showWorkflowBadge}
            label="Generate"
          />
          {type === "architecture" && (
            <GenerationControls
              onQuickGenerate={() => {}}
              onDeepThink={handleDeepThink}
              onRetry={handleRetry}
              status={latestRun?.status}
              isLoading={aiGeneration.isLoading}
              isQuickGenerating={quickGenerating}
              disabled={false}
              showDeepThink={true}
              showGenerateDiagram={mode === "preview" && !!value?.trim()}
              onGenerateDiagram={handleGenerateDiagram}
              isGeneratingDiagram={isGeneratingDiagram}
            />
          )}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
      )}

      {latestRun?.status === "IN_PROGRESS" && latestRun.projectId ? (
        <DeepResearchProgress projectId={latestRun.projectId} />
      ) : parsedContent?.type === "questions" ? (
        <ClarifyingQuestionsPreview
          questions={parsedContent.data.content}
          onSubmit={(formattedAnswers) => handleProvideFeedback(formattedAnswers)}
          isLoading={aiGeneration.isLoading}
        />
      ) : parsedContent?.type === "content" ? (
        <GenerationPreview
          content={parsedContent.data}
          source={aiGeneration.source || "quick"}
          onAccept={handleAccept}
          onReject={handleReject}
          onProvideFeedback={type === "architecture" ? handleProvideFeedback : undefined}
          isLoading={aiGeneration.isLoading}
        />
      ) : (
        /* Content Area - Toggle between Edit and Preview */
        <div className="space-y-2">
          <div className="relative">
            {mode === "edit" ? (
              <>
                {/* Sticky Toggle Button - overlaid, doesn't affect layout */}
                <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleModeSwitch("preview")}
                        className="pointer-events-auto h-8 w-8 p-0 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/90 mt-2 mr-2"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Preview markdown
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Textarea
                  ref={textareaRef}
                  id={id}
                  placeholder={`Type your ${label.toLowerCase()} here...`}
                  value={value || ""}
                  onChange={(e) => onChange(e.target.value)}
                  onBlur={(e) => onBlur(e.target.value || null)}
                  rows={rows}
                  className={cn("resize-y font-mono text-sm min-h-[200px] pr-12", className)}
                  isDragging={isDragging}
                  isUploading={isUploading}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onPaste={handlePaste}
                />
              </>
            ) : (
              <>
                {/* Sticky Toggle Button - overlaid, doesn't affect layout */}
                <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleModeSwitch("edit")}
                        className="pointer-events-auto h-8 w-8 p-0 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/90 mt-2 mr-2"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Edit content
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className={cn(
                  "rounded-md border border-border bg-muted/30 p-4 min-h-[200px] pr-12",
                  !value && "flex items-center justify-center text-sm text-muted-foreground",
                  className
                )}>
                  {value ? (
                    <MarkdownRenderer size="compact">{value}</MarkdownRenderer>
                  ) : (
                    <p>No content yet. Click Edit to add {label.toLowerCase()}.</p>
                  )}
                </div>
                
                {/* Diagram Viewer - Only show in preview mode for architecture */}
                {type === "architecture" && (
                  <div className="mt-6">
                    <DiagramViewer 
                      diagramUrl={diagramUrl} 
                      isGenerating={isGeneratingDiagram} 
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Image Preview - Only show in edit mode */}
          {mode === "edit" && <ImagePreview content={value} />}
        </div>
      )}
    </div>
  );
}
