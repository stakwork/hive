import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { WizardStateData, WizardStep } from '@/types/wizard';
import { Repository } from '@/types';
import { EnvironmentVariable } from '@/types/wizard';
import { ServiceDataConfig } from '@/components/stakgraph/types';

type WizardStepStatus = 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

const initialState = {
  loading: false,
  error: null,
  currentStep: 'WELCOME',
  currentStepStatus: 'PENDING',
  selectedRepo: null,
  searchTerm: '',
  projectName: '',
  workspaceSlug: '',
  repoName: '',
  workspaceId: '',
  services: [],
  envVars: [],
  hasKey: false,
  swarmIsLoading: false,
  ingestRefId: '',
  poolName: '',
  swarmId: '',
}

export const STEPS_ARRAY = [
  'WELCOME',
  'REPOSITORY_SELECT',
  'PROJECT_NAME',
  'GRAPH_INFRASTRUCTURE',
  'INGEST_CODE',
  'ADD_SERVICES',
  'ENVIRONMENT_SETUP',
  'REVIEW_POOL_ENVIRONMENT',
  'STAKWORK_SETUP',
  'COMPLETION',
]

export type TWizardStep = (typeof STEPS_ARRAY)[number];

export const steps = {
  'WELCOME': 1,
  'REPOSITORY_SELECT': 2,
  'PROJECT_NAME': 3,
  'GRAPH_INFRASTRUCTURE': 4,
  'INGEST_CODE': 5,
  'ADD_SERVICES': 6,
  'ENVIRONMENT_SETUP': 7,
  'REVIEW_POOL_ENVIRONMENT': 8,
  'STAKWORK_SETUP': 9,
  'COMPLETION': 10,
}

export const reverseSteps = {
  1: 'WELCOME',
  2: 'REPOSITORY_SELECT',
  3: 'PROJECT_NAME',
  4: 'GRAPH_INFRASTRUCTURE',
  5: 'INGEST_CODE',
  6: 'ADD_SERVICES',
  7: 'ENVIRONMENT_SETUP',
  8: 'REVIEW_POOL_ENVIRONMENT',
  9: 'STAKWORK_SETUP',
  10: 'COMPLETION',
}

type WizardStore = {
  // Backend state
  loading: boolean;
  error: string | null;

  // Local UI state
  currentStep: (typeof STEPS_ARRAY)[number];
  currentStepStatus: WizardStepStatus | string;
  selectedRepo: Repository | null;
  searchTerm: string;
  projectName: string;
  poolName: string;
  repoName: string;
  services: ServiceDataConfig[];
  envVars: EnvironmentVariable[];
  wizardStep: string | null;
  hasSwarm: boolean;
  workspaceSlug: string;
  workspaceId: string;
  hasKey: boolean;
  swarmIsLoading: boolean;
  ingestRefId: string;

  swarmId?: string;
  swarmName?: string;
  swarmStatus?: string;
  workspaceName?: string;

  // Actions
  fetchWizardState: () => Promise<void>;
  createSwarm: () => Promise<void>;
  setIngestRefId: (id: string) => void;
  setSwarmIsLoading: (isLoading: boolean) => void;
  updateWizardProgress: (data: {
    wizardStep?: string;
    stepStatus?: WizardStepStatus;
    wizardData?: Record<string, unknown>;
  }) => Promise<void>;

  // Setters
  setError: (error: string | null) => void;
  setCurrentStep: (step: TWizardStep) => void;
  setCurrentStepStatus: (status: WizardStepStatus | string) => void;
  setSelectedRepo: (repo: Repository | null) => void;
  setSearchTerm: (term: string) => void;
  setProjectName: (name: string) => void;
  setRepoName: (name: string) => void;
  setServices: (data: ServiceDataConfig[]) => void;
  setEnvVars: (vars: EnvironmentVariable[]) => void;
  setWorkspaceSlug: (slug: string) => void;
  setWorkspaceId: (id: string) => void;
  setHasKey: (hasKey: boolean) => void;
  resetWizard: () => void;
};

export const useWizardStore = create<WizardStore>()(
  devtools((set, get) => ({
    // Initial state
    ...initialState,

    // API Logic
    fetchWizardState: async () => {
      const state = get();
      const { workspaceSlug } = state;
      set({ loading: true, error: null });
      try {
        const res = await fetch(`/api/code-graph/wizard-state?workspace=${encodeURIComponent(workspaceSlug)}`);
        const json = await res.json();
        console.log(json)
        const { data } = json;

        if (res.ok && json.success) {
          const { wizardStep, stepStatus, swarmId, services, ingestRefId, environmentVariables, poolName } = data;
          set({ envVars: environmentVariables, currentStep: wizardStep, currentStepStatus: stepStatus as WizardStepStatus, projectName: data.wizardData?.projectName || '', swarmId, services, ingestRefId, poolName });
        }
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        set({ loading: false });
      }
    },

    createSwarm: async () => {
      const state = get();
      set({ swarmIsLoading: true });

      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: state.workspaceId,
          name: state.projectName,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to create swarm');
      }

      console.log(json);

      const { swarmId } = json.data;

      const swarmData = {
        name: state.projectName,
        selectedRepo: state.selectedRepo,
        projectName: state.projectName,
        repoName: state.repoName,
        swarmId,
      };


      try {
        await state.updateWizardProgress({
          wizardStep: 'GRAPH_INFRASTRUCTURE',
          stepStatus: 'PROCESSING',
          wizardData: swarmData,
        });

        set({ swarmId, swarmName: state.projectName, currentStep: 'GRAPH_INFRASTRUCTURE', currentStepStatus: 'PROCESSING' });

        if (!res.ok) throw new Error('Failed to create swarm');

      } catch (err) {
        console.error('Error creating swarm:', err);
        throw err;
      }
      finally {
        set({ swarmIsLoading: false });
      }
    },
    setWorkspaceSlug: (slug) => set({ workspaceSlug: slug }),

    updateWizardProgress: async (data) => {
      const state = get();
      const { workspaceSlug } = state;

      try {
        const res = await fetch('/api/code-graph/wizard-progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceSlug,
            ...data,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || 'Failed to update wizard progress');
        }

      } catch (err) {
        console.error('Error updating wizard progress:', err);
        throw err;
      }
    },

    // Setters
    setError: (error) => set({ error }),
    setCurrentStep: (step) => set({ currentStep: step }),
    setCurrentStepStatus: (status) => set({ currentStepStatus: status }),
    setSelectedRepo: (repo) => set({ selectedRepo: repo }),
    setSearchTerm: (term) => set({ searchTerm: term }),
    setProjectName: (name) => set({ projectName: name }),
    setRepoName: (name) => set({ repoName: name }),
    setServices: (services) => set({ services }),
    setEnvVars: (vars) => set({ envVars: vars }),
    setWorkspaceId: (id) => set({ workspaceId: id }),
    setHasKey: (hasKey) => set({ hasKey }),
    setSwarmIsLoading: (isLoading) => set({ swarmIsLoading: isLoading }),
    setIngestRefId: (id) => set({ ingestRefId: id }),
    resetWizard: () => set(initialState),
  }))
);