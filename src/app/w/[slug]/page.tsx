"use client";

import { SwarmSetupHandler } from "@/components/swarm-setup/SwarmSetupHandler";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useState } from "react";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {
  const { workspace } = useWorkspace();
  const [servicesStarted, setServicesStarted] = useState(false);

  const setupCompleted = workspace?.containerFilesSetUp;
  const hasSwarmId = !!workspace?.swarmId;

  const showDashboard = setupCompleted || (hasSwarmId && servicesStarted);

  return (
    <div className="h-full flex flex-col">
      <SwarmSetupHandler onServicesStarted={setServicesStarted} />

      {showDashboard && <Dashboard />}
    </div>
  );
}