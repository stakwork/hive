import { useCallback, useEffect, useRef, useState } from "react";
import { FRONTEND_CONFIG } from "@/lib/pods/constants";

interface UseFrontendReadyCheckOptions {
  /** Whether to enable polling */
  enabled: boolean;
  /** Workspace ID for the pod */
  workspaceId?: string;
  /** Pod ID for the pod */
  podId?: string;
  /** Polling interval in milliseconds (default: from FRONTEND_CONFIG) */
  interval?: number;
  /** Maximum number of polling attempts (default: from FRONTEND_CONFIG) */
  maxAttempts?: number;
  /** Callback when frontend becomes ready */
  onReady?: () => void;
}

/**
 * Hook to poll the frontend service status endpoint and track when it becomes ready
 */
export function useFrontendReadyCheck({
  enabled,
  workspaceId,
  podId,
  interval = FRONTEND_CONFIG.POLLING_INTERVAL_MS,
  maxAttempts = FRONTEND_CONFIG.MAX_STARTUP_ATTEMPTS,
  onReady,
}: UseFrontendReadyCheckOptions) {
  const [isReady, setIsReady] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRequestInProgress = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Check frontend status
  const checkFrontendStatus = useCallback(async () => {
    if (!workspaceId || !podId || !enabled || isRequestInProgress.current || isReady) return;

    isRequestInProgress.current = true;
    setIsChecking(true);

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/pool-manager/check-pod-frontend/${workspaceId}?podId=${podId}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.isReady) {
        setIsReady(true);
        setError(null);
        
        // Stop polling when ready
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        // Call onReady callback
        if (onReady) {
          onReady();
        }
      } else {
        // Increment attempt count
        setAttemptCount((prev) => prev + 1);
      }
    } catch (err) {
      // Don't log error if request was aborted
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to check frontend status:", err);
        setError(err.message);
        setAttemptCount((prev) => prev + 1);
      }
    } finally {
      isRequestInProgress.current = false;
      setIsChecking(false);
      abortControllerRef.current = null;
    }
  }, [workspaceId, podId, enabled, isReady, onReady]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    isRequestInProgress.current = false;
    setIsChecking(false);
  }, []);

  // Start polling when enabled
  useEffect(() => {
    if (!enabled || !workspaceId || !podId || isReady || pollIntervalRef.current) {
      return;
    }

    // Start immediate check
    checkFrontendStatus();

    // Set up interval for subsequent checks
    pollIntervalRef.current = setInterval(() => {
      checkFrontendStatus();
    }, interval);

    return () => {
      stopPolling();
    };
  }, [enabled, workspaceId, podId, isReady, interval, checkFrontendStatus, stopPolling]);

  // Stop polling if max attempts reached
  useEffect(() => {
    if (attemptCount >= maxAttempts && pollIntervalRef.current && !isReady) {
      console.warn(`Frontend ready check: Max attempts (${maxAttempts}) reached`);
      setError(`Frontend did not become ready after ${maxAttempts} attempts`);
      stopPolling();
    }
  }, [attemptCount, maxAttempts, isReady, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    /** Whether the frontend is ready */
    isReady,
    /** Whether a check is currently in progress */
    isChecking,
    /** Number of check attempts made */
    attemptCount,
    /** Error message if any */
    error,
    /** Manually trigger a status check */
    checkStatus: checkFrontendStatus,
    /** Stop the polling */
    stopPolling,
  };
}
