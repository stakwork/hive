"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { GitHubAccessManager } from "./GitHubAccessManager";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { useState } from "react";

interface SwarmSetupOrchestratorProps {
  repositoryUrl: string;
  onServicesStarted?: (started: boolean) => void;
}

export function SwarmSetupOrchestrator({ repositoryUrl, onServicesStarted }: SwarmSetupOrchestratorProps) {
  const { workspace } = useWorkspace();

  const [hasAccessError, setHasAccessError] = useState(false);


  return (
    <>
      <GitHubAccessManager
        onAccessError={setHasAccessError}
        repositoryUrl={repositoryUrl}
      />
      {(workspace?.containerFilesSetUp || hasAccessError) ? null : <WorkspaceSetup repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />}
    </>)
}