"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { SwarmSetupOrchestrator } from "./SwarmSetupOrchestrator";

interface SwarmSetupHandlerProps {
  onServicesStarted?: (started: boolean) => void;
}

export function SwarmSetupHandler({ onServicesStarted }: SwarmSetupHandlerProps) {
  const { workspace } = useWorkspace();

  // Repository URL for current operations
  const repositoryUrl = workspace?.repositoryDraft;
  if (!repositoryUrl) {
    return null;
  }

  return <SwarmSetupOrchestrator repositoryUrl={repositoryUrl} onServicesStarted={onServicesStarted} />;
}
