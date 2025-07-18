import { useState, useEffect, useCallback, useMemo } from "react";
import { WizardStateResponse, WizardStep, Repository } from "@/types/wizard";
import { ServicesData } from "@/components/stakgraph/types";
import { EnvironmentVariable } from "@/types/wizard";

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

    // Local state management
    localState: LocalWizardState;
    updateLocalState: (updates: Partial<LocalWizardState>) => void;
    resetLocalState: () => void;

    // Swarm management
    createSwarm: (swarmData: Record<string, unknown>) => Promise<void>;
    ingestCode: () => Promise<void>;
    updateWizardProgress: (data: {
        wizardStep?: string;
        stepStatus?:
            | "PENDING"
            | "STARTED"
            | "PROCESSING"
            | "COMPLETED"
            | "FAILED";
        wizardData?: Record<string, unknown>;
    }) => Promise<void>;

    // Utilities
    refresh: () => void;
}

const defaultLocalState: LocalWizardState = {
    step: 1,
    selectedRepo: null,
    searchTerm: "",
    projectName: "",
    repoName: "",
    servicesData: { services: [] },
    envVars: [{ key: "", value: "", show: false }],
};

export function useWizardFlow({
    workspaceSlug,
}: UseWizardFlowOptions): UseWizardFlowResult {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [response, setResponse] = useState<WizardStateResponse | null>(null);
    const [localState, setLocalState] =
        useState<LocalWizardState>(defaultLocalState);

    // Check for existing swarm on load
    const checkSwarmExists = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            console.log("-------------------");
            const res = await fetch(
                `/api/code-graph/wizard-state?workspace=${encodeURIComponent(workspaceSlug)}`
            );
            const data = await res.json();

            console.log("API Response:", data);

            if (res.ok && data.success) {
                setResponse(data);
            } else {
                // No swarm exists or error - start fresh
                setResponse(null);
            }
        } catch (err) {
            console.error("Error checking swarm existence:", err);
            setError(err instanceof Error ? err.message : "Unknown error");
            setResponse(null);
        } finally {
            setLoading(false);
        }
    }, [workspaceSlug]);

    useEffect(() => {
        checkSwarmExists();
    }, [checkSwarmExists]);

    // Local state management
    const updateLocalState = useCallback(
        (updates: Partial<LocalWizardState>) => {
            setLocalState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    const resetLocalState = useCallback(() => {
        setLocalState(defaultLocalState);
    }, []);

    // Create swarm and start persisting state
    const createSwarm = useCallback(
        async (swarmData: Record<string, unknown>) => {
            try {
                // First update the wizard progress to create the swarm record
                const progressResponse = await fetch(
                    "/api/code-graph/wizard-progress",
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            workspaceSlug,
                            wizardStep: "GRAPH_INFRASTRUCTURE",
                            stepStatus: "PROCESSING",
                            wizardData: swarmData,
                        }),
                    }
                );

                if (!progressResponse.ok) {
                    throw new Error("Failed to update wizard progress");
                }

                // Refresh to get the new swarm state
                await checkSwarmExists();
            } catch (error) {
                console.error("Error creating swarm:", error);
                throw error;
            }
        },
        [workspaceSlug, checkSwarmExists]
    );

    // Ingest code and start persisting state
    const ingestCode = useCallback(async () => {
        console.log("ingestCode endpoint being called......");
        try {
            // First update the wizard progress to create the swarm record
            const progressResponse = await fetch(
                "/api/swarm/stakgraph/ingest",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                }
            );

            if (!progressResponse.ok) {
                throw new Error("Failed to update wizard progress");
            }

            // Refresh to get the new swarm state
            await checkSwarmExists();
        } catch (error) {
            console.error("Error creating swarm:", error);
            throw error;
        }
    }, [checkSwarmExists]);

    // Update wizard progress (only works if swarm exists)
    const updateWizardProgress = useCallback(
        async (data: {
            wizardStep?: string;
            stepStatus?:
                | "PENDING"
                | "STARTED"
                | "PROCESSING"
                | "COMPLETED"
                | "FAILED";
            wizardData?: Record<string, unknown>;
        }) => {
            if (!response?.success) {
                throw new Error(
                    "Cannot update progress without existing swarm"
                );
            }

            console.log("updateWizardProgress>>>>>>", data);

            try {
                const progressResponse = await fetch(
                    "/api/code-graph/wizard-progress",
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            workspaceSlug,
                            ...data,
                        }),
                    }
                );

                if (!progressResponse.ok) {
                    throw new Error("Failed to update wizard progress");
                }

                const result = await progressResponse.json();

                if (result.success) {
                    // Refresh the state to get the updated data
                    await checkSwarmExists();
                } else {
                    throw new Error(
                        result.message || "Failed to update wizard progress"
                    );
                }
            } catch (error) {
                console.error("Error updating wizard progress:", error);
                throw error;
            }
        },
        [workspaceSlug, response, checkSwarmExists]
    );

    const refresh = useCallback(() => {
        checkSwarmExists();
    }, [checkSwarmExists]);

    // Memoized computed values
    const computed = useMemo(() => {
        const hasSwarm = response?.success && response.data;

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
            wizardStep: response.data.wizardStep,
            stepStatus: response.data.stepStatus,
            wizardData: response.data.wizardData,
            swarmId: response.data.swarmId,
            swarmName: response.data.swarmName,
            swarmStatus: response.data.swarmStatus,
            workspaceId: response.data.workspaceId,
            workspaceSlug: response.data.workspaceSlug,
            workspaceName: response.data.workspaceName,
            user: response.data.user,
        };
    }, [response]);

    return {
        loading,
        error,
        ...computed,
        localState,
        updateLocalState,
        resetLocalState,
        createSwarm,
        updateWizardProgress,
        ingestCode,
        refresh,
    };
}
