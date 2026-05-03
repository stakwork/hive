"use client";

import { SwarmSetupHandler } from "@/components/swarm-setup/SwarmSetupHandler";
import { useWorkspace } from "@/hooks/useWorkspace";
import { StoreProvider } from "@/stores/StoreProvider";
import { useState } from "react";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {
  const { workspace, id, isPublicViewer } = useWorkspace();
  const [servicesStarted, setServicesStarted] = useState(false);

  console.log("/w/[slug]/page =====>", {
    containerFilesSetUp: workspace?.containerFilesSetUp,
    swarmId: workspace?.swarmId,
    swarmStatus: workspace?.swarmStatus,
    ingestRefId: workspace?.ingestRefId,
    poolState: workspace?.poolState,
    repositories: workspace?.repositories,
  });

  const setupCompleted = workspace?.containerFilesSetUp;
  const hasSwarmId = !!workspace?.swarmId;

  // Public viewers can't run swarm setup (it's a write surface and would
  // surface a misleading "GitHub App Not Installed" banner). Always show the
  // dashboard for them and skip the setup handler entirely.
  const showDashboard = isPublicViewer || setupCompleted || (hasSwarmId && servicesStarted);

  if (!id) {
    return null;
  }

  return (
    <StoreProvider storeId={`workspace-${id}`}>
      <div className="h-full relative flex flex-col">
        {!isPublicViewer && <SwarmSetupHandler onServicesStarted={setServicesStarted} />}

        {showDashboard && <Dashboard />}
      </div>
    </StoreProvider>
  );
}
