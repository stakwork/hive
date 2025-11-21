"use client";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { GenerationControls } from "@/components/features/GenerationControls";
import { GenerationPreview } from "@/components/features/GenerationPreview";
import { AIButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "@/components/ui/image-preview";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { useImageUpload } from "@/hooks/useImageUpload";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { Edit, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const [quickGenerating, setQuickGenerating] = useState(false);
  const [initiatingDeepThink, setInitiatingDeepThink] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">(value ? "preview" : "edit");

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

  const handleGenerated = (results: GeneratedContent[]) => {
    if (results.length > 0) {
      aiGeneration.setContent(results[0].content, "quick");
    }
  };

  const handleDeepThink = async () => {
    try {
      setInitiatingDeepThink(true);
      // Use aiGeneration.regenerate() to ensure runId is captured for accept/reject
      await aiGeneration.regenerate();
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
      await aiGeneration.regenerate();
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

  const isErrorState = latestRun?.status &&
    ["FAILED", "ERROR", "HALTED"].includes(latestRun.status);

  const isLoadingState = initiatingDeepThink || (latestRun?.status &&
    ["PENDING", "IN_PROGRESS"].includes(latestRun.status));

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
          <GenerationControls
            onQuickGenerate={() => {}}
            onDeepThink={handleDeepThink}
            onRetry={handleRetry}
            status={latestRun?.status}
            isLoading={aiGeneration.isLoading}
            isQuickGenerating={quickGenerating}
            disabled={false}
            showDeepThink={true}
          />
        )}
        <SaveIndicator
          field={id}
          savedField={savedField}
          saving={saving}
          saved={saved}
        />
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
      )}

      {aiGeneration.content ? (
        <GenerationPreview
          content={aiGeneration.content}
          source={aiGeneration.source || "quick"}
          onAccept={handleAccept}
          onReject={handleReject}
          isLoading={aiGeneration.isLoading}
        />
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
