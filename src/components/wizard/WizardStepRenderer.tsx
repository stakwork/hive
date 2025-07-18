"use client";

import { WizardStep, Repository, EnvironmentVariable } from "@/types/wizard";
import { ServicesData } from "@/components/stakgraph/types";
import { sanitizeWorkspaceName } from "@/utils/repositoryParser";
import { DefaultStep } from "./wizard-steps/default-step";
import { componentsMap } from "./wizard-steps";

interface WizardStepRendererProps {
  step: WizardStep;
  repositories: Repository[];
  selectedRepo: Repository | null;
  searchTerm: string;
  loading: boolean;
  projectName: string;
  repoName: string;
  ingestStepStatus: 'idle' | 'pending' | 'complete';
  servicesData: ServicesData;
  swarmStatus: 'idle' | 'pending' | 'active' | 'error';
  swarmName: string;
  envVars: EnvironmentVariable[];
  onSearchChange: (term: string) => void;
  onRepoSelect: (repo: Repository) => void;
  onProjectNameChange: (name: string) => void;
  onIngestStart: () => void;
  onIngestContinue: () => void;
  onCreateSwarm: () => Promise<void>;
  onSwarmContinue: () => void;
  onServicesChange: (data: Partial<ServicesData>) => void;
  onEnvChange: (index: number, field: keyof EnvironmentVariable, value: string | boolean) => void;
  onAddEnv: () => void;
  onRemoveEnv: (index: number) => void;
  onNext: () => void;
  onBack: () => void;
  onStepChange: (step: WizardStep) => void;
  stepStatus?: string;
  onStatusChange?: (status: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED') => void;
}



export function WizardStepRenderer({
  step,
  repositories,
  selectedRepo,
  searchTerm,
  loading,
  projectName,
  repoName,
  ingestStepStatus,
  servicesData,
  swarmStatus,
  swarmName,
  envVars,
  onSearchChange,
  onRepoSelect,
  onProjectNameChange,
  onIngestStart,
  onIngestContinue,
  onCreateSwarm,
  onSwarmContinue,
  onServicesChange,
  onEnvChange,
  onAddEnv,
  onRemoveEnv,
  onNext,
  onBack,
  onStepChange,
  stepStatus,
  onStatusChange,
}: WizardStepRendererProps) {

    const StepComponent = componentsMap[step]

    if (!StepComponent) {
      return <DefaultStep handleBackToStep={() => onStepChange(1)} step={step} />
    }

    const sharedProps = {
      onNext,
      onBack,
      stepStatus,
      onStatusChange,
    }

    const stepSpecificProps = {
      1: {},
      2: {
        repositories,
        selectedRepo,
        searchTerm,
        loading,
        onSearchChange,
        onRepoSelect,
      },
      3: {
        projectName,
        onProjectNameChange,
      },
      4: {
        swarmName,
        graphDomain: sanitizeWorkspaceName(projectName),
        status:
          swarmStatus === 'idle'
            ? 'idle'
            : swarmStatus === 'pending'
              ? 'pending'
              : 'complete',
        onCreate: onCreateSwarm,
        onComplete: onSwarmContinue,
      },
      5: {
        status: ingestStepStatus,
        onStart: onIngestStart,
        onContinue: onIngestContinue,
        onBack: () => onStepChange(4),
        onStatusChange,
      },
      6: {
        servicesData,
        onServicesChange,
        onStepChange,
      },
      7: {
        envVars,
        onEnvChange,
        onAddEnv,
        onRemoveEnv,
      },
      8: {
        repoName,
        projectName,
        servicesData,
        envVars,
        onConfirm: onNext,
      },
      9: {
        workspaceName: projectName,
        onFinish: onNext,
      },
    }

    return <StepComponent {...sharedProps} {...(stepSpecificProps[step] ?? {})} />
  }
