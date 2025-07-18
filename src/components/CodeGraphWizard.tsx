"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
    CodeGraphWizardProps,
    WizardStep,
    Repository,
    WizardStepKey,
} from "@/types/wizard";
import { useRepositories } from "@/hooks/useRepositories";
import { useEnvironmentVars } from "@/hooks/useEnvironmentVars";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWizardState } from "@/hooks/useWizardState";
import { useWizardOperations } from "@/hooks/useWizardOperations";
import { parseRepositoryName } from "@/utils/repositoryParser";
import { WizardProgress } from "@/components/wizard/WizardProgress";
import { WizardStepRenderer } from "@/components/wizard/WizardStepRenderer";
import { ServicesData } from "@/components/stakgraph/types";
import { StepStatus } from "@prisma/client";

export function CodeGraphWizard({ user }: CodeGraphWizardProps) {
    const { workspace } = useWorkspace();
    const { wizardStep, stepStatus, wizardData } = useWizardState({
        workspaceSlug: workspace?.slug || "",
    });

    const [step, setStep] = useState<WizardStep>(1);
    const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [projectName, setProjectName] = useState("");
    const [repoName, setRepoName] = useState("");
    const [ingestStepStatus, setIngestStepStatus] = useState<
        "idle" | "pending" | "complete"
    >("idle");
    const [servicesData, setServicesData] = useState<ServicesData>({
        services: [],
    });
    const [swarmId, setSwarmId] = useState<string | null>(null);
    const [swarmStatus, setSwarmStatus] = useState<
        "idle" | "pending" | "active" | "error"
    >("idle");

    // Use new wizard operations hook
    const {
        createSwarm,
        startPolling,
        stopPolling,
        updateWizardProgress: updateWizardProgressUnified,
    } = useWizardOperations({ workspaceSlug: workspace?.slug || "" });

    // Use custom hooks
    const { repositories, loading } = useRepositories({
        username: user.github?.username,
    });
    const { envVars, handleEnvChange, handleAddEnv, handleRemoveEnv } =
        useEnvironmentVars();

    // Step mapping from wizard step keys to numbers
    const stepMapping = useMemo(
        () => ({
            WELCOME: 1,
            REPOSITORY_SELECT: 2,
            PROJECT_NAME: 3,
            GRAPH_INFRASTRUCTURE: 4,
            INGEST_CODE: 5,
            ADD_SERVICES: 6,
            ENVIRONMENT_SETUP: 7,
            REVIEW_POOL_ENVIRONMENT: 8,
            STAKWORK_SETUP: 9,
        }),
        []
    );

    const reverseStepMapping = useMemo(
        () =>
            ({
                1: "WELCOME",
                2: "REPOSITORY_SELECT",
                3: "PROJECT_NAME",
                4: "GRAPH_INFRASTRUCTURE",
                5: "INGEST_CODE",
                6: "ADD_SERVICES",
                7: "ENVIRONMENT_SETUP",
                8: "REVIEW_POOL_ENVIRONMENT",
                9: "STAKWORK_SETUP",
            }) as Record<WizardStep, WizardStepKey>,
        []
    );

    // Sync wizard state with local state
    useEffect(() => {
        if (wizardStep && stepMapping[wizardStep as keyof typeof stepMapping]) {
            setStep(
                stepMapping[
                    wizardStep as keyof typeof stepMapping
                ] as WizardStep
            );
        }
        if (wizardData) {
            if (wizardData.selectedRepo) {
                setSelectedRepo(wizardData.selectedRepo as Repository);
            }
            if (wizardData.projectName) {
                setProjectName(wizardData.projectName as string);
            }
            if (wizardData.repoName) {
                setRepoName(wizardData.repoName as string);
            }
            if (wizardData.servicesData) {
                setServicesData(wizardData.servicesData as ServicesData);
            }

            type SwarmStatus = "error" | "active" | "idle" | "pending";

            function isSwarmStatus(value: any): value is SwarmStatus {
                return ["error", "active", "idle", "pending"].includes(value);
            }
            setSwarmStatus(
                isSwarmStatus(wizardData.swarmStatus)
                    ? wizardData.swarmStatus
                    : "pending"
            );
            //setSwarmStatus(wizardData.swarmStatus || "pending");
        }
    }, [wizardStep, wizardData, stepMapping]);

    // Parse repository name using regex when selected
    useEffect(() => {
        if (selectedRepo) {
            const parsed = parseRepositoryName(selectedRepo.name);
            setProjectName(parsed); // Default project name from repo
            setRepoName(selectedRepo.name);
        }
    }, [selectedRepo]);

    // Swarm polling effect (replaced with hook)
    useEffect(() => {
        console.log("swarmStatus++++++++++++++++++++++++++", swarmStatus);
        if (swarmId && swarmStatus === "pending") {
            startPolling(swarmId, () => {
                setSwarmStatus("active");
            });
            return () => {
                stopPolling();
            };
        }
        return () => {
            stopPolling();
        };
    }, [swarmId, swarmStatus, startPolling, stopPolling]);

    // Handler to create swarm (use hook)
    const handleCreateSwarm = async () => {
        setSwarmStatus("pending");
        try {
            const result = await createSwarm();
            if (result && result.success && result.data?.id) {
                setSwarmId(result.data.id);
            } else {
                setSwarmStatus("error");
            }
        } catch {
            setSwarmStatus("error");
        }
    };

    // Handler for continue (when swarm is active)
    const handleSwarmContinue = () => {
        setStep(5 as WizardStep);
        setSwarmId(null);
        setSwarmStatus("idle");
    };

    const handleRepoSelect = (repo: Repository) => {
        setSelectedRepo(repo);
    };

    const handleNext = useCallback(async () => {
        console.log("HANDLE NEXT CALLED!!");
        if (step < 9) {
            const newStep = (step + 1) as WizardStep;
            const newWizardStep = reverseStepMapping[newStep] as WizardStepKey;
            try {
                await updateWizardProgressUnified({
                    wizardStep: newWizardStep,
                    stepStatus: "PENDING",
                    wizardData: {
                        selectedRepo,
                        projectName,
                        repoName,
                        servicesData,
                        step: newStep,
                    },
                });
                setStep(newStep);
            } catch (error) {
                console.error("Failed to update wizard progress:", error);
            }
        }
    }, [
        step,
        updateWizardProgressUnified,
        selectedRepo,
        projectName,
        repoName,
        servicesData,
        reverseStepMapping,
    ]);

    const handleBack = useCallback(async () => {
        if (step > 1) {
            const newStep = (step - 1) as WizardStep;
            const newWizardStep = reverseStepMapping[newStep] as WizardStepKey;
            try {
                await updateWizardProgressUnified({
                    wizardStep: newWizardStep,
                    stepStatus: "PENDING",
                    wizardData: {
                        selectedRepo,
                        projectName,
                        repoName,
                        servicesData,
                        step: newStep,
                    },
                });
                setStep(newStep);
            } catch (error) {
                console.error("Failed to update wizard progress:", error);
            }
        }
    }, [
        step,
        updateWizardProgressUnified,
        selectedRepo,
        projectName,
        repoName,
        servicesData,
        reverseStepMapping,
    ]);

    const handleIngestStart = useCallback(() => {
        console.log(
            "handleIngestStart called - setting ingestStepStatus to pending from codegraphwizard"
        );
        setIngestStepStatus("pending");
    }, []);

    const handleIngestContinue = () => {
        setIngestStepStatus("complete");
        handleNext();
    };

    const handleServicesChange = (data: Partial<ServicesData>) => {
        setServicesData((prev) => ({
            ...prev,
            ...data,
            services: data.services ?? prev.services,
        }));
    };

    const handleStepChange = useCallback(
        async (newStep: WizardStep) => {
            //FIXME: ADD LOGIC FOR NOT DOING ANYTHING IF STEP IS COMPLETED
            const newWizardStep = reverseStepMapping[newStep] as WizardStepKey;
            try {
                await updateWizardProgressUnified({
                    wizardStep: newWizardStep,
                    stepStatus: "PENDING",
                    wizardData: {
                        selectedRepo,
                        projectName,
                        repoName,
                        servicesData,
                        step: newStep,
                    },
                });
                setStep(newStep);
                if (newStep === 4) {
                    setSwarmId(null);
                    setSwarmStatus("idle");
                }
            } catch (error) {
                console.error("Failed to update wizard progress:", error);
            }
        },
        [
            updateWizardProgressUnified,
            selectedRepo,
            projectName,
            repoName,
            servicesData,
            reverseStepMapping,
        ]
    );

    const handleStatusChange = useCallback(
        async (
            status:
                | "PENDING"
                | "STARTED"
                | "PROCESSING"
                | "COMPLETED"
                | "FAILED"
        ) => {
            try {
                await updateWizardProgressUnified({
                    stepStatus: status,
                    wizardData: {
                        selectedRepo,
                        projectName,
                        repoName,
                        servicesData,
                        step,
                    },
                });
            } catch (error) {
                console.error("Failed to update step status:", error);
            }
        },
        [
            updateWizardProgressUnified,
            selectedRepo,
            projectName,
            repoName,
            servicesData,
            step,
        ]
    );

    return (
        <div className="space-y-6">
            <WizardProgress currentStep={step} totalSteps={9} />
            <WizardStepRenderer
                swarmName={"placeholder"}
                step={step}
                repositories={repositories}
                selectedRepo={selectedRepo}
                searchTerm={searchTerm}
                loading={loading}
                projectName={projectName}
                repoName={repoName}
                ingestStepStatus={ingestStepStatus}
                servicesData={servicesData}
                swarmStatus={swarmStatus}
                envVars={envVars}
                onSearchChange={setSearchTerm}
                onRepoSelect={handleRepoSelect}
                onProjectNameChange={setProjectName}
                onIngestStart={handleIngestStart}
                onIngestContinue={handleIngestContinue}
                onCreateSwarm={handleCreateSwarm}
                onSwarmContinue={handleSwarmContinue}
                onServicesChange={handleServicesChange}
                onEnvChange={handleEnvChange}
                onAddEnv={handleAddEnv}
                onRemoveEnv={handleRemoveEnv}
                onNext={handleNext}
                onBack={handleBack}
                onStepChange={handleStepChange}
                stepStatus={stepStatus as StepStatus}
                onStatusChange={handleStatusChange}
            />
        </div>
    );
}
