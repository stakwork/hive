"use client";

import { TWizardStep } from "@/stores/useWizardStore";
import { componentsMap } from "./wizard-steps";
import { DefaultStep } from "./wizard-steps/default-step";

interface WizardStepRendererProps {
  step: TWizardStep;
  onNext: () => void;
}

export function WizardStepRenderer({
  step,
  onNext,
}: WizardStepRendererProps) {
  const StepComponent = componentsMap[step];

  console.log("StepComponent", step);

  if (!StepComponent) {
    return <DefaultStep step={step} handleBackToStep={() => { }} />;
  }

  const sharedProps = {
    onNext,
  };

  return <StepComponent {...sharedProps} />;
}
