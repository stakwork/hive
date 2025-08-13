"use client";

import { TWizardStep } from "@/stores/useWizardStore";
import { componentsMap } from "./wizard-steps";
import { DefaultStep } from "./wizard-steps/default-step";

interface WizardStepRendererProps {
  step: TWizardStep;
  onNext: () => void;
  onBack: () => void;
}

export function WizardStepRenderer({
  step,
  onNext,
  onBack,
}: WizardStepRendererProps) {
  const StepComponent = componentsMap[step];

  if (!StepComponent) {
    return <DefaultStep step={step} handleBackToStep={() => { }} />;
  }

  const sharedProps = {
    onNext,
    onBack,
  };

  return <StepComponent {...sharedProps} />;
}
