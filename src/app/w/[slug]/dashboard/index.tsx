"use client";

import { RepositoryCard, TestCoverageCard } from "@/components/dashboard";
import { GraphComponent } from "@/components/knowledge-graph";
import { VMConfigSection } from "@/components/pool-status";
import { PageHeader } from "@/components/ui/page-header";
import { useIngestStatus } from "@/hooks/useIngestStatus";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Loader2 } from "lucide-react";
import { Gitsee } from "../graph/gitsee";

interface DashboardProps {
  setupInProgress?: boolean;
}

export function Dashboard({ setupInProgress = false }: DashboardProps) {

  const { workspace } = useWorkspace();
  const { isIngesting } = useIngestStatus();

  const description = setupInProgress
    ? "Your workspace is being configured. You can start exploring while setup completes in the background."
    : "Welcome to your development workspace.";

  const repository = workspace?.repositories[0];

  return (
    <>
      <PageHeader title="Dashboard" description={description} />

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <VMConfigSection />
        <RepositoryCard />
        <TestCoverageCard />
      </div>

      {isIngesting ? (
        <div className="dark h-auto w-full border rounded-lg p-4 relative bg-card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white">Code Universe</h3>
          </div>
          <div className="border rounded overflow-hidden bg-card">
            <div className="flex h-96 flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <div className="flex flex-col items-center gap-2">
                <div className="text-lg text-gray-300">Ingesting your codebase...</div>
                <div className="text-sm text-gray-500">This usually takes a few minutes</div>
              </div>
            </div>
          </div>
        </div>
      ) : repository?.status === 'SYNCED' || true ? (
        <GraphComponent enablePolling={true} />
      ) : (
        <Gitsee />
      )}
    </>
  );
}