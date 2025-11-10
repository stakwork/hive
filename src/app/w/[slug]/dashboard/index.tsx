"use client";

import { GraphComponent } from "@/components/knowledge-graph";
import { useGraphPolling } from "@/hooks/useGraphPolling";
import { useWorkspace } from "@/hooks/useWorkspace";
import { logStoreInstances } from "@/stores/createStoreFactory";
import { StoreProvider } from "@/stores/StoreProvider";

export function Dashboard() {
  const { id: workspaceId } = useWorkspace();

  logStoreInstances()

  return (
    <StoreProvider storeId={`workspace-${workspaceId}`}>
      <DashboardInner />
    </StoreProvider>
  );
}

function DashboardInner() {
  useGraphPolling({
    enabled: false,
    interval: 5000
  });


  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 min-h-0">
        <GraphComponent
          endpoint={`graph/search/latest?limit=1000&top_node_count=500`}
          enableRotation={true}
          enablePolling={true}
          height="h-full"
          width="w-full"
          showWidgets={true}
        />
      </div>
    </div>
  );
}
