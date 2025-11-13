"use client";

import { useIngestStatus } from "@/hooks/useIngestStatus";
import { logger } from "@/lib/logger";

interface IngestionStatusWidgetProps {
  centered?: boolean;
}

export function IngestionStatusWidget({ centered = false }: IngestionStatusWidgetProps) {
  const { isIngesting, statusMessage } = useIngestStatus();

  if (!isIngesting) {
    return null;
  }

  logger.debug("isIngesting---isIngesting--->", "ingestion-status-widget/index", { isIngesting });
  logger.debug("statusMessage---statusMessage--->", "ingestion-status-widget/index", { statusMessage });

  const positionClasses = centered
    ? "relative"
    : "absolute top-4 left-4 z-10";

  return (
    <div className={`${positionClasses} flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card/95 backdrop-blur-sm`}>
      <div className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
        <div className="absolute inset-0 rounded-full border-2 border-muted-foreground/20" />
        <div className="absolute inset-0 rounded-full border-2 border-t-muted-foreground border-r-transparent border-b-transparent border-l-transparent animate-spin" />
      </div>
      <div
        key={statusMessage}
        className="text-xs font-mono text-foreground animate-in fade-in duration-300"
      >
        {statusMessage}
      </div>
    </div>
  );
}
