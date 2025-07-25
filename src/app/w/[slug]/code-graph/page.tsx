"use client";

import { useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WizardProgress } from "@/components/wizard/WizardProgress";
import { WizardStepRenderer } from "@/components/wizard/WizardStepRenderer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { STEPS_ARRAY, useWizardStore } from "@/stores/useWizardStore";

export default function CodeGraphPage() {
  const { workspace } = useWorkspace();

  const loading = useWizardStore((s) => s.loading);
  const fetchWizardState = useWizardStore((s) => s.fetchWizardState);
  const currentStep = useWizardStore((s) => s.currentStep);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
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

  useEffect(() => {
    if (workspace?.slug && workspace?.id) {
      resetWizard();
      setWorkspaceSlug(workspace.slug);
      setWorkspaceId(workspace.id);
      setHasKey(workspace.hasKey);
    }

    return () => {
      resetWizard();
    }
  }, [workspace?.id, workspace?.slug, workspace?.hasKey, setWorkspaceSlug, resetWizard, setWorkspaceId, setHasKey, setCurrentStep, setCurrentStepStatus]);



  useEffect(() => {
    if (workspaceSlug) {
      fetchWizardState();
    }
  }, [workspaceSlug, fetchWizardState]);

  const handleNext = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);
    if (currentStepIndex < 10) {
      const newStep = (currentStepIndex + 1);

      if (swarmId) {
        // Update persisted state
        const newWizardStep = STEPS_ARRAY[newStep];
        try {
          await updateWizardProgress({
            wizardStep: newWizardStep,
            stepStatus: 'PENDING',
            wizardData: {
              step: newStep,
            }
          });

          setCurrentStep(newWizardStep);
          setCurrentStepStatus('PENDING');
        } catch (error) {
          console.error('Failed to update wizard progress:', error);
        }
      } else {
        // Update local state only
        setCurrentStep(STEPS_ARRAY[newStep]);
        setCurrentStepStatus('PENDING');
      }
    }
  }, [currentStep, swarmId, updateWizardProgress, setCurrentStep, setCurrentStepStatus]);

  const handleBack = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);

    if (currentStepIndex > 1) {
      const newStep = (currentStepIndex - 1);

      if (swarmId) {
        // Update persisted state
        const newWizardStep = STEPS_ARRAY[newStep];
        try {
          await updateWizardProgress({
            wizardStep: newWizardStep,
            stepStatus: 'COMPLETED',
            wizardData: {
              step: newStep,
            }
          });
        } catch (error) {
          console.error('Failed to update wizard progress:', error);
        }
      } else {
        // Update local state only
        setCurrentStep(STEPS_ARRAY[newStep]);
        setCurrentStepStatus('COMPLETED');
      }
    }
  }, [currentStep, swarmId, updateWizardProgress, setCurrentStep, setCurrentStepStatus]);


  // Loading state
  if (loading) {
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
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground">Setting up CodeGraph</h1>
          </div>

          <WizardProgress currentStep={currentStep} totalSteps={10} stepStatus={currentStepStatus} />

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
