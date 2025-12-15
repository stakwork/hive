"use client";

import { useState, useEffect, useRef } from "react";
import { Brain } from "lucide-react";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";

const MIN_DISPLAY_TIME = 1500; // Minimum time each log is shown (ms)
const DEFAULT_MESSAGE = "Processing...";

interface DeepResearchProgressProps {
  projectId: number | null;
}

export function DeepResearchProgress({ projectId }: DeepResearchProgressProps) {
  const { logs } = useProjectLogWebSocket(
    projectId ? String(projectId) : null
  );

  const [displayedMessage, setDisplayedMessage] = useState(DEFAULT_MESSAGE);
  const [processedCount, setProcessedCount] = useState(0);
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
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="relative mb-4">
          <Brain className="h-8 w-8 text-purple-600 animate-pulse" />
        </div>

        <h3 className="text-sm font-medium text-foreground mb-2">
          Deep Research
        </h3>

        <p className="text-sm text-muted-foreground text-center max-w-md min-h-[20px] transition-all duration-300">
          {displayedMessage}
        </p>
      </div>
    </div>
  );
}
