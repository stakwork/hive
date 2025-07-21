"use client";

import { WizardStep, Repository, EnvironmentVariable } from "@/types/wizard";
import { DefaultStep } from "./wizard-steps/default-step";
import { componentsMap } from "./wizard-steps";
import { STEPS_ARRAY, TWizardStep } from "@/stores/useWizardStore";

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


  const StepComponent = componentsMap[step]

  if (!StepComponent) {
    return <DefaultStep step={step} handleBackToStep={() => { }} />
  }

  const sharedProps = {
    onNext,
    onBack,
  }

  return <StepComponent {...sharedProps} />
}
