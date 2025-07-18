"use client";

import { WizardStep, Repository, EnvironmentVariable } from "@/types/wizard";
import { ServicesData } from "@/components/stakgraph/types";
import { WelcomeStep } from "@/components/wizard/WelcomeStep";
import { RepositorySelectionStep } from "@/components/wizard/RepositorySelectionStep";
import { GraphInfrastructureStep } from "@/components/wizard/GraphInfrastructureStep";
import { EnvironmentSetupStep } from "@/components/wizard/EnvironmentSetupStep";
import { StakworkSetupStep } from "@/components/wizard/StakworkSetupStep";
import { ProjectNameStep } from "@/components/wizard/ProjectNameStep";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ServicesForm from "@/components/stakgraph/forms/ServicesForm";
import ReviewPoolEnvironmentStep from "@/components/wizard/ReviewPoolEnvironmentStep";
import { sanitizeWorkspaceName } from "@/utils/repositoryParser";
import { useState } from "react";

interface WizardStepRendererProps {
    step: WizardStep;
    repositories: Repository[];
    selectedRepo: Repository | null;
    searchTerm: string;
    loading: boolean;
    projectName: string;
    repoName: string;
    ingestStepStatus: "idle" | "pending" | "complete";
    servicesData: ServicesData;
    swarmStatus: "idle" | "pending" | "active" | "error";
    swarmName: string;
    envVars: EnvironmentVariable[];
    onSearchChange: (term: string) => void;
    onRepoSelect: (repo: Repository) => void;
    onProjectNameChange: (name: string) => void;
    onIngestStart: () => void;
    onIngestContinue: () => void;
    onCreateSwarm: () => void;
    onSwarmContinue: () => void;
    onServicesChange: (data: Partial<ServicesData>) => void;
    onEnvChange: (index: number, field: "key" | "value", value: string) => void;
    onAddEnv: () => void;
    onRemoveEnv: (index: number) => void;
    onNext: () => void;
    onBack: () => void;
    onStepChange: (step: WizardStep) => void;
    stepStatus?: string;
    onStatusChange?: (
        status: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED"
    ) => void;
}

