"use client";
import { useCallback, useState, Suspense } from "react";
import { WizardStepRenderer } from "./WizardStepRenderer";
import { Loader2 } from "lucide-react";

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
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
            <WizardStepRenderer
              onNext={handleNext}
              step={currentStep}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
