"use client";

import { GraphComponent } from "@/components/knowledge-graph";

interface DashboardProps {
  setupInProgress?: boolean;
}

export function Dashboard({ setupInProgress = false }: DashboardProps) {
  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 min-h-0">
        <GraphComponent enableRotation={true} enablePolling={true} height="h-full" width="w-full" showWidgets={true} />
      </div>
    </div>
  );
}