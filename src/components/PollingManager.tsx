"use client";

import { useEffect } from "react";
import { useGenerationPollingStore } from "@/stores/useGenerationPollingStore";

/**
 * PollingManager - Root-level component that manages background polling
 * for pending AI generations (architecture, requirements, etc.)
 *
 * This component should be placed in the root layout to ensure polling
 * continues even when users navigate between pages.
 */
export function PollingManager() {
  const { startPolling, stopPolling } = useGenerationPollingStore();

  useEffect(() => {
    // Start polling when component mounts
    startPolling();

    // Cleanup: stop polling when component unmounts
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // This component doesn't render anything
  return null;
}
