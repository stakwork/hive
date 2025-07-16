"use client";

import { useState, useEffect, useRef } from "react";
import { CodeGraphWizardProps, WizardStep, Repository } from "@/types/wizard";
import { useRepositories } from "@/hooks/useRepositories";
import { useEnvironmentVars } from "@/hooks/useEnvironmentVars";
import { parseRepositoryName, sanitizeWorkspaceName } from "@/utils/repositoryParser";
import { WizardProgress } from "@/components/wizard/WizardProgress";
import { WelcomeStep } from "@/components/wizard/WelcomeStep";
import { RepositorySelectionStep } from "@/components/wizard/RepositorySelectionStep";
import { GraphInfrastructureStep } from "@/components/wizard/GraphInfrastructureStep";
import { EnvironmentSetupStep } from "@/components/wizard/EnvironmentSetupStep";
import { StakworkSetupStep } from "@/components/wizard/StakworkSetupStep";
import { ProjectNameStep } from "@/components/wizard/ProjectNameStep";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ServicesForm from "@/components/stakgraph/forms/ServicesForm";
import { ServicesData } from "@/components/stakgraph/types";
import ReviewPoolEnvironmentStep from "@/components/wizard/ReviewPoolEnvironmentStep";
import { WizardStepRenderer } from "@/components/wizard/WizardStepRenderer";

