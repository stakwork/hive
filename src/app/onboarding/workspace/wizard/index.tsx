"use client";


import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { WizardStepRenderer } from "./WizardStepRenderer";

export const STEPS_ARRAY = [
  "WELCOME",
  "GITHUB_AUTH",
  "PROJECT_NAME",
];

export default function WorkspaceWizard() {
  const { data: session } = useSession();
  const [repositoryUrlDraft, setRepositoryUrlDraft] = useState<string>("");

  const [currentStep, setCurrentStep] = useState<string>("WELCOME");

  useEffect(() => {
    const draft = localStorage.getItem("repoUrl");
    if (draft) {
      setRepositoryUrlDraft(draft);
    }
  }, []);


  useEffect(() => {
    if (repositoryUrlDraft && session?.user) {
      setCurrentStep(STEPS_ARRAY[2]);
    }
  }, [repositoryUrlDraft, session?.user, setCurrentStep]);

  const handleNext = useCallback(async () => {
    const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);
    if (currentStepIndex < STEPS_ARRAY.length - 1) {
      const delta = session?.user ? 2 : 1;
      const newStep = currentStepIndex + delta;

      setCurrentStep(STEPS_ARRAY[newStep]);

    }
  }, [currentStep, session?.user, setCurrentStep]);

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
