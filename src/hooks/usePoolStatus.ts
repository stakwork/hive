import { useState, useEffect, useCallback } from "react";
import { PoolStatusResponse } from "@/types";

interface UsePoolStatusState {
  poolStatus: PoolStatusResponse | null;
  loading: boolean;
  error: Error | null;
}

const POLL_INTERVAL = 30000;

export function usePoolStatus(slug: string | null | undefined) {
  const [state, setState] = useState<UsePoolStatusState>({
    poolStatus: null,
    loading: false,
    error: null,
  });

  const fetchPoolStatus = useCallback(async () => {
    if (!slug) {
      setState({
        poolStatus: null,
        loading: false,
        error: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(`/api/w/${slug}/pool/status`);

      if (!response.ok) {
        throw new Error(`Failed to fetch pool status: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch pool status");
      }

      setState({
        poolStatus: result.data,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error("Unknown error"),
      }));
    }
  }, [slug]);

  useEffect(() => {
    fetchPoolStatus();

    if (!slug) {
      return;
    }

    const intervalId = setInterval(fetchPoolStatus, POLL_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [slug, fetchPoolStatus]);

  const refetch = useCallback(() => {
    fetchPoolStatus();
  }, [fetchPoolStatus]);

  return {
    ...state,
    refetch,
  };
}
