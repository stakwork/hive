"use client";

import { useState } from "react";
import { GitHubAccessManager } from "./GitHubAccessManager";
import { WorkspaceSetup } from "./WorkspaceSetup";

interface SwarmSetupOrchestratorProps {
  repositoryUrl: string;
}

export function SwarmSetupOrchestrator({ repositoryUrl }: SwarmSetupOrchestratorProps) {
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

  // Once we have access, show the workspace setup
  return <WorkspaceSetup repositoryUrl={repositoryUrl} />
}