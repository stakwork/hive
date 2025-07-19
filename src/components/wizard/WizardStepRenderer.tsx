"use client";

import { WizardStep, Repository, EnvironmentVariable } from "@/types/wizard";
import { DefaultStep } from "./wizard-steps/default-step";
import { componentsMap } from "./wizard-steps";
import { STEPS_ARRAY, TWizardStep } from "@/stores/useWizardStore";

interface WizardStepRendererProps {
  step: TWizardStep;
  stepStatus: string;
  onNext: () => void;
  onBack: () => void;
}



export function WizardStepRenderer({
  step,
  stepStatus,
  onNext,
  onBack,
}: WizardStepRendererProps) {

  console.log("step", step)

  const StepComponent = componentsMap[step]

  if (!StepComponent) {
    return <DefaultStep step={step} handleBackToStep={() => { }} />
  }

  const sharedProps = {
    stepStatus,
    onNext,
    onBack,
  }

  return <StepComponent {...sharedProps} />
}
