"use client";

import { useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { GitHubAccessManager } from "./GitHubAccessManager";
import { WorkspaceSetup } from "./WorkspaceSetup";

interface SwarmSetupOrchestratorProps {
  repositoryUrl: string;
  onServicesStarted?: (started: boolean) => void;
}

export function SwarmSetupOrchestrator({ repositoryUrl, onServicesStarted }: SwarmSetupOrchestratorProps) {
  const { workspace } = useWorkspace();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string>();

  // Handle repository access check result
  const handleAccessResult = (hasAccess: boolean, error?: string) => {
    console.log("Access check result:", { hasAccess, error });
    setAccessError(error);
    setHasAccess(hasAccess);
  };

  // If container files are already set up, skip access manager and go directly to workspace setup
  if (workspace?.containerFilesSetUp) {
    return <WorkspaceSetup repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />
  }

  // If we don't have access yet, show the access manager
  if (!hasAccess) {
    return (
      <GitHubAccessManager
        repositoryUrl={repositoryUrl}
        onAccessResult={handleAccessResult}
        error={accessError}
      />
    );
  }

  // Once we have access, show the workspace setup
  return <WorkspaceSetup repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />
}