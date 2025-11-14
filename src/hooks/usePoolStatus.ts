import { useCallback, useEffect, useState } from "react";
import { PoolStatusResponse } from "@/types/pool-manager";

interface UsePoolStatusResult {
  poolStatus: PoolStatusResponse["status"] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePoolStatus(slug: string | undefined, isPoolActive: boolean): UsePoolStatusResult {
  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPoolStatus = useCallback(async () => {
    if (!slug || !isPoolActive) {
      setLoading(false);
      return;
    }

    setLoading(true);
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
      setLoading(false);
    }
  }, [slug, isPoolActive]);

  useEffect(() => {
    fetchPoolStatus();
  }, [fetchPoolStatus]);

  return {
    poolStatus,
    loading,
    error,
    refetch: fetchPoolStatus,
  };
}
