"use client";

import { SwarmSetupHandler } from "@/components/swarm-setup/SwarmSetupHandler";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useState } from "react";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {
  const { workspace } = useWorkspace();
  const [servicesStarted, setServicesStarted] = useState(false);

  console.log('here=====>');
  console.log(workspace?.containerFilesSetUp);
  console.log(workspace?.swarmId);
  console.log(workspace?.swarmStatus);
  console.log(workspace?.ingestRefId);
  console.log(workspace?.poolState);
  console.log(workspace?.repositories);
  console.log('here=====>');

  const setupCompleted = workspace?.containerFilesSetUp;
  const hasSwarmId = !!workspace?.swarmId;

  const showDashboard = setupCompleted || (hasSwarmId && servicesStarted);

  return (
    <div className="space-y-6">
      <SwarmSetupHandler onServicesStarted={setServicesStarted} />

      {showDashboard && <Dashboard setupInProgress={!setupCompleted} />}
    </div>
  );
}