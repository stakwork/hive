"use client";

import { SwarmSetupHandler } from "@/components/swarm-setup/SwarmSetupHandler";
import { useWorkspace } from "@/hooks/useWorkspace";
import { StoreProvider } from "@/stores/StoreProvider";
import { useState } from "react";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {
  const { workspace, id } = useWorkspace();
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

  const showDashboard = setupCompleted || (hasSwarmId && servicesStarted);

  if (!id) {
    return null;
  }

  return (
    <StoreProvider storeId={`workspace-${id}`}>
      <div className="h-full relative flex flex-col">
        <SwarmSetupHandler onServicesStarted={setServicesStarted} />

        {showDashboard && <Dashboard />}
      </div>
    </StoreProvider>
  );
}
