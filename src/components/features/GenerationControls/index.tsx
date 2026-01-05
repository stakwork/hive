import { Brain, Loader2, FileImage } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowStatus } from "@prisma/client";

interface GenerationControlsProps {
  onQuickGenerate: () => void;
  onDeepThink: () => void;
  onRetry?: () => void;
  status?: WorkflowStatus | null;
  isLoading?: boolean;
  isQuickGenerating?: boolean;
  disabled?: boolean;
  showDeepThink?: boolean;
  showGenerateDiagram?: boolean;
  onGenerateDiagram?: () => void;
  isGeneratingDiagram?: boolean;
}

export function GenerationControls({
  _onQuickGenerate,
  onDeepThink,
  onRetry,
  status,
  isLoading = false,
  isQuickGenerating = false,
  disabled = false,
  showDeepThink = true,
  showGenerateDiagram = false,
  onGenerateDiagram,
  isGeneratingDiagram = false,
}: GenerationControlsProps) {
  const isErrorState =
    status && ["FAILED", "ERROR", "HALTED"].includes(status);
  const isLoadingState =
    status && ["PENDING", "IN_PROGRESS"].includes(status);

  return (
    <div className="flex items-center gap-2">
      {showDeepThink && (
        <Button
          size="sm"
          variant="outline"
          onClick={isErrorState ? onRetry : onDeepThink}
          disabled={
            isLoading ||
            isLoadingState ||
            isQuickGenerating ||
            disabled
          }
          className={isErrorState ? "border-yellow-600/50 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-950/30 dark:hover:bg-yellow-950/50" : ""}
        >
          {isLoadingState ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
              <span className="ml-1.5">Researching...</span>
            </>
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
