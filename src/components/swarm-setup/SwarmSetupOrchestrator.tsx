"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useState } from "react";
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

  if (workspace?.containerFilesSetUp) {
    return null
  }

  // Once we have access, show the workspace setup
  return <WorkspaceSetup repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />
}