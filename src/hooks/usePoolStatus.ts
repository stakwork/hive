import { useCallback, useEffect, useState, useRef } from "react";
import { PoolStatusResponse } from "@/types/pool-manager";
import {
  fetchPoolStatusDeduped,
  registerResumeCallback,
  isDocumentVisible,
} from "./poolStatusStore";

interface UsePoolStatusResult {
  poolStatus: PoolStatusResponse["status"] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UsePoolStatusOptions {
  pollingInterval?: number; // in milliseconds, 0 to disable polling
}

export function usePoolStatus(
  slug: string | undefined,
  isPoolActive: boolean,
  options: UsePoolStatusOptions = {}
): UsePoolStatusResult {
  const { pollingInterval = 0 } = options;
  const [poolStatus, setPoolStatus] = useState<
    PoolStatusResponse["status"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Keep latest values accessible inside callbacks without re-creating them
  const slugRef = useRef(slug);
  const isPoolActiveRef = useRef(isPoolActive);
  slugRef.current = slug;
  isPoolActiveRef.current = isPoolActive;

  const fetchPoolStatus = useCallback(
    async (showLoading = true) => {
      if (!slug || !isPoolActive) {
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const status = await fetchPoolStatusDeduped(slug);
        if (status !== null) {
          setPoolStatus(status);
        }
      } catch (err) {
        console.error("Error fetching pool status:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load pool status"
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [slug, isPoolActive]
  );

  // Initial fetch — unconditional, not visibility-gated
  useEffect(() => {
    fetchPoolStatus(true);
  }, [fetchPoolStatus]);

  // Polling effect — visibility-aware
  useEffect(() => {
    // Clear any existing timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    if (!(pollingInterval > 0 && slug && isPoolActive)) {
      // No polling for interval-0 callers or when gates are closed
      return;
    }

    let unregisterResume: (() => void) | null = null;

    const schedulePoll = () => {
      pollingTimeoutRef.current = setTimeout(async () => {
        // Visibility check: if hidden, stop here — resume callback will restart
        if (!isDocumentVisible()) return;

        await fetchPoolStatus(false); // background poll — no loading spinner
        schedulePoll(); // reschedule next tick
      }, pollingInterval);
    };

    const onResume = () => {
      // Tab became visible: do an immediate refresh then restart the loop
      fetchPoolStatus(false);
      schedulePoll();
    };

    unregisterResume = registerResumeCallback(onResume);
    schedulePoll();

    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      if (unregisterResume) {
        unregisterResume();
        unregisterResume = null;
      }
    };
  }, [pollingInterval, slug, isPoolActive, fetchPoolStatus]);

  return {
    poolStatus,
    loading,
    error,
    refetch: () => fetchPoolStatus(true),
  };
}
