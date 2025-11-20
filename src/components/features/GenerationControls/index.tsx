import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
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
}

export function GenerationControls({
  onQuickGenerate,
  onDeepThink,
  onRetry,
  status,
  isLoading = false,
  isQuickGenerating = false,
  disabled = false,
  showDeepThink = true,
}: GenerationControlsProps) {
  const isErrorState =
    status && ["FAILED", "ERROR", "HALTED"].includes(status);
  const isLoadingState =
    status && ["PENDING", "IN_PROGRESS"].includes(status);
  const showWorkflowBadge = !!(status && isErrorState);

  return (
    <div className="flex items-center gap-2">
      {showDeepThink && (
        <>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDeepThink}
                  disabled={
                    isLoading ||
                    isLoadingState ||
                    showWorkflowBadge ||
                    isQuickGenerating ||
                    disabled
                  }
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
              <WorkflowStatusBadge status={isErrorState ? "FAILED" : status} />
              {isErrorState && onRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRetry}
                  disabled={isLoading}
                  className="h-6 text-xs px-2"
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}