import { useState, useEffect, useCallback, useMemo } from 'react';
import { WizardStateResponse, WizardStep, Repository, REVERSE_STEP_MAPPING, WizardStateData } from '@/types/wizard';
import { ServicesData } from '@/components/stakgraph/types';
import { EnvironmentVariable } from '@/types/wizard';

interface UseWizardFlowOptions {
  workspaceSlug: string;
}

interface LocalWizardState {
  step: WizardStep;
  selectedRepo: Repository | null;
  searchTerm: string;
  projectName: string;
  repoName: string;
  servicesData: ServicesData;
  envVars: EnvironmentVariable[];
}

interface UseWizardFlowResult {
  // Loading and error states
  loading: boolean;
  error: string | null;
  
  // Swarm state (null if no swarm exists)
  hasSwarm: boolean;
  swarmId?: string;
  swarmName?: string;
  swarmStatus?: string;
  
  // Wizard state
  wizardStep: string | null;
  stepStatus?: string;
  wizardData: Record<string, unknown>;
  
  // Workspace info
  workspaceId?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  
  
  // Swarm management
  createSwarm: (swarmData: Record<string, unknown>) => Promise<void>;
  updateWizardProgress: (data: {
    wizardStep?: string;
    stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    wizardData?: Record<string, unknown>;
  }) => Promise<void>;
  
  // Utilities
  refresh: () => void;
}

const defaultLocalState: LocalWizardState = {
  step: 1,
  selectedRepo: null,
  searchTerm: '',
  projectName: '',
  repoName: '',
  servicesData: { services: [] },
  envVars: [{ key: '', value: '', show: false }],
};

export function useWizardFlow({ workspaceSlug }: UseWizardFlowOptions): UseWizardFlowResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardStateData, setWizardStateData] = useState<WizardStateData | null>(null);

  // Check for existing swarm on load
  const getWizardState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/code-graph/wizard-state?workspace=${encodeURIComponent(workspaceSlug)}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setWizardStateData(data.data);
      } else {
        // No swarm exists or error - start fresh
        setWizardStateData(null);
      }
    } catch (err) {
      console.error('Error checking swarm existence:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setWizardStateData(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    getWizardState();
  }, [getWizardState]);


  // Create swarm and start persisting state
  const createSwarm = useCallback(async (swarmData: Record<string, unknown>) => {
    try {
      // First update the wizard progress to create the swarm record
      const progressResponse = await fetch('/api/code-graph/wizard-progress', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceSlug,
          wizardStep: 'GRAPH_INFRASTRUCTURE',
          stepStatus: 'PROCESSING',
          wizardData: swarmData,
        }),
      });

      if (!progressResponse.ok) {
        throw new Error('Failed to update wizard progress');
      }

      // Refresh to get the new swarm state
      await getWizardState();
    } catch (error) {
      console.error('Error creating swarm:', error);
      throw error;
    }
  }, [workspaceSlug, getWizardState]);


  // Update wizard progress (only works if swarm exists)
  const updateWizardProgress = useCallback(async (data: {
    wizardStep?: string;
    stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    wizardData?: Record<string, unknown>;
  }) => {
    if (!wizardStateData) {
      throw new Error('Cannot update progress without existing swarm');
    }

    console.log("updateWizardProgress>>>>>>", data)

    try {
      const progressResponse = await fetch('/api/code-graph/wizard-progress', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceSlug,
          ...data,
        }),
      });

      if (!progressResponse.ok) {
        throw new Error('Failed to update wizard progress');
      }

      const result = await progressResponse.json();
      
      if (result.success) {
        // Refresh the state to get the updated data
        await getWizardState();
      } else {
        throw new Error(result.message || 'Failed to update wizard progress');
      }
    } catch (error) {
      console.error('Error updating wizard progress:', error);
      throw error;
    }
  }, [workspaceSlug, wizardStateData, getWizardState]);

  const refresh = useCallback(() => {
    getWizardState();
  }, [getWizardState]);

  // Memoized computed values
  const computed = useMemo(() => {
    const hasSwarm = !!wizardStateData;

    if (!hasSwarm) {
      return {
        hasSwarm: false,
        wizardStep: null,
        stepStatus: undefined,
        wizardData: {},
        swarmId: undefined,
        swarmName: undefined,
        swarmStatus: undefined,
        workspaceId: undefined,
        workspaceSlug: undefined,
        workspaceName: undefined,
        user: undefined,
      };
    }


    return {
      hasSwarm: true,
      wizardStep: wizardStateData.wizardStep,
      stepStatus: wizardStateData.stepStatus,
      wizardData: wizardStateData.wizardData,
      swarmId: wizardStateData.swarmId,
      swarmName: wizardStateData.swarmName,
      swarmStatus: wizardStateData.swarmStatus,
      workspaceId: wizardStateData.workspaceId,
      workspaceSlug: wizardStateData.workspaceSlug,
      workspaceName: wizardStateData.workspaceName,
      user: wizardStateData.user,
    };
  }, [wizardStateData]);

  return {
    loading,
    error,
    ...computed,
    createSwarm,
    updateWizardProgress,
    refresh,
  };
}