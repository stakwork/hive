import { useState, useEffect, useCallback, useMemo } from 'react';
import { WizardStateResponse } from '@/types/wizard';

interface UseWizardStateOptions {
  workspaceSlug: string;
}

interface UseWizardStateResult {
  loading: boolean;
  error: string | null;
  wizardStep: string | null;
  stepStatus?: string;
  wizardData: Record<string, unknown>;
  swarmId?: string;
  swarmStatus?: string;
  workspaceId?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  refresh: () => void;
  updateWizardProgress: (data: {
    wizardStep?: string;
    stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    wizardData?: Record<string, unknown>;
  }) => Promise<void>;
}

export function useWizardState({ workspaceSlug }: UseWizardStateOptions): UseWizardStateResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<WizardStateResponse | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("*************************")
      const res = await fetch(`/api/code-graph/wizard-state?workspace=${encodeURIComponent(workspaceSlug)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Failed to fetch wizard state');
        setResponse(null);
      } else {
        setResponse(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const refresh = useCallback(() => {
    fetchState();
  }, [fetchState]);

  const updateWizardProgress = useCallback(async (data: {
    wizardStep?: string;
    stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    wizardData?: Record<string, unknown>;
  }) => {
    try {
      const response = await fetch('/api/code-graph/wizard-progress', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceSlug,
          ...data,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update wizard progress');
      }

      const result = await response.json();
      
      if (result.success) {
        // Refresh the state to get the updated data
        refresh();
      } else {
        throw new Error(result.message || 'Failed to update wizard progress');
      }
    } catch (error) {
      console.error('Error updating wizard progress:', error);
      throw error;
    }
  }, [workspaceSlug, refresh]);

  const memoized = useMemo(() => {
    if (!response?.success || !response.data) {
      return {
        wizardStep: null,
        stepStatus: undefined,
        wizardData: {},
        swarmId: undefined,
        swarmStatus: undefined,
        workspaceId: undefined,
        workspaceSlug: undefined,
        workspaceName: undefined,
        user: undefined
      };
    }
    return {
      wizardStep: response.data.wizardStep,
      stepStatus: response.data.stepStatus,
      wizardData: response.data.wizardData,
      swarmId: response.data.swarmId,
      swarmStatus: response.data.swarmStatus,
      workspaceId: response.data.workspaceId,
      workspaceSlug: response.data.workspaceSlug,
      workspaceName: response.data.workspaceName,
      user: response.data.user
    };
  }, [response]);

  return {
    loading,
    error,
    ...memoized,
    refresh,
    updateWizardProgress,
  };
} 