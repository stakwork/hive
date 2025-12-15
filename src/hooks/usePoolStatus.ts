import { useCallback, useEffect, useState, useRef } from "react";
import { PoolStatusResponse } from "@/types/pool-manager";

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
  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPoolStatus = useCallback(async (showLoading = true) => {
    if (!slug || !isPoolActive) {
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/w/${slug}/pool/status`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch pool status");
      }

      if (result.success) {
        setPoolStatus(result.data.status);
      } else {
        throw new Error(result.error || "Failed to fetch pool status");
      }
    } catch (err) {
      console.error("Error fetching pool status:", err);
      setError(err instanceof Error ? err.message : "Failed to load pool status");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [slug, isPoolActive]);

  // Initial fetch
  useEffect(() => {
    fetchPoolStatus(true);
  }, [fetchPoolStatus]);

  // Polling effect
  useEffect(() => {
    // Clear any existing timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Set up polling if enabled
    if (pollingInterval > 0 && slug && isPoolActive) {
      const schedulePoll = () => {
        pollingTimeoutRef.current = setTimeout(async () => {
          await fetchPoolStatus(false); // Don't show loading on background polls
          schedulePoll(); // Schedule next poll
        }, pollingInterval);
      };

      schedulePoll();
    }

    // Cleanup
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
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
