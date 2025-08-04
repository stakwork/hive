import { useState, useCallback } from "react";
import { poolManagerService } from "@/lib/service-factory";
import { CreatePoolRequest, Pool, ApiError } from "@/types";

interface UsePoolManagerState {
  loading: boolean;
  error: ApiError | null;
}

export function usePoolManager() {
  const [state, setState] = useState<UsePoolManagerState>({
    loading: false,
    error: null,
  });

  const createPool = useCallback(
    async (pool: CreatePoolRequest): Promise<Pool | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const result = await poolManagerService().createPool(pool);
        setState((prev) => ({ ...prev, loading: false }));
        return result;
      } catch (error) {
        const apiError = error as ApiError;
        setState((prev) => ({ ...prev, loading: false, error: apiError }));
        return null;
      }
    },
    [],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    createPool,
    clearError,
  };
}
