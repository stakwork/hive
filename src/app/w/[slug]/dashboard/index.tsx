"use client";

import { GitHubStatusWidget } from "@/components/dashboard/github-status-widget";
import { IngestionStatusWidget } from "@/components/dashboard/ingestion-status-widget";
import { PoolStatusWidget } from "@/components/dashboard/pool-status-widget";
import { GraphFilterDropdown } from "@/components/graph/GraphFilterDropdown";
import { GraphComponent } from "@/components/knowledge-graph";
import { WorkspaceMembersPreview } from "@/components/workspace/WorkspaceMembersPreview";
import { useGraphPolling } from "@/hooks/useGraphPolling";
import { useWebhookHighlights } from "@/hooks/useWebhookHighlights";
import { useWorkspace } from "@/hooks/useWorkspace";
import { logStoreInstances } from "@/stores/createStoreFactory";
import { FilterTab } from "@/stores/graphStore.types";
import { StoreProvider } from "@/stores/StoreProvider";
import { useDataStore, useGraphStore } from "@/stores/useStores";

export function Dashboard() {
  const { id } = useWorkspace();

  logStoreInstances()

  return (
    <StoreProvider storeId={`workspace-${id}`}>
      <DashboardInner />
    </StoreProvider>
  );
}

function DashboardInner() {
  const { slug, workspace } = useWorkspace();
  const dataInitial = useDataStore((s) => s.dataInitial);
  const activeFilterTab = useGraphStore((s) => s.activeFilterTab);
  const setActiveFilterTab = useGraphStore((s) => s.setActiveFilterTab);

  useGraphPolling({
    enabled: activeFilterTab === 'all',
    interval: 5000
  });

  useWebhookHighlights()

  const handleFilterChange = (value: FilterTab) => {
    setActiveFilterTab(value);
  };

  const hasNodes = dataInitial?.nodes && dataInitial.nodes.length > 0;
  const isCentered = !hasNodes;

  return (
    <div className="flex flex-col flex-1 h-full relative">
      {/* Ingestion Status Widget with transition */}
      <div className={`absolute z-10 transition-all duration-200 ease-in-out ${isCentered
        ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        : "top-4 left-4"
        }`}>
        <IngestionStatusWidget />
      </div>

      {/* Top-right widgets */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {(workspace?.poolState === "COMPLETE" || true) && (
          <GraphFilterDropdown
            value={activeFilterTab}
            onValueChange={handleFilterChange}
          />
        )}
        <GitHubStatusWidget />
        <PoolStatusWidget />
      </div>

      {/* Bottom-left widget */}
      <div className="absolute bottom-4 left-4 z-10">
        <WorkspaceMembersPreview workspaceSlug={slug} />
      </div>

      {/* Graph Component */}
      <div className="flex-1 min-h-0">
        <GraphComponent
          endpoint={`graph/search/latest?limit=1000&top_node_count=500`}
          enableRotation={true}
          enablePolling={true}
          height="h-full"
          width="w-full"
        />
      </div>
    </div>
  );
}
