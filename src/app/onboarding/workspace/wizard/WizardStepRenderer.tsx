"use client";

import { TWizardStep } from ".";
import { componentsMap } from "./wizard-steps";
import { DefaultStep } from "./wizard-steps/default-step";

interface WizardStepRendererProps {
  step: TWizardStep;
  onNext: () => void;
}

export function WizardStepRenderer({ step, onNext }: Readonly<WizardStepRendererProps>) {
  const StepComponent = componentsMap[step];

  if (!StepComponent) {
    return <DefaultStep step={step} handleBackToStep={() => {}} />;
  }

  const sharedProps = {
    onNext,
  };

  return <StepComponent {...sharedProps} />;
}
