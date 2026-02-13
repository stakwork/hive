"use client";

import { useState, useEffect, useRef } from "react";
import { Brain, StopCircle } from "lucide-react";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";

const MIN_DISPLAY_TIME = 1500; // Minimum time each log is shown (ms)
const DEFAULT_MESSAGE = "Processing...";

interface DeepResearchProgressProps {
  projectId: number | null;
  runId: string;
  onStop: () => Promise<void>;
  isStopping?: boolean;
}

export function DeepResearchProgress({ 
  projectId, 
  runId, 
  onStop, 
  isStopping = false 
}: DeepResearchProgressProps) {
  const { logs } = useProjectLogWebSocket(
    projectId ? String(projectId) : null
  );

  const [displayedMessage, setDisplayedMessage] = useState(DEFAULT_MESSAGE);
  const [processedCount, setProcessedCount] = useState(0);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);
  const lastDisplayTimeRef = useRef<number>(Date.now());

  // Process new logs with minimum display time
  useEffect(() => {
    if (logs.length <= processedCount) return;

    const processNextLog = () => {
      const now = Date.now();
      const timeSinceLastDisplay = now - lastDisplayTimeRef.current;

      if (timeSinceLastDisplay >= MIN_DISPLAY_TIME) {
        // Ready to show next log
        const nextLog = logs[processedCount];
        if (nextLog) {
          setDisplayedMessage(nextLog.message);
          setProcessedCount((prev) => prev + 1);
          lastDisplayTimeRef.current = now;
        }
      }
    };

    // Try immediately
    processNextLog();

    // Set up interval to check again
    const interval = setInterval(processNextLog, 100);
    return () => clearInterval(interval);
  }, [logs, processedCount]);

  return (
    <>
      <div className="group relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex flex-col items-center justify-center py-16 px-4">
          {/* Deep Research button with stop functionality */}
          <button
            type="button"
            className="relative mb-4 p-3 rounded-full transition-all duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed"
            onMouseEnter={() => !isStopping && setIsButtonHovered(true)}
            onMouseLeave={() => setIsButtonHovered(false)}
            onClick={() => !isStopping && setShowStopDialog(true)}
            disabled={isStopping}
            aria-label={isStopping ? "Stopping research..." : "Stop deep research"}
          >
            {isStopping ? (
              <Spinner className="h-8 w-8 text-purple-600" />
            ) : isButtonHovered ? (
              <StopCircle className="h-8 w-8 text-red-500" />
            ) : (
              <Brain className="h-8 w-8 text-purple-600 animate-pulse" />
            )}
          </button>

          <h3 className="text-sm font-medium text-foreground mb-2">
            Deep Research
          </h3>

          <p className="text-sm text-muted-foreground text-center max-w-md min-h-[20px] transition-all duration-300">
            {displayedMessage}
          </p>
        </div>
      </div>

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={showStopDialog}
        onOpenChange={setShowStopDialog}
        title="Stop Deep Research?"
        description="This will stop the research in progress and discard all partial results. You can start a new research immediately."
        confirmText="Stop Research"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={async () => {
          await onStop();
          setShowStopDialog(false);
        }}
        testId="stop-research-dialog"
      />
    </>
  );
}
