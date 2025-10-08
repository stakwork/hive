"use client";

import { SwarmSetupHandler } from "@/components/swarm-setup/SwarmSetupHandler";
import { useIngestStatus } from "@/hooks/useIngestStatus";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {

  const { workspace } = useWorkspace();

  const setupCompleted = workspace?.containerFilesSetup;

  useIngestStatus();

  return (
    <div className="space-y-6">
      <SwarmSetupHandler />

      {setupCompleted && <Dashboard />}
    </div>
  );
}