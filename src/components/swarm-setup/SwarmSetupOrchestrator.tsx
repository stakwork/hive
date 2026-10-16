"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { GitHubAccessManager } from "./GitHubAccessManager";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { useCallback, useState } from "react";

interface SwarmSetupOrchestratorProps {
  repositoryUrl: string;
  onServicesStarted?: (started: boolean) => void;
}

export function SwarmSetupOrchestrator({ repositoryUrl, onServicesStarted }: SwarmSetupOrchestratorProps) {
  const { workspace } = useWorkspace();

  // Setup reads the repo through the GitHub App, so it waits for the access
  // check to pass instead of racing it.
  const [access, setAccess] = useState<"checking" | "granted" | "blocked">("checking");
  const onAccessError = useCallback((error: boolean) => setAccess(error ? "blocked" : "granted"), []);

  return (
    <>
      <GitHubAccessManager onAccessError={onAccessError} repositoryUrl={repositoryUrl} />
      {workspace?.containerFilesSetUp || access !== "granted" ? null : (
        <WorkspaceSetup repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />
      )}
    </>
  );
}