function IngestCodeStep({
    status,
    onStart,
    onContinue,
    onStatusChange,
}: {
    status: "idle" | "pending" | "complete";
    onStart: () => void;
    onContinue: () => void;
    onBack: () => void;
    onStatusChange?: (
        status: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED"
    ) => void;
}) {
    const isPending = status === "pending";
    const [countdown] = useState(5);

    const handleStart = () => {
        console.log("CALLED handleStart");
        onStatusChange?.("PROCESSING");
        console.log("CALLING onStart()");
        onStart();
    };

    const handleContinue = () => {
        onStatusChange?.("COMPLETED");
        onContinue();
    };

    const canContinue = isPending;

    return (
        <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
            <CardHeader className="text-center">
                <div className="flex items-center justify-center mx-auto mb-4">
                    <svg
                        width="80"
                        height="64"
                        viewBox="0 0 80 64"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <circle cx="40" cy="32" r="12" fill="#E0E7FF" />
                        <circle cx="40" cy="32" r="5" fill="#60A5FA">
                            <animate
                                attributeName="r"
                                values="5;7;5"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="64" cy="20" r="4" fill="#2563EB">
                            <animate
                                attributeName="r"
                                values="4;6;4"
                                dur="1.2s"
                                begin="0.3s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="64" cy="44" r="4" fill="#2563EB">
                            <animate
                                attributeName="r"
                                values="4;6;4"
                                dur="1.2s"
                                begin="0.6s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="16" cy="20" r="4" fill="#2563EB">
                            <animate
                                attributeName="r"
                                values="4;6;4"
                                dur="1.2s"
                                begin="0.9s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="16" cy="44" r="4" fill="#2563EB">
                            <animate
                                attributeName="r"
                                values="4;6;4"
                                dur="1.2s"
                                begin="1.2s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <line
                            x1="40"
                            y1="32"
                            x2="64"
                            y2="20"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        >
                            <animate
                                attributeName="stroke"
                                values="#60A5FA;#2563EB;#60A5FA"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="40"
                            y1="32"
                            x2="64"
                            y2="44"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        >
                            <animate
                                attributeName="stroke"
                                values="#60A5FA;#2563EB;#60A5FA"
                                dur="1.2s"
                                begin="0.3s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="40"
                            y1="32"
                            x2="16"
                            y2="20"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        >
                            <animate
                                attributeName="stroke"
                                values="#60A5FA;#2563EB;#60A5FA"
                                dur="1.2s"
                                begin="0.6s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="40"
                            y1="32"
                            x2="16"
                            y2="44"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        >
                            <animate
                                attributeName="stroke"
                                values="#60A5FA;#2563EB;#60A5FA"
                                dur="1.2s"
                                begin="0.9s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="16"
                            y1="20"
                            x2="16"
                            y2="44"
                            stroke="#60A5FA"
                            strokeWidth="2"
                            opacity="0.5"
                        />
                        <line
                            x1="64"
                            y1="20"
                            x2="64"
                            y2="44"
                            stroke="#60A5FA"
                            strokeWidth="2"
                            opacity="0.5"
                        />
                    </svg>
                </div>
                <AnimatePresence mode="wait">
                    {!isPending ? (
                        <motion.div
                            key="title-ingest"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                        >
                            <CardTitle className="text-2xl">
                                Ingest Code
                            </CardTitle>
                            <CardDescription>
                                We will now ingest your codebase. This may take
                                a few minutes.
                            </CardDescription>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="title-ingest-pending"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                        >
                            <CardTitle className="text-2xl">
                                Ingesting Code
                            </CardTitle>
                            <CardDescription>
                                Your codebase is being ingested. Please wait...
                            </CardDescription>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex justify-between pt-4">
                    {/* {!isPending && (
            <Button variant="outline" type="button" onClick={onBack}>Back</Button>
          )} */}
                    {status === "idle" && (
                        <Button
                            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                            type="button"
                            onClick={handleStart}
                        >
                            Start Ingest
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    )}
                    {status === "pending" && (
                        <Button
                            className={`ml-auto px-8 ${canContinue ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground"}`}
                            type="button"
                            onClick={handleContinue}
                            disabled={!canContinue}
                        >
                            {canContinue
                                ? "Continue"
                                : `Continue (${countdown})`}
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
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
    const handleBackToStep = (targetStep: WizardStep) => {
        onStepChange(targetStep);
    };

    switch (step) {
        case 1:
            return (
                <WelcomeStep
                    onNext={onNext}
                    stepStatus={stepStatus}
                    onStatusChange={onStatusChange}
                />
            );

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
                    stepStatus={stepStatus}
                />
            );

        case 3:
            return (
                <ProjectNameStep
                    projectName={projectName}
                    onProjectNameChange={onProjectNameChange}
                    onNext={onNext}
                    onBack={onBack}
                    stepStatus={stepStatus}
                />
            );

        case 4:
            return (
                <GraphInfrastructureStep
                    swarmName={swarmName}
                    graphDomain={sanitizeWorkspaceName(projectName)}
                    status={
                        swarmStatus === "idle"
                            ? "idle"
                            : swarmStatus === "pending"
                              ? "pending"
                              : "complete"
                    }
                    onCreate={onCreateSwarm}
                    onComplete={onSwarmContinue}
                    onBack={onBack}
                    stepStatus={stepStatus}
                    onStatusChange={onStatusChange}
                />
            );

        case 5:
            console.log("STEP INGEST CODE STEP");
            return (
                <IngestCodeStep
                    status={ingestStepStatus}
                    onStart={onIngestStart}
                    onContinue={onIngestContinue}
                    onBack={() => handleBackToStep(4)}
                    onStatusChange={onStatusChange}
                />
            );

        case 6:
            return (
                <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
                    <CardHeader className="text-center">
                        <div className="flex items-center justify-center mx-auto mb-4">
                            <svg
                                width="64"
                                height="64"
                                viewBox="0 0 64 64"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <rect
                                    x="12"
                                    y="20"
                                    width="40"
                                    height="24"
                                    rx="6"
                                    fill="#F3F4F6"
                                    stroke="#60A5FA"
                                    strokeWidth="2"
                                />
                                <path
                                    d="M24 32h16"
                                    stroke="#2563EB"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                                <circle cx="32" cy="32" r="4" fill="#60A5FA" />
                            </svg>
                        </div>
                        <CardTitle className="text-2xl">Add Services</CardTitle>
                        <CardDescription>
                            Define your services, ports, and scripts for your
                            project.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ServicesForm
                            data={servicesData}
                            loading={false}
                            onChange={(partial) =>
                                onServicesChange({
                                    ...servicesData,
                                    ...partial,
                                    services:
                                        partial.services ??
                                        servicesData.services,
                                })
                            }
                        />
                        <div className="flex justify-between pt-6">
                            <Button
                                variant="outline"
                                type="button"
                                onClick={() => handleBackToStep(5)}
                            >
                                Back
                            </Button>
                            <Button
                                className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                                type="button"
                                onClick={onNext}
                            >
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
                    stepStatus={stepStatus}
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
                    stepStatus={stepStatus}
                />
            );

        case 9:
            return (
                <StakworkSetupStep
                    workspaceName={projectName}
                    onFinish={onNext}
                    onBack={onBack}
                    stepStatus={stepStatus}
                />
            );

        default:
            return (
                <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl text-red-600">
                            Invalid Step
                        </CardTitle>
                        <CardDescription>
                            The wizard step {step} is not recognized. Please
                            start over or contact support.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center pt-4">
                        <Button
                            variant="outline"
                            onClick={() => handleBackToStep(1)}
                        >
                            Start Over
                        </Button>
                    </CardContent>
                </Card>
            );
    }
}