function IngestCodeStep({ status, onStart, onContinue, onBack }: { status: 'idle' | 'pending' | 'complete'; onStart: () => void; onContinue: () => void; onBack: () => void }) {
  const isPending = status === 'pending';
  const [countdown, setCountdown] = useState(5);
  useEffect(() => { if (isPending) setCountdown(5); }, [isPending]);
  useEffect(() => { if (isPending && countdown > 0) { const t = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(t); } }, [isPending, countdown]);
  const canContinue = isPending && countdown === 0;
  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated graph/network only */}
          <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="40" cy="32" r="12" fill="#E0E7FF" />
            <circle cx="40" cy="32" r="5" fill="#60A5FA">
              <animate attributeName="r" values="5;7;5" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="64" cy="20" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="64" cy="44" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="16" cy="20" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
            </circle>
            <circle cx="16" cy="44" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="1.2s" repeatCount="indefinite" />
            </circle>
            <line x1="40" y1="32" x2="64" y2="20" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="64" y2="44" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="16" y2="20" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="16" y2="44" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
            </line>
            <line x1="16" y1="20" x2="16" y2="44" stroke="#60A5FA" strokeWidth="2" opacity="0.5" />
            <line x1="64" y1="20" x2="64" y2="44" stroke="#60A5FA" strokeWidth="2" opacity="0.5" />
          </svg>
        </div>
        <AnimatePresence mode="wait">
          {!isPending ? (
            <motion.div key="title-ingest" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
              <CardTitle className="text-2xl">Ingest Code</CardTitle>
              <CardDescription>We will now ingest your codebase. This may take a few minutes.</CardDescription>
            </motion.div>
          ) : (
            <motion.div key="title-ingest-pending" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
              <CardTitle className="text-2xl">Ingesting Code</CardTitle>
              <CardDescription>Your codebase is being ingested. Please wait...</CardDescription>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex justify-between pt-4">
          {!isPending && (
            <Button variant="outline" type="button" onClick={onBack}>Back</Button>
          )}
          {status === 'idle' && (
            <Button className="px-8 bg-primary text-primary-foreground hover:bg-primary/90" type="button" onClick={onStart}>
              Start Ingest
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {status === 'pending' && (
            <Button
              className={`ml-auto px-8 ${canContinue ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground'}`}
              type="button"
              onClick={onContinue}
              disabled={!canContinue}
            >
              {canContinue ? 'Continue' : `Continue (${countdown})`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Define a type for the renderCurrentStep props
interface RenderStepProps {
  repositories: Repository[];
  selectedRepo: Repository | null;
  searchTerm: string;
  loading: boolean;
  projectName: string;
  repoName: string;
  ingestStepStatus: 'idle' | 'pending' | 'complete';
  servicesData: ServicesData;
  envVars: ReturnType<typeof useEnvironmentVars>["envVars"];
  swarmStatus: 'idle' | 'pending' | 'active' | 'error';
  onSearchChange: (term: string) => void;
  onRepoSelect: (repo: Repository | null) => void;
  onProjectNameChange: (name: string) => void;
  onIngestStart: () => void;
  onIngestContinue: () => void;
  onServicesChange: (partial: Partial<ServicesData>) => void;
  onEnvChange: (key: string, value: string) => void;
  onAddEnv: () => void;
  onRemoveEnv: (key: string) => void;
  onCreateSwarm: () => void;
  onSwarmContinue: () => void;
  onNext: () => void;
  onBack: () => void;
  onStepBack: (targetStep: WizardStep) => void;
  onFinish: () => void;
}

function renderCurrentStep(
  step: WizardStep,
  props: RenderStepProps
) {
  const {
    repositories,
    selectedRepo,
    searchTerm,
    loading,
    projectName,
    repoName,
    ingestStepStatus,
    servicesData,
    envVars,
    swarmStatus,
    onSearchChange,
    onRepoSelect,
    onProjectNameChange,
    onIngestStart,
    onIngestContinue,
    onServicesChange,
    onEnvChange,
    onAddEnv,
    onRemoveEnv,
    onCreateSwarm,
    onSwarmContinue,
    onNext,
    onBack,
    onStepBack,
    onFinish,
  } = props;
  switch (step) {
    case 1:
      return <WelcomeStep onNext={onNext} />;
    case 2:
      return (
        <RepositorySelectionStep
          repositories={repositories}
          selectedRepo={selectedRepo}
          searchTerm={searchTerm}
          loading={loading}
          onSearchChange={onSearchChange}
          onRepoSelect={onRepoSelect}
          onNext={onNext}
          onBack={onBack}
        />
      );
    case 3:
      return (
        <ProjectNameStep
          projectName={projectName}
          onProjectNameChange={onProjectNameChange}
          onNext={onNext}
          onBack={onBack}
        />
      );
    case 4:
      return (
        <GraphInfrastructureStep
          graphDomain={sanitizeWorkspaceName(projectName)}
          status={swarmStatus === 'idle' ? 'idle' : swarmStatus === 'pending' ? 'pending' : 'complete'}
          onCreate={onCreateSwarm}
          onComplete={onSwarmContinue}
          onBack={onBack}
        />
      );
    case 5:
      return (
        <IngestCodeStep
          status={ingestStepStatus}
          onStart={onIngestStart}
          onContinue={onIngestContinue}
          onBack={() => onStepBack(4)}
        />
      );
    case 6:
      return (
        <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mx-auto mb-4">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="12" y="20" width="40" height="24" rx="6" fill="#F3F4F6" stroke="#60A5FA" strokeWidth="2" />
                <path d="M24 32h16" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
                <circle cx="32" cy="32" r="4" fill="#60A5FA" />
              </svg>
            </div>
            <CardTitle className="text-2xl">Add Services</CardTitle>
            <CardDescription>Define your services, ports, and scripts for your project.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServicesForm
              data={servicesData}
              loading={false}
              onChange={onServicesChange}
            />
            <div className="flex justify-between pt-6">
              <Button variant="outline" type="button" onClick={() => onStepBack(5)}>
                Back
              </Button>
              <Button className="px-8 bg-primary text-primary-foreground hover:bg-primary/90" type="button" onClick={onNext}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    case 7:
      return (
        <EnvironmentSetupStep
          envVars={envVars}
          onEnvChange={onEnvChange}
          onAddEnv={onAddEnv}
          onRemoveEnv={onRemoveEnv}
          onNext={onNext}
          onBack={onBack}
        />
      );
    case 8:
      return (
        <ReviewPoolEnvironmentStep
          repoName={repoName}
          projectName={projectName}
          servicesData={servicesData}
          envVars={envVars}
          onConfirm={onNext}
          onBack={onBack}
        />
      );
    case 9:
      return (
        <StakworkSetupStep
          workspaceName={projectName}
          onFinish={onFinish}
          onBack={onBack}
        />
      );
    default:
      return null;
  }
}

export function CodeGraphWizard({ user }: CodeGraphWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [ingestStepStatus, setIngestStepStatus] = useState<'idle' | 'pending' | 'complete'>('idle');
  const [servicesData, setServicesData] = useState<ServicesData>({ services: [] });
  const [swarmId, setSwarmId] = useState<string | null>(null);
  const [swarmStatus, setSwarmStatus] = useState<'idle' | 'pending' | 'active' | 'error'>('idle');
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use custom hooks
  const { repositories, loading } = useRepositories({ username: user.github?.username });
  const { 
    envVars, 
    handleEnvChange, 
    handleAddEnv, 
    handleRemoveEnv 
  } = useEnvironmentVars();

  // Parse repository name using regex when selected
  useEffect(() => {
    if (selectedRepo) {
      const parsed = parseRepositoryName(selectedRepo.name);
      setProjectName(parsed); // Default project name from repo
      setRepoName(selectedRepo.name);
    }
  }, [selectedRepo]);

  // Swarm polling effect
  useEffect(() => {
    if (swarmId && swarmStatus === 'pending') {
      // Start polling
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/swarm/poll?id=${swarmId}`);
          const data = await res.json();
          if (data.status === 'ACTIVE') {
            setSwarmStatus('active');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          }
        } catch {
          setSwarmStatus('error');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      }, 3000);
      return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
    // Cleanup on unmount or when swarmId/status changes
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [swarmId, swarmStatus]);

  // Handler to create swarm
  const handleCreateSwarm = async () => {
    setSwarmStatus('pending');
    try {
      const res = await fetch('/api/swarm', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data?.id) {
        setSwarmId(data.data.id);
      } else {
        setSwarmStatus('error');
      }
    } catch {
      setSwarmStatus('error');
    }
  };

  // Handler for continue (when swarm is active)
  const handleSwarmContinue = () => {
    setStep(5);
    setSwarmId(null);
    setSwarmStatus('idle');
  };

  const handleNext = () => {
    if (step < 9) {
      setStep((step + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((step - 1) as WizardStep);
    }
  };

  const handleStepBack = (targetStep: WizardStep) => {
    setStep(targetStep);
    if (targetStep === 4) {
      setSwarmId(null);
      setSwarmStatus('idle');
    }
  };

  return (
    <div className="space-y-6">
      <WizardProgress currentStep={step} totalSteps={9} />
      <WizardStepRenderer step={step}>
        {renderCurrentStep(step, {
          repositories,
          selectedRepo,
          searchTerm,
          loading,
          projectName,
          repoName,
          ingestStepStatus,
          servicesData,
          envVars,
          swarmStatus,
          onSearchChange: setSearchTerm,
          onRepoSelect: setSelectedRepo,
          onProjectNameChange: setProjectName,
          onIngestStart: () => setIngestStepStatus('pending'),
          onIngestContinue: () => { setIngestStepStatus('complete'); handleNext(); },
          onServicesChange: (partial: Partial<ServicesData>) => setServicesData(prev => ({ ...prev, ...partial, services: partial.services ?? prev.services })),
          onEnvChange: handleEnvChange,
          onAddEnv: handleAddEnv,
          onRemoveEnv: handleRemoveEnv,
          onCreateSwarm: handleCreateSwarm,
          onSwarmContinue: handleSwarmContinue,
          onNext: handleNext,
          onBack: handleBack,
          onStepBack: handleStepBack,
          onFinish: handleNext,
        })}
      </WizardStepRenderer>
    </div>
  );
} 