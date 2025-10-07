"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { SwarmSetupOrchestrator } from "./SwarmSetupOrchestrator";

export function SwarmSetupHandler() {
  const { workspace } = useWorkspace();

  // Repository URL for current operations
  const repositoryUrl = workspace?.repositoryDraft;
  if (!repositoryUrl) {
    return null;
  }

  return <SwarmSetupOrchestrator repositoryUrl={repositoryUrl} />;
}