"use client";

import { GitHubStatusWidget } from "@/components/dashboard/github-status-widget";
import { IngestionStatusWidget } from "@/components/dashboard/ingestion-status-widget";
import { PoolStatusWidget } from "@/components/dashboard/pool-status-widget";
import { GraphComponent } from "@/components/knowledge-graph";
import { WorkspaceMembersPreview } from "@/components/workspace/WorkspaceMembersPreview";
import { useGraphPolling } from "@/hooks/useGraphPolling";
import { useWebhookHighlights } from "@/hooks/useWebhookHighlights";
import { useWorkspace } from "@/hooks/useWorkspace";
import { logStoreInstances } from "@/stores/createStoreFactory";
import { StoreProvider } from "@/stores/StoreProvider";
import { useDataStore } from "@/stores/useStores";

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
  const { slug } = useWorkspace();
  const dataInitial = useDataStore((s) => s.dataInitial);

  useGraphPolling({
    enabled: true,
    interval: 5000
  });

  useWebhookHighlights()


  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 min-h-0">
        <GraphComponent
          endpoint={`graph/search/latest?limit=1000&top_node_count=500`}
          enableRotation={true}
          enablePolling={true}
          height="h-full"
          width="w-full"
          topLeftWidget={
            dataInitial?.nodes && dataInitial.nodes.length > 0 ? (
              <IngestionStatusWidget />
            ) : undefined
          }
          topRightWidget={
            <div className="flex items-center gap-2">
              <GitHubStatusWidget />
              <PoolStatusWidget />
            </div>
          }
          bottomLeftWidget={<WorkspaceMembersPreview workspaceSlug={slug} />}
        />
      </div>
    </div>
  );
}
