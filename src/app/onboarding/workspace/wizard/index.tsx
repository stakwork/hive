"use client";
import { useCallback, useState } from "react";
import { WizardStepRenderer } from "./WizardStepRenderer";

export const STEPS_ARRAY = [
  "WELCOME",
];

export type TWizardStep = (typeof STEPS_ARRAY)[number];

export default function WorkspaceWizard() {
  const [currentStep] = useState<string>("WELCOME");

  // Single-step onboarding: WELCOME handles auth modal + workspace creation

  const handleNext = useCallback(() => {
    // No-op since we only have one step now
    // All navigation is handled within the WELCOME step
  }, []);

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
