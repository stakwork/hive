"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useWizardStore } from "@/stores/useWizardStore";
import { AlertCircle, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect } from "react";
import { WizardStepRenderer } from "./WizardStepRenderer";

export const STEPS_ARRAY = [
  "WELCOME",
  "GITHUB_AUTH",
  "PROJECT_NAME",
];

export default function WorkspaceWizard() {
  const { data: session } = useSession();
  const loading = useWizardStore((s) => s.loading);
  const fetchWizardState = useWizardStore((s) => s.fetchWizardState);
  const currentStep = useWizardStore((s) => s.currentStep);
  const error = useWizardStore((s) => s.error);
  const repositoryUrlDraft = useWizardStore((s) => s.repositoryUrlDraft);
  const setRepositoryUrlDraft = useWizardStore((s) => s.setRepositoryUrlDraft);
  const workspaceSlug = useWizardStore((s) => s.workspaceSlug);
  const setCurrentStep = useWizardStore((s) => s.setCurrentStep);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const resetWizard = useWizardStore((s) => s.resetWizard);

  useEffect(() => {
    return () => {
      resetWizard();
    };
  }, [

    resetWizard,
  ]);

  useEffect(() => {

    const url = localStorage.getItem("repoUrl");
    if (url) {
      setRepositoryUrlDraft(url);
    }
  }, [setRepositoryUrlDraft]);

  useEffect(() => {
    if (repositoryUrlDraft) {
      localStorage.setItem("repoUrl", repositoryUrlDraft);
    }
  }, [repositoryUrlDraft]);


  useEffect(() => {
    if (repositoryUrlDraft && session?.user) {
      setCurrentStep(STEPS_ARRAY[2]);
    }
  }, [workspaceSlug, fetchWizardState, repositoryUrlDraft, session?.user, setCurrentStep]);

  const handleNext = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);
    if (currentStepIndex < STEPS_ARRAY.length - 1) {
      const delta = session?.user ? 2 : 1;
      const newStep = currentStepIndex + delta;

      setCurrentStep(STEPS_ARRAY[newStep]);
      setCurrentStepStatus("PENDING");

    }
  }, [currentStep, session?.user, setCurrentStep, setCurrentStepStatus]);

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

  console.log("currentStep", currentStep);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          <WizardStepRenderer
            onNext={handleNext}
            step={currentStep}
          />
        </div>
      </div>
    </div>
  );
}
