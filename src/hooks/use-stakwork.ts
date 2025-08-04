import { useState, useCallback } from "react";
import { stakworkService } from "@/lib/service-factory";
import { CreateProjectRequest, StakworkProject, ApiError } from "@/types";

interface UseStakworkState {
  loading: boolean;
  error: ApiError | null;
}

export function useStakwork() {
  const [state, setState] = useState<UseStakworkState>({
    loading: false,
    error: null,
  });

  const createProject = useCallback(
    async (project: CreateProjectRequest): Promise<StakworkProject | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const result = await stakworkService().createProject(project);
        setState((prev) => ({ ...prev, loading: false }));
        return result as StakworkProject | null;
      } catch (error) {
        const apiError = error as ApiError;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: apiError,
        }));
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
    createProject,
    clearError,
  };
}
