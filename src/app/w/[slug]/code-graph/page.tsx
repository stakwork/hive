"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardStepRenderer } from "@/components/wizard/WizardStepRenderer";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWizardStore } from "@/stores/useWizardStore";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

const STEPS_ARRAY = [
  "GRAPH_INFRASTRUCTURE",
  "INGEST_CODE",
  "STAKWORK_SETUP",
  "ADD_SERVICES",
  "ENVIRONMENT_SETUP",
  "REVIEW_POOL_ENVIRONMENT",
  "COMPLETION",
];

export default function CodeGraphPage() {
  const { workspace } = useWorkspace();

  const loading = useWizardStore((s) => s.loading);
  const fetchWizardState = useWizardStore((s) => s.fetchWizardState);
  const currentStep = useWizardStore((s) => s.currentStep);
  const error = useWizardStore((s) => s.error);
  const swarmId = useWizardStore((s) => s.swarmId);
  const updateWizardProgress = useWizardStore((s) => s.updateWizardProgress);
  const workspaceSlug = useWizardStore((s) => s.workspaceSlug);
  const setWorkspaceSlug = useWizardStore((s) => s.setWorkspaceSlug);
  const setCurrentStep = useWizardStore((s) => s.setCurrentStep);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const setWorkspaceId = useWizardStore((s) => s.setWorkspaceId);
  const setHasKey = useWizardStore((s) => s.setHasKey);
  const resetWizard = useWizardStore((s) => s.resetWizard);
  const ingestRefId = useWizardStore((s) => s.ingestRefId);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const stepIsSettled = STEPS_ARRAY.includes(currentStep);

  useEffect(() => {
    if (workspace?.slug && workspace?.id) {
      resetWizard();
      setWorkspaceSlug(workspace.slug);
      setWorkspaceId(workspace.id);
      setHasKey(workspace.hasKey);
    }

    return () => {
      resetWizard();
    };
  }, [
    workspace?.id,
    workspace?.slug,
    workspace?.hasKey,
    setWorkspaceSlug,
    resetWizard,
    setWorkspaceId,
    setHasKey,
    setCurrentStep,
    setCurrentStepStatus,
  ]);

  useEffect(() => {
    if (workspaceSlug) {
      fetchWizardState();
    }
  }, [workspaceSlug, fetchWizardState]);

  useEffect(() => {
    if (!ingestRefId) return;

    let isCancelled = false;

    const getIngestStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/swarm/stakgraph/ingest?id=${ingestRefId}&swarmId=${swarmId}&workspaceId=${workspaceId}`,
        );
        const { apiResult } = await res.json();
        const { data } = apiResult;

        console.log("Ingest status:", data);

        if (data.status === "Complete") {
          console.log('ingestion completed');
        } else {
          pollTimeoutRef.current = setTimeout(getIngestStatus, 3000);
        }
      } catch (error) {
        console.error("Failed to get ingest status:", error);
      }
    };

    getIngestStatus();

    return () => {
      isCancelled = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [ingestRefId, swarmId, workspaceId, setCurrentStepStatus, updateWizardProgress]);

  const handleNext = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);
    if (currentStepIndex < 10) {
      const newStep = currentStepIndex + 1;

      if (swarmId) {
        // Update persisted state
        const newWizardStep = STEPS_ARRAY[newStep];
        try {
          await updateWizardProgress({
            wizardStep: newWizardStep,
            stepStatus: "PENDING",
            wizardData: {
              step: newStep,
            },
          });

          setCurrentStep(newWizardStep);
          setCurrentStepStatus("PENDING");
        } catch (error) {
          console.error("Failed to update wizard progress:", error);
        }
      } else {
        // Update local state only
        setCurrentStep(STEPS_ARRAY[newStep]);
        setCurrentStepStatus("PENDING");
      }
    }
  }, [
    currentStep,
    swarmId,
    updateWizardProgress,
    setCurrentStep,
    setCurrentStepStatus,
  ]);

  const handleBack = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);

    if (currentStepIndex > 1) {
      const newStep = currentStepIndex - 1;

      if (swarmId) {
        // Update persisted state
        const newWizardStep = STEPS_ARRAY[newStep];
        try {
          await updateWizardProgress({
            wizardStep: newWizardStep,
            stepStatus: "COMPLETED",
            wizardData: {
              step: newStep,
            },
          });
        } catch (error) {
          console.error("Failed to update wizard progress:", error);
        }
      } else {
        // Update local state only
        setCurrentStep(STEPS_ARRAY[newStep]);
        setCurrentStepStatus("COMPLETED");
      }
    }
  }, [
    currentStep,
    swarmId,
    updateWizardProgress,
    setCurrentStep,
    setCurrentStepStatus,
  ]);

  // Loading state
  if (loading || !stepIsSettled) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-96">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
            <CardTitle>Loading Wizard</CardTitle>
            <CardDescription>Checking your wizard progress...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-96">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <CardTitle>Error Loading Wizard</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fetchWizardState()} className="w-full">
              <Loader2 className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get current step status for display

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Header */}

          {currentStep === "COMPLETION" ? (
            <div className="text-center">
              <h1 className="text-3xl font-bold text-foreground">
                CodeGraph Setup Complete
              </h1>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-3xl font-bold text-foreground">
                  Setting up CodeGraph
                </h1>
              </div>

              <div className="flex justify-center">
                It will take up to 5 minutes to complete the setup.
              </div>
            </>
          )}

          <WizardStepRenderer
            onNext={handleNext}
            onBack={handleBack}
            step={currentStep}
          />
        </div>
      </div>
    </div>
  );
}
