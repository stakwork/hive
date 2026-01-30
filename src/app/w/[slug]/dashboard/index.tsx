"use client";

import { useCallback, useEffect, useRef } from "react";
import { DashboardChat } from "@/components/dashboard/DashboardChat";
import { GitHubStatusWidget } from "@/components/dashboard/github-status-widget";
import { NeedsInputDropdownWidget } from "@/components/dashboard/needs-input-dropdown-widget";
import { PRMetricsWidget } from "@/components/dashboard/pr-metrics-widget";
import { IngestionStatusWidget } from "@/components/dashboard/ingestion-status-widget";
import { PoolStatusWidget } from "@/components/dashboard/pool-status-widget";
import { TestCoverageStats } from "@/components/dashboard/TestCoverageStats";
import { GraphFilterDropdown } from "@/components/graph/GraphFilterDropdown";
import { TestFilterDropdown } from "@/components/graph/TestFilterDropdown";
import { GraphComponent } from "@/components/knowledge-graph";
import { WorkspaceMembersPreview } from "@/components/workspace/WorkspaceMembersPreview";
import { useGraphPolling } from "@/hooks/useGraphPolling";
import { useTasksHighlight } from "@/hooks/useTasksHighlight";
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
  const repositoryNodes = useDataStore((s) => s.repositoryNodes);
  const activeFilterTab = useGraphStore((s) => s.activeFilterTab);
  const setActiveFilterTab = useGraphStore((s) => s.setActiveFilterTab);
  const isOnboarding = useDataStore((s) => s.isOnboarding);

  useGraphPolling({
    enabled: !isOnboarding && activeFilterTab === 'all',
    interval: 5000
  });

  useWebhookHighlights()
  useTasksHighlight({
    workspaceSlug: slug,
    enabled: !!slug,
  });

  // Track "d d d" key sequence for mock highlight trigger
  const keyTimestamps = useRef<number[]>([]);
  const triggerMockHighlight = useCallback(async () => {
    if (!slug) return;
    try {
      await fetch(`/api/mock/vercel/highlight?workspace=${slug}`, { method: "POST" });
    } catch (err) {
      console.error("[Dashboard] Failed to trigger mock highlight:", err);
    }
  }, [slug]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input or if key is being held down
      if (e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (e.key.toLowerCase() !== "d") {
        keyTimestamps.current = [];
        return;
      }

      const now = Date.now();
      keyTimestamps.current.push(now);

      // Keep only timestamps within the last 500ms
      keyTimestamps.current = keyTimestamps.current.filter((t) => now - t < 500);

      console.log("[Dashboard] d pressed, count:", keyTimestamps.current.length);

      // Trigger on 3 rapid "d" presses
      if (keyTimestamps.current.length >= 3) {
        console.log("[Dashboard] Triggering mock highlight");
        keyTimestamps.current = [];
        triggerMockHighlight();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerMockHighlight]);

  const handleFilterChange = (value: FilterTab) => {
    setActiveFilterTab(value);
  };

  const hasNodes = (dataInitial?.nodes && dataInitial.nodes.length > 0) || (repositoryNodes.length > 0);
  const isCentered = !hasNodes && !isOnboarding;

  return (
    <div className="flex flex-col flex-1 h-full relative">
      {/* Ingestion Status widget - transitions from center to top-left */}
      <div className={`absolute z-10 transition-all duration-200 ease-in-out ${isCentered
        ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        : "top-4 left-4"
        }`}>
        <IngestionStatusWidget />
      </div>

      {/* Top-right widgets */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          {(workspace?.poolState === "COMPLETE" || true) && (
            <GraphFilterDropdown
              value={activeFilterTab}
              onValueChange={handleFilterChange}
            />
          )}
          <TestFilterDropdown />
          <NeedsInputDropdownWidget />
          <PRMetricsWidget />
          <GitHubStatusWidget />
          <PoolStatusWidget />
        </div>
        <TestCoverageStats />
      </div>

      {/* Bottom-left widget */}
      <div className="absolute bottom-4 left-4 z-10">
        <WorkspaceMembersPreview workspaceSlug={slug} />
      </div>

      <div className="flex-1 min-h-0">
        <GraphComponent
          endpoint={`graph/search/latest?limit=5000&top_node_count=5000`}
          enableRotation={true}
          enablePolling={true}
          height="h-full"
          width="w-full"
        />
      </div>

      {/* Dashboard Chat - only show when onboarding is complete */}
      {!isOnboarding && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-0" style={{ width: 'calc(100% - 340px)' }}>
          <DashboardChat />
        </div>
      )}
    </div>
  );
}
