"use client";

import { useState } from "react";
import { Brain, Loader2, FileImage, CircleStop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WorkflowStatus } from "@prisma/client";

interface GenerationControlsProps {
  onQuickGenerate: () => void;
  onDeepThink: () => void;
  onRetry?: () => void;
  onStop?: () => Promise<void>;
  status?: WorkflowStatus | null;
  isLoading?: boolean;
  isQuickGenerating?: boolean;
  isStopping?: boolean;
  disabled?: boolean;
  showDeepThink?: boolean;
  showGenerateDiagram?: boolean;
  onGenerateDiagram?: () => void;
  isGeneratingDiagram?: boolean;
}

export function GenerationControls({
  onQuickGenerate: _onQuickGenerate,
  onDeepThink,
  onRetry,
  onStop,
  status,
  isLoading = false,
  isQuickGenerating = false,
  isStopping = false,
  disabled = false,
  showDeepThink = true,
  showGenerateDiagram = false,
  onGenerateDiagram,
  isGeneratingDiagram = false,
}: GenerationControlsProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [hovered, setHovered] = useState(false);

  const isErrorState =
    status && ["FAILED", "ERROR", "HALTED"].includes(status);
  const isLoadingState =
    status && ["PENDING", "IN_PROGRESS"].includes(status);

  const handleButtonClick = () => {
    if (isStopping) return;
    if (isLoadingState && onStop) {
      setShowStopDialog(true);
      return;
    }
    if (isErrorState) {
      onRetry?.();
      return;
    }
    onDeepThink();
  };

  return (
    <div className="flex items-center gap-2">
      {showDeepThink && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={handleButtonClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            disabled={
              isStopping ||
              isLoading ||
              isQuickGenerating ||
              disabled ||
              (!!isLoadingState && !onStop)
            }
            className={
              isStopping
                ? "border-red-600/50 bg-red-50 dark:bg-red-950/30"
                : isLoadingState && onStop && hovered
                  ? "border-foreground/30"
                  : isErrorState
                    ? "border-yellow-600/50 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-950/30 dark:hover:bg-yellow-950/50"
                    : ""
            }
          >
            {isStopping ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
                <span className="ml-1.5 text-red-600 dark:text-red-400">Stopping...</span>
              </>
            ) : isLoadingState ? (
              <span className="relative inline-flex items-center">
                <span className={`inline-flex items-center ${hovered && onStop ? "invisible" : ""}`}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
                  <span className="ml-1.5">Researching...</span>
                </span>
                {hovered && onStop && (
                  <span className="absolute inset-0 inline-flex items-center">
                    <CircleStop className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="ml-1.5">Stop</span>
                  </span>
                )}
              </span>
            ) : isErrorState ? (
              <>
                <Brain className="h-3.5 w-3.5 text-yellow-700 dark:text-yellow-500" />
                <span className="ml-1.5 text-yellow-700 dark:text-yellow-500">Retry</span>
              </>
            ) : (
              <>
                <Brain className="h-3.5 w-3.5 text-purple-600" />
                <span className="ml-1.5">Deep Research</span>
              </>
            )}
          </Button>

          <ConfirmDialog
            open={showStopDialog}
            onOpenChange={setShowStopDialog}
            title="Stop Deep Research?"
            description="This will stop the research in progress and discard all partial results. You can start a new research immediately."
            confirmText="Stop Research"
            cancelText="Cancel"
            variant="destructive"
            onConfirm={async () => {
              if (onStop) {
                await onStop();
              }
              setShowStopDialog(false);
            }}
            testId="stop-research-dialog"
          />
        </>
      )}
      {showGenerateDiagram && onGenerateDiagram && (
        <Button
          size="sm"
          variant="outline"
          onClick={onGenerateDiagram}
          disabled={isGeneratingDiagram || disabled}
        >
          {isGeneratingDiagram ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="ml-1.5">Generating Diagram...</span>
            </>
          ) : (
            <>
              <FileImage className="h-3.5 w-3.5" />
              <span className="ml-1.5">Generate Diagram</span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}
