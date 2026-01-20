"use client";

import { DashboardChat } from "@/components/dashboard/DashboardChat";
import { GitHubStatusWidget } from "@/components/dashboard/github-status-widget";
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
import { useEffect, useRef, useState } from "react";

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

  // Refs for measuring element widths
  const leftElementRef = useRef<HTMLDivElement>(null);
  const rightElementRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState<number>(0);

  useGraphPolling({
    enabled: !isOnboarding && activeFilterTab === 'all',
    interval: 5000
  });

  useWebhookHighlights()
  useTasksHighlight({
    workspaceSlug: slug,
    enabled: !!slug,
  });

  const handleFilterChange = (value: FilterTab) => {
    setActiveFilterTab(value);
  };

  // Calculate dynamic width for DashboardChat
  useEffect(() => {
    const calculateWidth = () => {
      const viewportWidth = window.innerWidth;
      const leftWidth = leftElementRef.current?.getBoundingClientRect().width || 0;
      const rightWidth = rightElementRef.current?.getBoundingClientRect().width || 0;
      
      // Account for: left padding (16px) + right padding (16px) + margins between elements (32px total)
      const horizontalSpacing = 16 + 16 + 16 + 16; // left-4 + right-4 + gap between elements
      const calculatedWidth = viewportWidth - leftWidth - rightWidth - horizontalSpacing;
      
      // Ensure minimum width and don't exceed viewport
      const finalWidth = Math.max(300, Math.min(calculatedWidth, viewportWidth - 100));
      setChatWidth(finalWidth);
    };

    // Calculate on mount and when dependencies change
    calculateWidth();

    // Recalculate on window resize
    window.addEventListener('resize', calculateWidth);
    
    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('resize', calculateWidth);
    };
  }, [isOnboarding]); // Recalculate when onboarding state changes

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
          <GitHubStatusWidget />
          <PoolStatusWidget />
        </div>
        <TestCoverageStats />
      </div>

      {/* Bottom-left widget */}
      <div ref={leftElementRef} className="absolute bottom-4 left-4 z-10">
        <WorkspaceMembersPreview workspaceSlug={slug} />
      </div>

      {/* Bottom-right widget (ActionsToolbar rendered inside GraphComponent) */}
      <div ref={rightElementRef} className="absolute bottom-4 right-4 z-10 pointer-events-none" id="actions-toolbar-measure">
        {/* This invisible div measures the space taken by ActionsToolbar */}
        <div className="flex flex-col items-end">
          <div className="flex flex-col gap-1">
            <div className="w-10 h-10" /> {/* CameraRecenterControl placeholder */}
          </div>
          <div className="flex items-center flex-row mt-4">
            <div className="w-[120px] h-10" /> {/* GraphViewControl placeholder */}
          </div>
        </div>
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
      {!isOnboarding && chatWidth > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-0" style={{ width: `${chatWidth}px` }}>
          <DashboardChat />
        </div>
      )}
    </div>
  );
}
