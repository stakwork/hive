"use client";

import { GraphComponent } from "@/components/knowledge-graph";
import { useIngestStatus } from "@/hooks/useIngestStatus";
import { Loader2 } from "lucide-react";

interface DashboardProps {
  setupInProgress?: boolean;
}

export function Dashboard({ setupInProgress = false }: DashboardProps) {
  const { isIngesting, statusMessage } = useIngestStatus();

  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 min-h-0">
        {isIngesting ? (
          <div className="dark h-full w-full border rounded-lg relative bg-card flex flex-col">
            <div className="border rounded overflow-hidden bg-card flex-1 flex">
              <div className="flex w-full flex-col items-center justify-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                <div className="flex flex-col items-center gap-2">
                  <div className="text-lg text-gray-300">{statusMessage}</div>
                  <div className="text-sm text-gray-500">This usually takes a few minutes</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <GraphComponent enablePolling={true} height="h-full" width="w-full" />
        )}
      </div>
    </div>
  );
}